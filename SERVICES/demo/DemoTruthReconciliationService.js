"use strict";

// Runtime policy: canonical company evidence (award history + current vehicle truth) must
// hydrate before opportunity qualification. This patch is installed here because this
// reconciliation module loads before the canonical service in both the live server and
// the governed readiness audit, keeping both execution paths on the same semantics.
const CanonicalBase = require('./ExecutiveBlueprintCanonicalTruthService');
const EvidenceFirstCanonical = require('./EvidenceFirstExecutiveBlueprintCanonicalTruthService');
CanonicalBase.prototype.hydrate = EvidenceFirstCanonical.prototype.hydrate;

function clean(value) { return String(value == null ? "" : value).trim(); }
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function uniq(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function isPositiveNumber(value) { const n = Number(value); return Number.isFinite(n) && n > 0; }
function explicitZero(value) { return value === 0 || value === "0" || value === "0.0"; }
function vehicleEvidence(values) { return list(values).some(v => /\b(GSA|MAS|MULTIPLE AWARD SCHEDULE|GWAC|IDIQ|BPA|SEWP|CIO-SP|OASIS|STARS)\b/i.test(clean(v))); }
function affirmativeSam(value) { return /^(A|ACTIVE|Y|YES|TRUE|1)$/i.test(clean(value)); }
function negativeSam(value) { return /^(INACTIVE|EXPIRED|N|NO|FALSE|0)$/i.test(clean(value)); }

function filterRecommendations(items, facts) {
  return list(items).filter(item => {
    const text = clean(item);
    if (!facts.hasVehicles && /\b(existing|current)\s+(contract\s+)?vehicles?\b|increase utilization of existing vehicles|map existing vehicles/i.test(text)) return false;
    if (!facts.hasBuyers && /diversif(y|ication).*buyer.*concentration|current concentration|agency dependency/i.test(text)) return false;
    if (!facts.samActiveConfirmed && /optimi[sz]e sam profile|sam active/i.test(text)) return false;
    return true;
  });
}

class DemoTruthReconciliationService {
  reconcile(model = {}) {
    if (!model || model.ok !== true) return model;

    const out = JSON.parse(JSON.stringify(model));
    const profile = out.profile || (out.profile = {});
    const state = out.currentState || (out.currentState = {});
    const revenue = out.revenue || (out.revenue = { current: {}, opportunity: {} });
    revenue.current = revenue.current || {};
    revenue.opportunity = revenue.opportunity || {};

    const conflicts = [];
    const warnings = [];
    const vehicles = uniq([...(list(profile.contractVehicles)), ...(list(state.contractVehicles)), ...(list(out.vehicles?.current))]);
    const hasVehicles = vehicles.length > 0;
    const hasBuyers = list(state.agencyRelationships).length > 0 || list(out.buyerIntelligence?.records).length > 0 || list(out.agencyAlignment?.agencies).length > 0;

    const samText = clean(profile.samStatus);
    const samActiveConfirmed = affirmativeSam(samText);
    const samInactiveConfirmed = negativeSam(samText);
    const originalSamState = state.samRegistration;
    state.samRegistration = samActiveConfirmed ? true : samInactiveConfirmed ? false : null;
    if (samActiveConfirmed && originalSamState === false) conflicts.push("SAM_STATUS_CONTRADICTION");

    profile.contractVehicles = vehicles;
    state.contractVehicles = vehicles;
    if (out.vehicles) out.vehicles.current = vehicles;

    const gsaInVehicles = vehicles.some(v => /\b(GSA|MAS|MULTIPLE AWARD SCHEDULE)\b/i.test(v));
    if (gsaInVehicles) profile.gsaStatus = "IDENTIFIED";
    else if (/^NOT IDENTIFIED/i.test(clean(profile.gsaStatus))) profile.gsaStatus = "NOT CONFIRMED FROM CURRENT EVIDENCE";

    const oldActiveContracts = state.activeContracts;
    const hasExplicitAwardCountValue = oldActiveContracts !== null && oldActiveContracts !== undefined && clean(oldActiveContracts) !== "";
    const awardCount = hasExplicitAwardCountValue && Number.isFinite(Number(oldActiveContracts)) ? Number(oldActiveContracts) : null;
    state.awardCount = awardCount;
    state.activeContracts = null;
    state.activeContractsStatus = "NOT_DERIVED_FROM_AWARD_COUNT";
    if (awardCount != null) warnings.push("Award count is historical award evidence and is not represented as active contracts without active-status proof.");

    const currentFederal = revenue.current.federal;
    const hasHistoricalAwardEvidence = isPositiveNumber(awardCount) || list(out.buyerIntelligence?.records).some(r => isPositiveNumber(r.awardCount) || isPositiveNumber(r.spend));
    const zeroFederal = explicitZero(currentFederal) || explicitZero(state.federalSales);
    if (zeroFederal && hasHistoricalAwardEvidence && !hasBuyers) {
      conflicts.push("FEDERAL_REVENUE_ZERO_WITH_AWARD_HISTORY_BUT_NO_RECONCILED_BUYER_HISTORY");
      revenue.current.federal = null;
      state.federalSales = null;
      revenue.opportunity = {
        ...revenue.opportunity,
        status: "BLOCKED_PENDING_REVENUE_RECONCILIATION",
        currentFederalRevenue: null,
        modeledPotentialFederalRevenue: null,
        modeledGrowthOpportunity: null,
        disclosure: "Revenue modeling is withheld until federal award/revenue history is reconciled from authoritative evidence."
      };
    } else {
      state.federalSales = revenue.current.federal == null ? null : revenue.current.federal;
    }

    if (!hasVehicles) {
      warnings.push("No current contract vehicle is confirmed; vehicle optimization advice requiring an existing vehicle is suppressed.");
      if (out.vehicles) out.vehicles.status = "VEHICLE_STATUS_UNCONFIRMED";
    }
    if (!hasBuyers) warnings.push("No reconciled buyer history is available; concentration/dependency claims are suppressed.");

    const facts = { hasVehicles, hasBuyers, samActiveConfirmed };
    if (out.recommendations) {
      for (const key of ["immediate", "vehicle", "agency", "partner", "opportunity", "growth"]) {
        out.recommendations[key] = filterRecommendations(out.recommendations[key], facts);
      }
    }
    if (out.vehicles) out.vehicles.recommendations = filterRecommendations(out.vehicles.recommendations, facts);
    if (out.primePartners) out.primePartners.strategy = filterRecommendations(out.primePartners.strategy, facts);
    if (out.subcontracting) out.subcontracting.strategy = filterRecommendations(out.subcontracting.strategy, facts);

    if (!hasBuyers && out.readiness?.categories?.relationships) {
      out.readiness.categories.relationships.evidence = [];
    }

    const gaps = list(out.gaps?.items).filter(item => {
      const text = clean(item);
      if (samActiveConfirmed && /sam entity appears active|sam active|registration expiration is current/i.test(text)) return false;
      if (!hasVehicles && /increase utilization of existing vehicles|map existing vehicles/i.test(text)) return false;
      return true;
    });
    if (out.gaps) out.gaps.items = uniq(gaps);

    out.truthIntegrity = {
      status: conflicts.length ? "CONFLICTED_REVIEW_REQUIRED" : "RECONCILED_FROM_AVAILABLE_EVIDENCE",
      clientSafe: conflicts.length === 0,
      conflicts: uniq(conflicts),
      warnings: uniq(warnings),
      rules: [
        "UNKNOWN_IS_NOT_ZERO_OR_NONE",
        "AWARD_COUNT_IS_NOT_ACTIVE_CONTRACT_COUNT",
        "NO_EXISTING_VEHICLE_ADVICE_WITHOUT_VEHICLE_EVIDENCE",
        "NO_BUYER_CONCENTRATION_CLAIM_WITHOUT_BUYER_HISTORY",
        "CONFLICTED_REVENUE_BLOCKS_REVENUE_MODEL",
        "COMPANY_EVIDENCE_HYDRATES_BEFORE_OPPORTUNITY_QUALIFICATION"
      ],
      reconciledAt: new Date().toISOString()
    };

    if (conflicts.length) out.status = "DEMO_REVIEW_REQUIRED";
    out.evidence = out.evidence || {};
    out.evidence.truthIntegrity = out.truthIntegrity;
    return out;
  }
}

module.exports = DemoTruthReconciliationService;
module.exports.filterRecommendations = filterRecommendations;
