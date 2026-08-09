"use strict";

const API_BASE = "https://api.usaspending.gov";

const CONTRACT_CODES = [
  "A", "B", "C", "D",
  "IDV_A", "IDV_B", "IDV_B_A", "IDV_B_B", "IDV_B_C",
  "IDV_C", "IDV_D", "IDV_E"
];

function clean(value) {
  return String(value || "").trim();
}

function normalizeName(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pick(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return null;
}

class AwardHistoryTruthService {
  constructor(options = {}) {
    this.fetch = options.fetch || global.fetch;
    this.apiBase = options.apiBase || API_BASE;
  }

  async post(path, body) {
    if (typeof this.fetch !== "function") throw new Error("fetch is unavailable");
    const response = await this.fetch(this.apiBase + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { detail: text }; }
    if (!response.ok) {
      throw new Error(`USAspending ${response.status}: ${data?.detail || response.statusText || "request failed"}`);
    }
    return data;
  }

  async resolveRecipient(uei) {
    const data = await this.post("/api/v2/recipient/", {
      keyword: clean(uei),
      award_type: "contracts",
      limit: 100,
      page: 1,
      sort: "amount",
      order: "desc"
    });
    const results = Array.isArray(data?.results) ? data.results : [];
    const exact = results.filter((row) => clean(row?.uei).toUpperCase() === clean(uei).toUpperCase());
    return { results, exact };
  }

  buildSearchBody(uei, page, limit, spendingLevel) {
    return {
      filters: {
        recipient_search_text: [clean(uei)],
        award_type_codes: CONTRACT_CODES
      },
      fields: [
        "Award ID",
        "Recipient Name",
        "Start Date",
        "End Date",
        "Award Amount",
        "Description",
        "Awarding Agency",
        "Awarding Sub Agency",
        "Funding Agency",
        "Funding Sub Agency",
        "Contract Award Type"
      ],
      page,
      limit,
      sort: "Award Amount",
      order: "desc",
      spending_level: spendingLevel,
      subawards: spendingLevel === "subawards"
    };
  }

  async searchAll(uei, spendingLevel, options = {}) {
    const pageSize = Math.max(1, Math.min(Number(options.pageSize) || 100, 100));
    const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 100, 500));
    const rows = [];
    let page = 1;
    let hasNext = true;
    while (hasNext && page <= maxPages) {
      const data = await this.post(
        "/api/v2/search/spending_by_award/",
        this.buildSearchBody(uei, page, pageSize, spendingLevel)
      );
      const batch = Array.isArray(data?.results) ? data.results : [];
      rows.push(...batch);
      const meta = data?.page_metadata || {};
      hasNext = Boolean(meta.hasNext || meta.has_next || meta.next);
      page += 1;
      if (!batch.length) hasNext = false;
    }
    return rows;
  }

  normalizePrime(row = {}) {
    return {
      role: "PRIME",
      awardId: pick(row, ["Award ID", "award_id", "piid"]),
      recipientName: pick(row, ["Recipient Name", "recipient_name"]),
      startDate: pick(row, ["Start Date", "start_date"]),
      endDate: pick(row, ["End Date", "end_date"]),
      amount: number(pick(row, ["Award Amount", "award_amount", "total_obligation"])),
      description: pick(row, ["Description", "Contract Description", "description"]),
      awardingAgency: pick(row, ["Awarding Agency", "awarding_agency"]),
      awardingSubAgency: pick(row, ["Awarding Sub Agency", "awarding_sub_agency"]),
      fundingAgency: pick(row, ["Funding Agency", "funding_agency"]),
      fundingSubAgency: pick(row, ["Funding Sub Agency", "funding_sub_agency"]),
      awardType: pick(row, ["Contract Award Type", "Award Type", "type_description"]),
      source: "USAspending.gov"
    };
  }

  normalizeSub(row = {}) {
    const nested = Array.isArray(row.Subawards) ? row.Subawards : [];
    if (nested.length) {
      return nested.map((sub) => ({
        role: "SUBCONTRACT",
        primeAwardId: pick(row, ["Award ID", "award_id", "piid"]),
        subawardId: pick(sub, ["Sub-Award ID", "Subaward ID", "subaward_id"]),
        recipientName: pick(sub, ["Recipient Name", "Subawardee Name", "recipient_name"]),
        actionDate: pick(sub, ["Action Date", "Subaward Date", "action_date"]),
        amount: number(pick(sub, ["Amount", "Subaward Amount", "amount"])),
        description: pick(sub, ["Description", "description"]),
        awardingAgency: pick(row, ["Awarding Agency", "awarding_agency"]),
        source: "USAspending.gov"
      }));
    }
    return [{
      role: "SUBCONTRACT",
      primeAwardId: pick(row, ["Prime Award ID", "Award ID", "prime_award_id", "award_id"]),
      subawardId: pick(row, ["Sub-Award ID", "Subaward ID", "subaward_id"]),
      recipientName: pick(row, ["Recipient Name", "Subawardee Name", "recipient_name"]),
      actionDate: pick(row, ["Action Date", "Subaward Date", "action_date"]),
      amount: number(pick(row, ["Amount", "Subaward Amount", "Award Amount", "amount"])),
      description: pick(row, ["Description", "description"]),
      awardingAgency: pick(row, ["Awarding Agency", "awarding_agency"]),
      source: "USAspending.gov"
    }];
  }

  dedupe(rows, keyFn) {
    const seen = new Set();
    return rows.filter((row) => {
      const key = keyFn(row);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  recipientMatches(row, canonicalNameSet) {
    const name = normalizeName(row?.recipientName);
    return Boolean(name && canonicalNameSet.has(name));
  }

  async auditByUei(uei, options = {}) {
    const target = clean(uei).toUpperCase();
    if (!target) return { ok: false, status: "UEI_REQUIRED", readOnly: true };

    const recipient = await this.resolveRecipient(target);
    const exact = recipient.exact;
    if (!exact.length) {
      return {
        ok: false,
        service: "AWARD_HISTORY_TRUTH",
        status: "UEI_NOT_CONFIRMED_BY_USASPENDING",
        uei: target,
        recipientCandidates: recipient.results,
        readOnly: true
      };
    }

    const canonicalNames = [...new Set(exact.map((row) => clean(row.name)).filter(Boolean))];
    const canonicalNameSet = new Set(canonicalNames.map(normalizeName));

    const [primeRaw, subRaw] = await Promise.all([
      this.searchAll(target, "awards", options),
      this.searchAll(target, "subawards", options)
    ]);

    const primeCandidates = this.dedupe(
      primeRaw.map((row) => this.normalizePrime(row)).filter((row) => row.awardId),
      (row) => String(row.awardId)
    );

    const subcontractCandidates = this.dedupe(
      subRaw.flatMap((row) => this.normalizeSub(row)).filter((row) => row.subawardId || row.primeAwardId),
      (row) => row.subawardId
        ? `SUB|${row.subawardId}`
        : `FALLBACK|${row.primeAwardId || ""}|${normalizeName(row.recipientName)}|${row.actionDate || ""}|${row.amount}`
    );

    // UEI is the authoritative lookup key. USAspending's award result rows do not
    // consistently expose UEI, so canonical recipient names resolved from the exact
    // UEI lookup are used as a fail-closed secondary validation before totals persist.
    const primeAwards = primeCandidates.filter((row) => this.recipientMatches(row, canonicalNameSet));
    const subcontracts = subcontractCandidates.filter((row) => this.recipientMatches(row, canonicalNameSet));

    const excludedPrimeCandidates = primeCandidates.filter((row) => !this.recipientMatches(row, canonicalNameSet));
    const excludedSubcontractCandidates = subcontractCandidates.filter((row) => !this.recipientMatches(row, canonicalNameSet));

    const primeAwardedRevenue = primeAwards.reduce((sum, row) => sum + number(row.amount), 0);
    const subcontractedRevenue = subcontracts.reduce((sum, row) => sum + number(row.amount), 0);
    const federalRevenue = primeAwardedRevenue + subcontractedRevenue;
    const primeAwardCount = primeAwards.length;
    const subcontractAwardCount = subcontracts.length;
    const awardCount = primeAwardCount + subcontractAwardCount;

    return {
      ok: true,
      service: "AWARD_HISTORY_TRUTH",
      status: "AUTHORITATIVE_AWARD_HISTORY_READ",
      generatedAt: new Date().toISOString(),
      governingDefinition: {
        federalRevenue: "PRIME_AWARDED_REVENUE_PLUS_SUBCONTRACTED_REVENUE",
        awardCount: "DISTINCT_PRIME_AWARDS_PLUS_DISTINCT_SUBCONTRACT_AWARDS",
        transactionRule: "MODIFICATIONS_AND_FUNDING_TRANSACTIONS_DO_NOT_INFLATE_DISTINCT_AWARD_COUNT"
      },
      source: {
        name: "USAspending.gov",
        apiBase: this.apiBase,
        recipientMatchedBy: "UEI",
        authoritativeLookupPerformed: true
      },
      identity: {
        uei: target,
        canonicalNames,
        recipientMatches: exact.length
      },
      summary: {
        federalRevenue,
        awardCount,
        primeAwardedRevenue,
        primeAwardCount,
        subcontractedRevenue,
        subcontractAwardCount
      },
      primeAwards,
      subcontracts,
      dataQuality: {
        primeRawRows: primeRaw.length,
        subcontractRawRows: subRaw.length,
        primeCandidateRows: primeCandidates.length,
        subcontractCandidateRows: subcontractCandidates.length,
        excludedPrimeCandidateCount: excludedPrimeCandidates.length,
        excludedSubcontractCandidateCount: excludedSubcontractCandidates.length,
        warnings: [
          ...(excludedPrimeCandidates.length ? ["Prime award candidates with recipient names outside the exact-UEI canonical identity set were excluded from revenue and award counts."] : []),
          ...(excludedSubcontractCandidates.length ? ["Subcontract candidates with recipient names outside the exact-UEI canonical identity set were excluded from revenue and award counts pending review."] : [])
        ]
      },
      excludedCandidates: {
        primeAwards: excludedPrimeCandidates,
        subcontracts: excludedSubcontractCandidates
      },
      persistence: {
        databaseWritesPerformed: false,
        contractorSummaryUpdated: false,
        ledgerUpdated: false,
        nextAuthorization: "VALIDATE_LIVE_AWARD_HISTORY_BEFORE_PERSISTENCE"
      },
      safety: {
        readOnly: true,
        emailsSent: false,
        campaignsChanged: false
      }
    };
  }
}

module.exports = AwardHistoryTruthService;
