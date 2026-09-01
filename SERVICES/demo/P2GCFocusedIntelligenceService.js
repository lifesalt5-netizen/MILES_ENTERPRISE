"use strict";

const DemoUnifiedOpportunityService = require("./DemoUnifiedOpportunityService");

function clean(value) { return String(value == null ? "" : value).trim(); }
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function uniq(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }

class P2GCFocusedIntelligenceService {
  constructor(options = {}) {
    this.unifiedOpportunities = options.unifiedOpportunityService || new DemoUnifiedOpportunityService();
  }

  normalizeType(type) {
    const value = clean(type).toLowerCase();
    if (["opportunity", "opportunities"].includes(value)) return "opportunities";
    if (["vehicle", "vehicles"].includes(value)) return "vehicles";
    if (["recompete", "recompetes"].includes(value)) return "recompetes";
    return null;
  }

  common(model, type) {
    return {
      ok:true,
      service:"P2GC_FOCUSED_GOVCON_INTELLIGENCE",
      type,
      generatedAt:model.generatedAt,
      prospect:{
        companyName:model.profile?.companyName || null,
        uei:model.profile?.uei || null,
        cage:model.profile?.cage || null,
        headquarters:model.profile?.headquarters || null,
        naicsCodes:list(model.profile?.naicsCodes),
        certifications:list(model.profile?.certifications),
        samStatus:model.profile?.samStatus || null,
        gsaStatus:model.profile?.gsaStatus || null,
        readiness:model.readiness?.overall ?? null
      },
      evidence:model.evidence || null,
      safety:model.safety || { readOnly:true, writesEnabled:false }
    };
  }

  build(type, model) {
    const normalized = this.normalizeType(type);
    if (!normalized) return { ok:false, status:"INTELLIGENCE_TYPE_UNSUPPORTED", supported:["opportunities","vehicles","recompetes"] };
    if (!model?.ok) return model || { ok:false, status:"ASSESSMENT_UNAVAILABLE" };

    const base = this.common(model, normalized);

    if (normalized === "opportunities") {
      const unified = this.unifiedOpportunities.build(model, list(model.opportunities?.publicSourceAdditions));
      return {
        ...base,
        status:unified.status,
        records:unified.records,
        markets:unified.markets,
        totals:unified.totals,
        taxonomy:unified.taxonomy,
        opportunityRules:unified.rules,
        agencies:list(model.agencyAlignment?.agencies),
        recommendations:list(model.recommendations?.opportunity),
        immediateActions:list(model.recommendations?.immediate),
        pathway:model.pathway || null,
        sourceCoverage:model.opportunities?.sourceCoverage || null,
        disclosure:"Unified opportunity intelligence is organized by Federal / SLED / Local market and by Open, RFI, Sources Sought, Presolicitation, Draft, Forecast, Recompete, Recent Similar Award, and Special Notice stage. Login-gated sources are never represented as live; where direct access is unavailable, public award/history evidence is used and labeled."
      };
    }

    if (normalized === "vehicles") {
      const current = list(model.vehicles?.current);
      const recommendations = list(model.vehicles?.recommendations);
      const vehicleGaps = list(model.gaps?.items).filter(item => /vehicle|gsa|schedule|sin|contract/i.test(clean(item)));
      return {
        ...base,
        status:model.vehicles?.status || (current.length ? "CURRENT_VEHICLES_IDENTIFIED" : "NO_CURRENT_VEHICLE_IDENTIFIED"),
        currentVehicles:current,
        recommendations,
        vehicleGaps,
        readiness:model.readiness?.categories?.contractVehicles || null,
        agencies:list(model.agencyAlignment?.agencies),
        disclosure:"Vehicle intelligence reflects evidence and recommendations present in the current prospect assessment. Eligibility and modification requirements must be validated against the applicable vehicle authority before submission."
      };
    }

    const records = list(model.opportunities?.recompetes);
    return {
      ...base,
      status:records.length ? "ORION_RECOMPETE_SIGNALS_AVAILABLE" : "NO_CURRENT_RECOMPETE_SIGNAL",
      records,
      agencies:uniq(records.map(row => row?.agency)),
      opportunityRecommendations:list(model.recommendations?.opportunity),
      partnerRecommendations:list(model.recommendations?.partner),
      currentCapability:{
        expirationSignals:true,
        incumbentIdentity:false,
        dedicatedExpirationAlerts:false
      },
      disclosure:"This focused view exposes current ORION recompete signals. Incumbent identity and dedicated expiration-alert coverage are not claimed unless present in validated source evidence."
    };
  }
}

module.exports = P2GCFocusedIntelligenceService;
