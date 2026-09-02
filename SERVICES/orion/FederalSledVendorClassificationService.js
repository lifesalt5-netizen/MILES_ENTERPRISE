"use strict";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeState(value) {
  return clean(value).toUpperCase();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function first(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && clean(row[key]) !== "") return row[key];
  }
  return null;
}

function boolean(value) {
  if (value === true || value === 1) return true;
  const normalized = clean(value).toUpperCase();
  return ["TRUE", "YES", "Y", "1", "AWARDED", "CONFIRMED"].includes(normalized);
}

class FederalSledVendorClassificationService {
  constructor(options = {}) {
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
  }

  normalizeStateRow(row = {}, source = {}) {
    const state = normalizeState(first(row, ["award_state", "state", "source_state"]) || source.state);
    const company = clean(first(row, ["company", "vendor_name", "vendor", "legal_name", "business_name", "name"]));
    const uei = clean(first(row, ["uei", "uei_sam", "ueiSAM"])).toUpperCase();
    const email = clean(first(row, ["email", "contact_email", "vendor_email"])).toLowerCase();
    const awardId = clean(first(row, ["award_id", "contract_id", "po_number", "purchase_order", "solicitation_id"]));
    const awardDate = clean(first(row, ["award_date", "contract_date", "po_date", "date"]));
    const amount = number(first(row, ["award_amount", "amount", "contract_amount", "spend", "sales"]));
    const explicitAward = boolean(first(row, ["award_confirmed", "has_award", "awarded"]));
    const recordType = clean(first(row, ["record_type", "type"]) || source.recordType).toUpperCase();
    const confirmedAward = explicitAward || Boolean(awardId) || recordType === "AWARD";

    return {
      company,
      companyNorm: normalizeName(company),
      uei,
      email,
      state,
      awardId,
      awardDate,
      amount,
      confirmedAward,
      recordType: confirmedAward ? "AWARD" : "VENDOR",
      sourceName: clean(source.name || source.source || first(row, ["source", "source_name"])),
      sourcePath: clean(source.path || first(row, ["source_path", "file"])),
      raw: row
    };
  }

  identityKey(row) {
    if (row.uei) return `UEI|${row.uei}`;
    if (row.companyNorm) return `NAME|${row.companyNorm}`;
    return null;
  }

  awardKey(row) {
    if (!row.confirmedAward) return null;
    if (row.awardId) return `${row.state}|${row.awardId}`;
    return [row.state, row.companyNorm, row.awardDate, row.amount, row.sourceName].join("|");
  }

  mergeStateRows(entries = []) {
    const vendors = new Map();

    for (const entry of entries) {
      const source = entry?.source || {};
      const rows = Array.isArray(entry?.rows) ? entry.rows : [];
      for (const raw of rows) {
        const row = this.normalizeStateRow(raw, source);
        const key = this.identityKey(row);
        if (!key || !row.companyNorm) continue;

        let vendor = vendors.get(key);
        if (!vendor) {
          vendor = {
            identityKey: key,
            company: row.company,
            companyNorm: row.companyNorm,
            uei: row.uei || null,
            emails: new Set(),
            vendorStates: new Set(),
            awards: new Map(),
            sources: new Set()
          };
          vendors.set(key, vendor);
        }

        if (!vendor.uei && row.uei) vendor.uei = row.uei;
        if (row.email) vendor.emails.add(row.email);
        if (row.state) vendor.vendorStates.add(row.state);
        if (row.sourceName || row.sourcePath) vendor.sources.add(`${row.sourceName}|${row.sourcePath}`);

        const awardKey = this.awardKey(row);
        if (awardKey && !vendor.awards.has(awardKey)) vendor.awards.set(awardKey, row);
      }
    }

    return [...vendors.values()].map((vendor) => {
      const awards = [...vendor.awards.values()];
      const stateMap = new Map();
      for (const award of awards) {
        const state = award.state || "UNKNOWN";
        const current = stateMap.get(state) || { state, revenue: 0, awardCount: 0 };
        current.revenue += number(award.amount);
        current.awardCount += 1;
        stateMap.set(state, current);
      }

      return {
        identityKey: vendor.identityKey,
        company: vendor.company,
        companyNorm: vendor.companyNorm,
        uei: vendor.uei,
        email: [...vendor.emails][0] || null,
        emails: [...vendor.emails],
        vendorStates: [...vendor.vendorStates].sort(),
        sledStates: [...stateMap.keys()].filter((state) => state !== "UNKNOWN").sort(),
        sledStateCount: [...stateMap.keys()].filter((state) => state !== "UNKNOWN").length,
        sledRevenue: awards.reduce((sum, award) => sum + number(award.amount), 0),
        sledAwardCount: awards.length,
        sledAwards: awards.map((award) => ({
          state: award.state,
          awardId: award.awardId || null,
          awardDate: award.awardDate || null,
          amount: number(award.amount),
          sourceName: award.sourceName || null,
          sourcePath: award.sourcePath || null
        })),
        sledByState: [...stateMap.values()].sort((a, b) => a.state.localeCompare(b.state)),
        sources: [...vendor.sources].filter(Boolean).sort()
      };
    });
  }

