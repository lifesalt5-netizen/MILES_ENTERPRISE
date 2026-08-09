"use strict";

const AwardHistoryTruthService = require("../SERVICES/orion/AwardHistoryTruthService");

// Test fixtures must be deterministic even when the developer/runtime shell has
// real SAM credentials loaded. Dedicated SAM coverage below injects TEST_KEY.
process.env.SAM_API_KEY = "";
process.env.SAM_GOV_API_KEY = "";

function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`[PASS] ${label}`);
}

function makeFetch(routes) {
  return async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;

    let key;
    if (String(url).includes("/api/v2/recipient/")) {
      key = `recipient:${body?.keyword || ""}`;
    } else if (String(url).includes("/entity-information/v4/entities")) {
      const parsed = new URL(url);
      key = `sam:${parsed.searchParams.get("ueiSAM") || ""}`;
    } else if (String(url).includes("/api/v2/search/spending_by_award/")) {
      const level = body?.subawards ? "sub" : "prime";
      const group = Array.isArray(body?.filters?.award_type_codes) && body.filters.award_type_codes[0]?.startsWith("IDV_")
        ? "idv"
        : "contract";
      const searchText = body?.filters?.recipient_search_text?.[0] || "";
      key = `search:${searchText}:${level}:${group}`;
    } else {
      throw new Error(`Unexpected mock URL: ${url}`);
    }

    const queue = routes[key];
    if (!Array.isArray(queue) || !queue.length) {
      throw new Error(`No mock response configured for ${key}`);
    }
    const responseBody = queue.shift();
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async text() { return JSON.stringify(responseBody); }
    };
  };
}

function awardPage(results) {
  return { results, page_metadata: { hasNext: false } };
}

