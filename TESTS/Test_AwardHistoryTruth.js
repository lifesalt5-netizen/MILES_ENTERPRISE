"use strict";

const AwardHistoryTruthService = require("../SERVICES/orion/AwardHistoryTruthService");

function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`[PASS] ${label}`);
}

const responses = [
  {
    results: [{ id: "x-R", uei: "ABC123", name: "ACME FEDERAL LLC", amount: 1000 }]
  },
  {
    results: [{
      "Award ID": "P1",
      "Recipient Name": "ACME FEDERAL LLC",
      "Award Amount": 100,
      "Awarding Agency": "Agency A",
      "Description": "Prime work"
    }],
    page_metadata: { hasNext: false }
  },
  {
    results: [{
      "Award ID": "P2",
      "Recipient Name": "ACME FEDERAL LLC",
      "Award Amount": 200,
      "Awarding Agency": "Agency B",
      "Subawards": [{
        "Sub-Award ID": "S1",
        "Recipient Name": "ACME FEDERAL LLC",
        "Action Date": "2026-01-01",
        "Amount": 50,
        "Description": "Sub work"
      }]
    }],
    page_metadata: { hasNext: false }
  }
];

const fakeFetch = async () => {
  const body = responses.shift();
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async text() { return JSON.stringify(body); }
  };
};

(async () => {
  const service = new AwardHistoryTruthService({ fetch: fakeFetch });
  const result = await service.auditByUei("ABC123");

  assert(result.ok === true, "audit succeeds");
  assert(result.status === "AUTHORITATIVE_AWARD_HISTORY_READ", "authoritative status recorded");
  assert(result.identity.uei === "ABC123", "UEI is authoritative identity key");
  assert(result.identity.canonicalNames[0] === "ACME FEDERAL LLC", "canonical recipient name resolved");
  assert(result.summary.primeAwardCount === 1, "prime award count assembled");
  assert(result.summary.primeObligations === 100, "prime amount assembled");
  assert(result.summary.subawardCount === 1, "subaward count assembled");
  assert(result.summary.subawardAmount === 50, "subaward amount assembled");
  assert(result.primeAwards[0].role === "PRIME", "prime role explicit");
  assert(result.subawards[0].role === "SUBAWARD", "subaward role explicit");
  assert(result.persistence.databaseWritesPerformed === false, "no database writes");
  assert(result.persistence.ledgerUpdated === false, "ledger not mutated before live validation");
  assert(result.safety.readOnly === true, "read-only safety recorded");
  assert(result.safety.emailsSent === false, "no emails sent");
  assert(result.safety.campaignsChanged === false, "no campaign changes");

  console.log("AWARD_HISTORY_TRUTH_TEST_PASS 15/15");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