  federalSummary(audit = null) {
    const authoritative = Boolean(
      audit?.ok === true &&
      audit?.status === "AUTHORITATIVE_AWARD_HISTORY_READ" &&
      audit?.source?.authoritativeForPersistence === true &&
      audit?.identity?.reconciliationRequired === false
    );

    const summary = audit?.summary || {};
    const primeRevenue = number(summary.primeAwardedRevenue);
    const subcontractRevenue = number(summary.subcontractedRevenue);
    const primeAwardCount = number(summary.primeAwardCount);
    const subcontractAwardCount = number(summary.subcontractAwardCount);

    return {
      authoritative,
      status: authoritative ? "AUTHORITATIVE" : "UNCONFIRMED",
      federalPrimeRevenue: primeRevenue,
      federalSubcontractRevenue: subcontractRevenue,
      federalRevenue: primeRevenue + subcontractRevenue,
      federalPrimeAwardCount: primeAwardCount,
      federalSubcontractAwardCount: subcontractAwardCount,
      federalAwardCount: primeAwardCount + subcontractAwardCount,
      federalRole: primeAwardCount > 0 && subcontractAwardCount > 0
        ? "PRIME_AND_SUBCONTRACTOR"
        : primeAwardCount > 0
          ? "PRIME"
          : subcontractAwardCount > 0
            ? "SUBCONTRACTOR"
            : authoritative
              ? "NONE"
              : "UNCONFIRMED"
    };
  }

  classify(stateVendor, federalAudit = null) {
    const federal = this.federalSummary(federalAudit);
    const hasSledAwards = number(stateVendor?.sledAwardCount) > 0;
    const hasFederalAwards = federal.federalAwardCount > 0;
    const isStateVendor = Array.isArray(stateVendor?.vendorStates) && stateVendor.vendorStates.length > 0;

    let governmentMarket = "UNCONFIRMED";
    if (federal.authoritative) {
      if (hasFederalAwards && hasSledAwards) governmentMarket = "FED_AND_SLED";
      else if (hasFederalAwards) governmentMarket = "FED_ONLY";
      else if (hasSledAwards) governmentMarket = "SLED_ONLY";
      else if (isStateVendor) governmentMarket = "STATE_VENDOR_ONLY";
      else governmentMarket = "ZERO_GOVERNMENT_SALES";
    }

    const email = clean(stateVendor?.email).toLowerCase() || null;
    const marketableSledToFederal = governmentMarket === "SLED_ONLY" && Boolean(email);

    return {
      generatedAt: this.generatedAt(),
      company: stateVendor?.company || federalAudit?.identity?.canonicalNames?.[0] || null,
      uei: stateVendor?.uei || federalAudit?.identity?.uei || null,
      email,
      governmentMarket,
      federal,
      sled: {
        role: hasSledAwards ? "PRIME" : "NONE",
        revenue: number(stateVendor?.sledRevenue),
        awardCount: number(stateVendor?.sledAwardCount),
        states: Array.isArray(stateVendor?.sledStates) ? stateVendor.sledStates : [],
        stateCount: number(stateVendor?.sledStateCount),
        byState: Array.isArray(stateVendor?.sledByState) ? stateVendor.sledByState : [],
        vendorStates: Array.isArray(stateVendor?.vendorStates) ? stateVendor.vendorStates : []
      },
      segmentation: {
        eligible: federal.authoritative,
        primarySegment: governmentMarket,
        marketingRoute: marketableSledToFederal ? "SLED_TO_FEDERAL" : null,
        marketable: marketableSledToFederal,
        reason: marketableSledToFederal
          ? "CONFIRMED_STATE_PRIME_AWARDS_AND_ZERO_FEDERAL_PRIME_OR_SUBCONTRACT_AWARDS_WITH_EMAIL"
          : governmentMarket === "SLED_ONLY"
            ? "EMAIL_REQUIRED_FOR_OUTREACH"
            : federal.authoritative
              ? "NOT_SLED_ONLY"
              : "FEDERAL_IDENTITY_OR_AWARD_HISTORY_NOT_AUTHORITATIVE"
      },
      evidence: {
        federalIdentityConfirmed: federal.authoritative,
        federalZeroSalesConfirmed: federal.authoritative && federal.federalAwardCount === 0,
        stateAwardEvidenceCount: number(stateVendor?.sledAwardCount),
        stateVendorListStates: Array.isArray(stateVendor?.vendorStates) ? stateVendor.vendorStates : []
      }
    };
  }
}

module.exports = FederalSledVendorClassificationService;
