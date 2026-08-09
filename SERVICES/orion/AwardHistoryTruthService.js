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
        role: "SUBAWARD",
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
      role: "SUBAWARD",
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

    const primes = this.dedupe(
      primeRaw.map((row) => this.normalizePrime(row)).filter((row) => row.awardId),
      (row) => String(row.awardId)
    );

    const subs = this.dedupe(
      subRaw.flatMap((row) => this.normalizeSub(row)).filter((row) => row.subawardId || row.primeAwardId),
      (row) => `${row.primeAwardId || ""}|${row.subawardId || ""}|${row.actionDate || ""}|${row.amount}`
    );

    const primeNameMismatches = primes.filter((row) => row.recipientName && !canonicalNameSet.has(normalizeName(row.recipientName)));
    const subNameMismatches = subs.filter((row) => row.recipientName && canonicalNameSet.size && !canonicalNameSet.has(normalizeName(row.recipientName)));

    const primeObligations = primes.reduce((sum, row) => sum + number(row.amount), 0);
    const subawardAmount = subs.reduce((sum, row) => sum + number(row.amount), 0);

    return {
      ok: true,
      service: "AWARD_HISTORY_TRUTH",
      status: "AUTHORITATIVE_AWARD_HISTORY_READ",
      generatedAt: new Date().toISOString(),
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
        primeAwardCount: primes.length,
        primeObligations,
        subawardCount: subs.length,
        subawardAmount,
        combinedReportedAmount: primeObligations + subawardAmount
      },
      primeAwards: primes,
      subawards: subs,
      dataQuality: {
        primeRawRows: primeRaw.length,
        subawardRawRows: subRaw.length,
        primeNameMismatchCount: primeNameMismatches.length,
        subawardNameMismatchCount: subNameMismatches.length,
        warnings: [
          ...(primeNameMismatches.length ? ["Prime award recipient-name mismatches require review despite UEI filtering."] : []),
          ...(subNameMismatches.length ? ["Some subaward recipient names do not match the canonical UEI recipient name; review USAspending subaward response semantics before persistence."] : [])
        ]
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