(async () => {
  const baseFetch = makeFetch({
    "recipient:ABC123": [{ results: [{ id: "x-R", uei: "ABC123", name: "ACME FEDERAL LLC", amount: 1000 }] }],
    "search:ABC123:prime:contract": [awardPage([
      { "Award ID": "P1", "Recipient Name": "ACME FEDERAL LLC", "Award Amount": 100, "Awarding Agency": "Agency A", "Description": "Prime work" },
      { "Award ID": "P1", "Recipient Name": "ACME FEDERAL LLC", "Award Amount": 100, "Awarding Agency": "Agency A", "Description": "Duplicate award row" },
      { "Award ID": "P-X", "Recipient Name": "OTHER COMPANY LLC", "Award Amount": 999, "Awarding Agency": "Agency X", "Description": "Must not count" }
    ])],
    "search:ABC123:prime:idv": [awardPage([])],
    "search:ABC123:sub:contract": [awardPage([
      { "Sub-Award ID": "S1", "Sub-Awardee Name": "ACME FEDERAL LLC", "Sub-Award Date": "2026-01-01", "Sub-Award Amount": 50, "Prime Award ID": "P2" },
      { "Sub-Award ID": "S1", "Sub-Awardee Name": "ACME FEDERAL LLC", "Sub-Award Date": "2026-02-01", "Sub-Award Amount": 50, "Prime Award ID": "P2" },
      { "Sub-Award ID": "S-X", "Sub-Awardee Name": "OTHER SUBCONTRACTOR LLC", "Sub-Award Date": "2026-01-01", "Sub-Award Amount": 400, "Prime Award ID": "PX" }
    ])],
    "search:ABC123:sub:idv": [awardPage([])]
  });

  const service = new AwardHistoryTruthService({ fetch: baseFetch, requestTimeoutMs: 5000, samApiKey: "" });
  const result = await service.auditByUei("ABC123");

  assert(result.ok === true, "audit succeeds");
  assert(result.status === "AUTHORITATIVE_AWARD_HISTORY_READ", "authoritative status recorded");
  assert(result.identity.uei === "ABC123", "UEI is authoritative identity key");
  assert(result.identity.canonicalNames[0] === "ACME FEDERAL LLC", "canonical recipient name resolved");
  assert(result.governingDefinition.federalRevenue === "PRIME_AWARDED_REVENUE_PLUS_SUBCONTRACTED_REVENUE", "federal revenue governing definition recorded");
  assert(result.governingDefinition.awardCount === "DISTINCT_PRIME_AWARDS_PLUS_DISTINCT_SUBCONTRACT_AWARDS", "award count governing definition recorded");
  assert(result.summary.primeAwardCount === 1, "distinct prime award count assembled");
  assert(result.summary.primeAwardedRevenue === 100, "prime awarded revenue assembled");
  assert(result.summary.subcontractAwardCount === 1, "distinct subcontract award count assembled");
  assert(result.summary.subcontractedRevenue === 50, "subcontracted revenue assembled");
  assert(result.summary.awardCount === 2, "combined distinct award count assembled");
  assert(result.summary.federalRevenue === 150, "federal revenue equals prime awarded plus subcontracted");
  assert(result.primeAwards[0].role === "PRIME", "prime role explicit");
  assert(result.subcontracts[0].role === "SUBCONTRACT", "subcontract role explicit");
  assert(result.dataQuality.excludedPrimeCandidateCount === 1, "mismatched prime candidate excluded");
  assert(result.dataQuality.excludedSubcontractCandidateCount === 1, "mismatched subcontract candidate excluded");
  assert(result.source.requestTimeoutMs === 5000, "request timeout recorded");
  assert(result.source.authoritativeForPersistence === true, "exact UEI lookup is eligible for persistence after validation");
  assert(result.persistence.databaseWritesPerformed === false, "no database writes");
  assert(result.persistence.ledgerUpdated === false, "ledger not mutated before live validation");
  assert(result.safety.readOnly === true, "read-only safety recorded");
  assert(result.safety.emailsSent === false, "no emails sent");
  assert(result.safety.campaignsChanged === false, "no campaign changes");

  const fallbackFetch = makeFetch({
    "recipient:ABC123": [{ results: [] }],
    "recipient:ACME FEDERAL LLC": [{ results: [{ id: "name-R", uei: null, name: "ACME FEDERAL LLC", amount: 1000 }] }],
    "search:ACME FEDERAL LLC:prime:contract": [awardPage([{ "Award ID": "FP1", "Recipient Name": "ACME FEDERAL LLC", "Award Amount": 300, "Awarding Agency": "Agency C" }])],
    "search:ACME FEDERAL LLC:prime:idv": [awardPage([])],
    "search:ACME FEDERAL LLC:sub:contract": [awardPage([{ "Sub-Award ID": "FS1", "Sub-Awardee Name": "ACME FEDERAL LLC", "Sub-Award Date": "2026-03-01", "Sub-Award Amount": 75, "Prime Award ID": "FP2" }])],
    "search:ACME FEDERAL LLC:sub:idv": [awardPage([])]
  });

  const fallbackService = new AwardHistoryTruthService({ fetch: fallbackFetch, requestTimeoutMs: 5000, samApiKey: "" });
  const fallback = await fallbackService.auditByUei("ABC123", { companyName: "ACME FEDERAL LLC" });

  assert(fallback.ok === true, "legal-name fallback recovers award history when UEI recipient lookup is empty");
  assert(fallback.status === "AWARD_HISTORY_READ_NAME_FALLBACK_REQUIRES_UEI_RECONCILIATION", "fallback status requires UEI reconciliation");
  assert(fallback.source.recipientMatchedBy === "LEGAL_NAME_FALLBACK", "fallback identity method recorded");
  assert(fallback.source.authoritativeForPersistence === false, "name fallback cannot overwrite ORION totals");
  assert(fallback.identity.reconciliationRequired === true, "UEI reconciliation requirement recorded");
  assert(fallback.summary.primeAwardedRevenue === 300, "fallback prime awarded revenue assembled");
  assert(fallback.summary.subcontractedRevenue === 75, "fallback subcontracted revenue assembled");
  assert(fallback.summary.federalRevenue === 375, "fallback federal revenue uses governing formula");
  assert(fallback.summary.awardCount === 2, "fallback award count uses distinct prime plus subcontract awards");
  assert(fallback.dataQuality.zeroAwardClassificationPermitted === false, "fallback cannot classify contractor as zero award");
  assert(fallback.persistence.allowed === false, "fallback persistence fails closed");

  const samFetch = makeFetch({
    "recipient:ABC123": [{ results: [] }],
    "sam:ABC123": [{ entityData: [{ entityRegistration: { ueiSAM: "ABC123", legalBusinessName: "ACME FEDERAL LLC", registrationStatus: "Active", samRegistered: "Yes", cageCode: "1ABC2" } }] }],
    "search:ACME FEDERAL LLC:prime:contract": [awardPage([{ "Award ID": "SP1", "Recipient Name": "ACME FEDERAL LLC", "Award Amount": 700, "Awarding Agency": "Agency SAM" }])],
    "search:ACME FEDERAL LLC:prime:idv": [awardPage([])],
    "search:ACME FEDERAL LLC:sub:contract": [awardPage([{ "Sub-Award ID": "SS1", "Sub-Awardee Name": "ACME FEDERAL LLC", "Sub-Recipient UEI": "ABC123", "Sub-Award Date": "2026-04-01", "Sub-Award Amount": 125, "Prime Award ID": "SPX" }])],
    "search:ACME FEDERAL LLC:sub:idv": [awardPage([])]
  });

  const samService = new AwardHistoryTruthService({ fetch: samFetch, requestTimeoutMs: 5000, samApiKey: "TEST_KEY" });
  const samResult = await samService.auditByUei("ABC123", { companyName: "ACME FEDERAL LLC" });

  assert(samResult.ok === true, "SAM exact UEI reconciles identity when USAspending recipient profile is empty");
  assert(samResult.source.recipientMatchedBy === "SAM_UEI", "SAM identity method recorded");
  assert(samResult.source.identityAuthority === "SAM.gov", "SAM recorded as identity authority");
  assert(samResult.source.samIdentityStatus === "SAM_UEI_CONFIRMED", "SAM confirmation status recorded");
  assert(samResult.source.authoritativeForPersistence === true, "SAM exact UEI permits authoritative persistence after validation");
  assert(samResult.identity.canonicalNames[0] === "ACME FEDERAL LLC", "SAM legal business name becomes canonical identity");
  assert(samResult.summary.federalRevenue === 825, "SAM reconciled history still uses prime plus subcontract governing formula");
  assert(samResult.dataQuality.zeroAwardClassificationPermitted === true, "zero-award classification allowed only after authoritative UEI reconciliation");

  const unresolvedFetch = makeFetch({
    "recipient:ABC123": [{ results: [] }],
    "recipient:ACME FEDERAL LLC": [{ results: [{ name: "DIFFERENT COMPANY LLC" }] }]
  });
  const unresolvedService = new AwardHistoryTruthService({ fetch: unresolvedFetch, requestTimeoutMs: 5000, samApiKey: "" });
  const unresolved = await unresolvedService.auditByUei("ABC123", { companyName: "ACME FEDERAL LLC" });
  assert(unresolved.ok === false, "unresolved identity fails closed");
  assert(unresolved.zeroAwardClassificationPermitted === false, "unresolved identity cannot be labeled zero award");
  assert(unresolved.samIdentityStatus === "SAM_API_KEY_NOT_CONFIGURED", "missing SAM credential is explicit");

  const hangingFetch = async (_url, options = {}) => new Promise((resolve, reject) => {
    const signal = options.signal;
    if (!signal) return;
    if (signal.aborted) {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
      return;
    }
    signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  const timeoutService = new AwardHistoryTruthService({ fetch: hangingFetch, requestTimeoutMs: 1000, samApiKey: "" });
  let timeoutError = null;
  try {
    await timeoutService.auditByUei("ABC123");
  } catch (error) {
    timeoutError = error;
  }

  assert(Boolean(timeoutError), "hung request fails instead of hanging indefinitely");
  assert(/timed out after 1000ms/.test(timeoutError.message), "timeout error is explicit");
  assert(/recipient/.test(timeoutError.message), "timeout identifies blocked endpoint");

  console.log("AWARD_HISTORY_TRUTH_TEST_PASS 47/47");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});