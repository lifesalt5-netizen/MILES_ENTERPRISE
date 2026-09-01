"use strict";

const AwardHistoryTruthService = require("../orion/AwardHistoryTruthService");

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function clean(value) { return String(value == null ? "" : value).trim(); }
function activeOn(endDate, now = new Date()) {
  if (!endDate) return false;
  const d = new Date(endDate);
  return !Number.isNaN(d.getTime()) && d >= now;
}
function aggregateBuyers(primeAwards = []) {
  const map = new Map();
  for (const row of primeAwards) {
    const agency = clean(row.awardingAgency) || "Unknown agency";
    const office = clean(row.awardingSubAgency) || null;
    const key = `${agency}|${office || ""}`;
    const current = map.get(key) || { agency, buyer:office, spend:0, awardCount:0 };
    current.spend += Number(row.amount || 0);
    current.awardCount += 1;
    map.set(key, current);
  }
  return [...map.values()].sort((a,b) => b.spend - a.spend || b.awardCount - a.awardCount);
}
function buildAgencyAlignment(buyers = []) {
  if (!buyers.length) return { status:"UNAVAILABLE", agencies:[] };
  const maxSpend = Math.max(...buyers.map(x => Number(x.spend || 0)), 1);
  const maxAwards = Math.max(...buyers.map(x => Number(x.awardCount || 0)), 1);
  return {
    status:"AUTHORITATIVE_USASPENDING_BUYER_ALIGNMENT",
    agencies:buyers.slice(0,10).map(x => ({
      agency:x.agency,
      fitScore:Math.round(((0.7 * (Number(x.spend || 0) / maxSpend)) + (0.3 * (Number(x.awardCount || 0) / maxAwards))) * 100),
      historicalSpend:Number(x.spend || 0),
      awardCount:Number(x.awardCount || 0),
      basis:"Authoritative USAspending prime-award history"
    }))
  };
}

class DemoAuthoritativeAwardOverlayService {
  constructor(options = {}) {
    this.awards = options.awardHistoryService || new AwardHistoryTruthService({
      requestTimeoutMs:Number(process.env.MILES_DEMO_AWARD_TIMEOUT_MS || 20000)
    });
  }

  async overlay(model, options = {}) {
    if (!model?.ok) return model;
    const uei = clean(model.profile?.uei);
    if (!uei) {
      return { ...model, authoritativeAwardOverlay:{ status:"UNAVAILABLE_NO_UEI", applied:false } };
    }

    let audit;
    try {
      audit = await this.awards.auditByUei(uei, {
        companyName:model.profile?.companyName,
        pageSize:Math.max(1, Math.min(Number(options.pageSize) || 50, 100)),
        maxPages:Math.max(1, Math.min(Number(options.maxPages) || 3, 20))
      });
    } catch (error) {
      return { ...model, authoritativeAwardOverlay:{ status:"LOOKUP_UNAVAILABLE", applied:false, error:error.message } };
    }

    if (!audit?.ok || audit.source?.authoritativeForPersistence !== true) {
      return {
        ...model,
        authoritativeAwardOverlay:{
          status:audit?.status || "LOOKUP_NOT_AUTHORITATIVE",
          applied:false,
          identity:audit?.identity || null,
          dataQuality:audit?.dataQuality || null
        }
      };
    }

    const summary = audit.summary || {};
    const primeAwards = Array.isArray(audit.primeAwards) ? audit.primeAwards : [];
    const subcontracts = Array.isArray(audit.subcontracts) ? audit.subcontracts : [];
    const federalRevenue = numberOrNull(summary.federalRevenue);
    const awardCount = numberOrNull(summary.awardCount);
    const activePrimeAwards = primeAwards.filter(x => activeOn(x.endDate));
    const buyers = aggregateBuyers(primeAwards);
    const agencies = [...new Set(buyers.map(x => x.agency).filter(Boolean))];

    const next = JSON.parse(JSON.stringify(model));
    next.currentState = next.currentState || {};
    next.currentState.federalSales = federalRevenue;
    next.currentState.federalAwardCount = awardCount;
    next.currentState.activeContracts = activePrimeAwards.length;
    next.currentState.agencyRelationships = agencies;

    next.revenue = next.revenue || { current:{}, opportunity:{} };
    next.revenue.current = next.revenue.current || {};
    next.revenue.current.federal = federalRevenue;
    if (next.revenue.opportunity) {
      next.revenue.opportunity.currentFederalRevenue = federalRevenue;
      if (next.revenue.opportunity.modeledGrowthOpportunity != null && federalRevenue != null) {
        next.revenue.opportunity.modeledPotentialFederalRevenue = federalRevenue + Number(next.revenue.opportunity.modeledGrowthOpportunity || 0);
      }
      next.revenue.opportunity.disclosure = `${clean(next.revenue.opportunity.disclosure)} Current federal revenue baseline reconciled from authoritative USAspending prime + subcontract award history.`.trim();
    }

    next.buyerIntelligence = {
      status:buyers.length ? "AUTHORITATIVE_USASPENDING_BUYER_HISTORY" : "AUTHORITATIVE_NO_PRIME_BUYER_HISTORY",
      records:buyers.slice(0,10)
    };
    next.agencyAlignment = buildAgencyAlignment(buyers);
    next.awardHistory = {
      status:audit.status,
      federalRevenue,
      awardCount,
      primeAwardedRevenue:numberOrNull(summary.primeAwardedRevenue),
      primeAwardCount:numberOrNull(summary.primeAwardCount),
      subcontractedRevenue:numberOrNull(summary.subcontractedRevenue),
      subcontractAwardCount:numberOrNull(summary.subcontractAwardCount),
      activePrimeAwardCount:activePrimeAwards.length,
      primeAwards:primeAwards.slice(0,20),
      subcontracts:subcontracts.slice(0,20),
      source:audit.source,
      generatedAt:audit.generatedAt,
      dataQuality:audit.dataQuality
    };

    next.evidence = next.evidence || {};
    next.evidence.authoritativeAwards = {
      source:"USAspending.gov",
      identityAuthority:audit.source?.identityAuthority || null,
      recipientMatchedBy:audit.source?.recipientMatchedBy || null,
      authoritativeForPersistence:true,
      generatedAt:audit.generatedAt,
      governingDefinition:audit.governingDefinition
    };
    next.authoritativeAwardOverlay = { status:"APPLIED", applied:true, generatedAt:audit.generatedAt };
    if (next.truthIntegrity) next.truthIntegrity.authoritativeAwardOverlayApplied = true;
    return next;
  }
}

module.exports = DemoAuthoritativeAwardOverlayService;
