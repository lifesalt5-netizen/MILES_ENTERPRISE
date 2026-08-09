"use strict";

const API_BASE = "https://api.usaspending.gov";
const SAM_API_BASE = "https://api.sam.gov";

const PRIME_CONTRACT_CODES = ["A", "B", "C", "D"];
const IDV_CODES = [
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
    this.samApiBase = options.samApiBase || SAM_API_BASE;
    this.samApiKey = clean(options.samApiKey || process.env.SAM_API_KEY || process.env.SAM_GOV_API_KEY);
    this.requestTimeoutMs = Math.max(1000, Number(options.requestTimeoutMs) || 30000);
  }

  async request(url, options = {}, label = url) {
    if (typeof this.fetch !== "function") throw new Error("fetch is unavailable");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let response;
    try {
      response = await this.fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) {
        throw new Error(`Request timed out after ${this.requestTimeoutMs}ms: ${label}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { detail: text }; }
    if (!response.ok) {
      const detail = data?.message || data?.detail || response.statusText || "request failed";
      throw new Error(`${label} ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    }
    return data;
  }

  async post(path, body) {
    return this.request(
      this.apiBase + path,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      },
      `USAspending ${path}`
    );
  }

  async resolveRecipientByKeyword(keyword) {
    const data = await this.post("/api/v2/recipient/", {
      keyword: clean(keyword),
      award_type: "contracts",
      limit: 100,
      page: 1,
      sort: "amount",
      order: "desc"
    });
    return Array.isArray(data?.results) ? data.results : [];
  }

  async resolveSamIdentity(uei) {
    const targetUei = clean(uei).toUpperCase();
    if (!this.samApiKey) {
      return {
        attempted: false,
        confirmed: false,
        status: "SAM_API_KEY_NOT_CONFIGURED",
        rows: []
      };
    }

    const url = `${this.samApiBase}/entity-information/v4/entities?ueiSAM=${encodeURIComponent(targetUei)}&includeSections=entityRegistration`;
    const data = await this.request(
      url,
      {
        method: "GET",
        headers: {
          "accept": "application/json",
          "x-api-key": this.samApiKey
        }
      },
      "SAM Entity Management API"
    );

    const rows = Array.isArray(data?.entityData) ? data.entityData : [];
    const exact = rows.filter((row) => clean(row?.entityRegistration?.ueiSAM).toUpperCase() === targetUei);
    return {
      attempted: true,
      confirmed: exact.length > 0,
      status: exact.length ? "SAM_UEI_CONFIRMED" : "SAM_UEI_NOT_FOUND",
      rows: exact,
      candidates: rows
    };
  }

  async resolveIdentity(uei, companyName) {
    const targetUei = clean(uei).toUpperCase();
    const targetName = clean(companyName);

    const ueiResults = await this.resolveRecipientByKeyword(targetUei);
    const exactUei = ueiResults.filter((row) => clean(row?.uei).toUpperCase() === targetUei);
    if (exactUei.length) {
      return {
        confirmed: true,
        matchedBy: "USASPENDING_UEI",
        authoritativeForPersistence: true,
        canonicalRows: exactUei.map((row) => ({ name: row.name, uei: row.uei })),
        recipientCandidates: ueiResults,
        searchText: targetUei,
        sam: { attempted: false, status: "NOT_REQUIRED" }
      };
    }

    const sam = await this.resolveSamIdentity(targetUei);
    if (sam.confirmed) {
      const canonicalRows = sam.rows.map((row) => ({
        name: row?.entityRegistration?.legalBusinessName,
        uei: row?.entityRegistration?.ueiSAM,
        registrationStatus: row?.entityRegistration?.registrationStatus,
        samRegistered: row?.entityRegistration?.samRegistered,
        cageCode: row?.entityRegistration?.cageCode
      }));
      const canonicalName = clean(canonicalRows[0]?.name);
      return {
        confirmed: true,
        matchedBy: "SAM_UEI",
        authoritativeForPersistence: true,
        canonicalRows,
        recipientCandidates: ueiResults,
        searchText: canonicalName || targetUei,
        sam
      };
    }

    if (!targetName) {
      return {
        confirmed: false,
        matchedBy: null,
        authoritativeForPersistence: false,
        canonicalRows: [],
        recipientCandidates: ueiResults,
        searchText: targetUei,
        sam
      };
    }

    const nameResults = await this.resolveRecipientByKeyword(targetName);
    const normalizedTarget = normalizeName(targetName);
    const exactName = nameResults.filter((row) => normalizeName(row?.name) === normalizedTarget);

    return {
      confirmed: exactName.length > 0,
      matchedBy: exactName.length ? "LEGAL_NAME_FALLBACK" : null,
      authoritativeForPersistence: false,
      canonicalRows: exactName.map((row) => ({ name: row.name, uei: row.uei })),
      recipientCandidates: [...ueiResults, ...nameResults],
      searchText: targetName,
      sam
    };
  }

  buildSearchBody(searchText, page, limit, spendingLevel, awardTypeCodes = PRIME_CONTRACT_CODES) {
    const isSubaward = spendingLevel === "subawards";
    if (isSubaward) {
      return {
        filters: {
          recipient_search_text: [clean(searchText)],
          award_type_codes: awardTypeCodes
        },
        fields: [
          "Sub-Award ID",
          "Sub-Award Type",
          "Sub-Awardee Name",
          "Sub-Award Date",
          "Sub-Award Amount",
          "Awarding Agency",
          "Awarding Sub Agency",
          "Prime Award ID",
          "Prime Recipient Name",
          "Sub-Award Description",
          "Sub-Recipient UEI",
          "Prime Award Recipient UEI"
        ],
        page,
        limit,
        sort: "Sub-Award Amount",
        order: "desc",
        subawards: true
      };
    }

    return {
      filters: {
        recipient_search_text: [clean(searchText)],
        award_type_codes: awardTypeCodes
      },
      fields: [
        "Award ID",
        "Recipient Name",
        "Start Date",
        "End Date",
        "Award Amount",
        "Contract Description",
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
      subawards: false
    };
  }

  async searchAll(searchText, spendingLevel, options = {}) {
    const pageSize = Math.max(1, Math.min(Number(options.pageSize) || 100, 100));
    const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 100, 500));
    const groups = Array.isArray(options.awardTypeGroups) && options.awardTypeGroups.length
      ? options.awardTypeGroups
      : [PRIME_CONTRACT_CODES, IDV_CODES];

    const allRows = [];
    for (const awardTypeCodes of groups) {
      let page = 1;
      let hasNext = true;
      while (hasNext && page <= maxPages) {
        const data = await this.post(
          "/api/v2/search/spending_by_award/",
          this.buildSearchBody(searchText, page, pageSize, spendingLevel, awardTypeCodes)
        );
        const batch = Array.isArray(data?.results) ? data.results : [];
        allRows.push(...batch);
        const meta = data?.page_metadata || {};
        hasNext = Boolean(meta.hasNext || meta.has_next || meta.next);
        page += 1;
        if (!batch.length) hasNext = false;
      }
    }
    return allRows;
  }

  normalizePrime(row = {}) {
    return {
      role: "PRIME",
      awardId: pick(row, ["Award ID", "award_id", "piid"]),
      recipientName: pick(row, ["Recipient Name", "recipient_name"]),
      startDate: pick(row, ["Start Date", "start_date"]),
      endDate: pick(row, ["End Date", "end_date"]),
      amount: number(pick(row, ["Award Amount", "award_amount", "total_obligation"])),
      description: pick(row, ["Contract Description", "Description", "description"]),
      awardingAgency: pick(row, ["Awarding Agency", "awarding_agency"]),
      awardingSubAgency: pick(row, ["Awarding Sub Agency", "awarding_sub_agency"]),
      fundingAgency: pick(row, ["Funding Agency", "funding_agency"]),
      fundingSubAgency: pick(row, ["Funding Sub Agency", "funding_sub_agency"]),
      awardType: pick(row, ["Contract Award Type", "Award Type", "type_description"]),
      source: "USAspending.gov"
    };
  }

  normalizeSub(row = {}) {
    return [{
      role: "SUBCONTRACT",
      primeAwardId: pick(row, ["Prime Award ID", "Award ID", "prime_award_id", "award_id"]),
      subawardId: pick(row, ["Sub-Award ID", "Subaward ID", "subaward_id"]),
      recipientName: pick(row, ["Sub-Awardee Name", "Recipient Name", "Subawardee Name", "recipient_name"]),
      recipientUei: pick(row, ["Sub-Recipient UEI", "recipient_uei"]),
      actionDate: pick(row, ["Sub-Award Date", "Action Date", "Subaward Date", "action_date"]),
      amount: number(pick(row, ["Sub-Award Amount", "Amount", "Subaward Amount", "Award Amount", "amount"])),
      description: pick(row, ["Sub-Award Description", "Description", "description"]),
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

  recipientMatches(row, canonicalNameSet, targetUei) {
    const rowUei = clean(row?.recipientUei).toUpperCase();
    if (rowUei && targetUei && rowUei === targetUei) return true;
    const name = normalizeName(row?.recipientName);
    return Boolean(name && canonicalNameSet.has(name));
  }

  async auditByUei(uei, options = {}) {
    const target = clean(uei).toUpperCase();
    if (!target) return { ok: false, status: "UEI_REQUIRED", readOnly: true };

    const companyName = clean(options.companyName);
    const identity = await this.resolveIdentity(target, companyName);
    if (!identity.confirmed) {
      return {
        ok: false,
        service: "AWARD_HISTORY_TRUTH",
        status: companyName ? "IDENTITY_NOT_CONFIRMED_BY_AUTHORITATIVE_SOURCES" : "UEI_NOT_CONFIRMED_BY_AUTHORITATIVE_SOURCES",
        uei: target,
        companyName: companyName || null,
        recipientCandidates: identity.recipientCandidates,
        samIdentityStatus: identity.sam?.status || null,
        zeroAwardClassificationPermitted: false,
        readOnly: true
      };
    }

    const canonicalNames = [...new Set(identity.canonicalRows.map((row) => clean(row.name)).filter(Boolean))];
    const canonicalNameSet = new Set(canonicalNames.map(normalizeName));

    const [primeRaw, subRaw] = await Promise.all([
      this.searchAll(identity.searchText, "awards", options),
      this.searchAll(identity.searchText, "subawards", options)
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

    const primeAwards = primeCandidates.filter((row) => this.recipientMatches(row, canonicalNameSet, target));
    const subcontracts = subcontractCandidates.filter((row) => this.recipientMatches(row, canonicalNameSet, target));

    const excludedPrimeCandidates = primeCandidates.filter((row) => !this.recipientMatches(row, canonicalNameSet, target));
    const excludedSubcontractCandidates = subcontractCandidates.filter((row) => !this.recipientMatches(row, canonicalNameSet, target));

    const primeAwardedRevenue = primeAwards.reduce((sum, row) => sum + number(row.amount), 0);
    const subcontractedRevenue = subcontracts.reduce((sum, row) => sum + number(row.amount), 0);
    const federalRevenue = primeAwardedRevenue + subcontractedRevenue;
    const primeAwardCount = primeAwards.length;
    const subcontractAwardCount = subcontracts.length;
    const awardCount = primeAwardCount + subcontractAwardCount;

    const authoritativeForPersistence = identity.authoritativeForPersistence;
    const status = authoritativeForPersistence
      ? "AUTHORITATIVE_AWARD_HISTORY_READ"
      : "AWARD_HISTORY_READ_NAME_FALLBACK_REQUIRES_UEI_RECONCILIATION";

    return {
      ok: true,
      service: "AWARD_HISTORY_TRUTH",
      status,
      generatedAt: new Date().toISOString(),
      governingDefinition: {
        federalRevenue: "PRIME_AWARDED_REVENUE_PLUS_SUBCONTRACTED_REVENUE",
        awardCount: "DISTINCT_PRIME_AWARDS_PLUS_DISTINCT_SUBCONTRACT_AWARDS",
        transactionRule: "MODIFICATIONS_AND_FUNDING_TRANSACTIONS_DO_NOT_INFLATE_DISTINCT_AWARD_COUNT"
      },
      source: {
        name: "USAspending.gov",
        identityAuthority: identity.matchedBy === "SAM_UEI" ? "SAM.gov" : "USAspending.gov",
        apiBase: this.apiBase,
        recipientMatchedBy: identity.matchedBy,
        authoritativeLookupPerformed: true,
        authoritativeForPersistence,
        samIdentityStatus: identity.sam?.status || null,
        requestTimeoutMs: this.requestTimeoutMs
      },
      identity: {
        uei: target,
        requestedCompanyName: companyName || null,
        canonicalNames,
        recipientMatches: identity.canonicalRows.length,
        reconciliationRequired: !authoritativeForPersistence
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
        zeroAwardClassificationPermitted: authoritativeForPersistence,
        warnings: [
          ...(!authoritativeForPersistence ? ["Award history was recovered by exact legal-name fallback and must not overwrite ORION contractor totals until UEI reconciliation is completed."] : []),
          ...(excludedPrimeCandidates.length ? ["Prime award candidates with recipient names outside the confirmed canonical identity set were excluded from revenue and award counts."] : []),
          ...(excludedSubcontractCandidates.length ? ["Subcontract candidates with recipient names or UEIs outside the confirmed canonical identity set were excluded from revenue and award counts pending review."] : [])
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
        allowed: authoritativeForPersistence,
        nextAuthorization: authoritativeForPersistence
          ? "VALIDATE_LIVE_AWARD_HISTORY_BEFORE_PERSISTENCE"
          : "RECONCILE_UEI_BEFORE_PERSISTENCE"
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
