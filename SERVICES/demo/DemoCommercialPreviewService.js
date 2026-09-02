"use strict";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function arr(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function uniq(values) { return [...new Set(arr(values).filter(Boolean))]; }

class DemoCommercialPreviewService {
  constructor(options = {}) {
    this.previewLimits = {
      opportunities: Number(options.opportunities || 2),
      recompetes: Number(options.recompetes || 2),
      primePartners: Number(options.primePartners || 2),
      buyers: Number(options.buyers || 2),
      competitors: Number(options.competitors || 3),
      vehicles: Number(options.vehicles || 2)
    };
  }

  preview(records, limit) {
    const source = arr(records);
    const visible = source.slice(0, Math.max(0, limit));
    return {
      totalKnown: source.length,
      visibleCount: visible.length,
      lockedCount: Math.max(0, source.length - visible.length),
      visible
    };
  }

  derivePrimeCandidates(model) {
    const existing = arr(model?.primePartners?.records);
    if (existing.length) return existing;

    const prospectRevenue = num(model?.revenue?.current?.federal);
    return arr(model?.competitors?.records)
      .filter(row => row && row.company)
      .filter(row => prospectRevenue == null || num(row.federalRevenue) == null || num(row.federalRevenue) > prospectRevenue)
      .slice(0, 5)
      .map(row => ({
        company: row.company,
        uei: row.uei || null,
        vehicle: row.vehicle || null,
        federalRevenue: num(row.federalRevenue),
        awardCount: num(row.awardCount),
        agencies: uniq(row.agencies),
        basis: row.basis || "ORION market-peer model",
        confidence: row.confidence || "MODELED_CANDIDATE",
        partnerStatus: "MODELED_PRIME_TEAMING_CANDIDATE",
        disclosure: "Candidate inferred from federal scale and market-peer alignment. Validate current vehicle, agency, contract and contact evidence before outreach."
      }));
  }

  enforceClientTruthBoundary(model) {
    if (!model?.currentState) return;
    if (model.currentState.activeContractsStatus === 'CONFIRMED_CURRENT_PERFORMANCE_PERIOD_FROM_USASPENDING_DATES') {
      model.currentState.currentPerformancePrimeAwardCount = model.currentState.activeContracts;
      model.currentState.currentPerformancePrimeAwardCountStatus = 'CONFIRMED_FROM_USASPENDING_PERFORMANCE_DATES';
      model.currentState.activeContracts = null;
      model.currentState.activeContractsStatus = 'NOT_DERIVED_FROM_AWARD_COUNT';
      model.currentState.activeContractsLabel = 'Active federal contracts';
    }
  }

  apply(model) {
    if (!model?.ok) return model;

    this.enforceClientTruthBoundary(model);

    const primeRecords = this.derivePrimeCandidates(model);
    if (!arr(model?.primePartners?.records).length && primeRecords.length) {
      model.primePartners = {
        ...(model.primePartners || {}),
        status: "MODELED_PRIME_TEAMING_CANDIDATES_AVAILABLE",
        records: primeRecords,
        disclosure: "Prime/team candidates are modeled from ORION peer intelligence where stronger direct teaming evidence is incomplete. Validate before external reliance."
      };
    }

    model.commercialPreview = {
      mode: "PROOF_THEN_UNLOCK",
      rule: "Reveal a small set of evidence-backed records. Lock only known additional records; never invent hidden inventory.",
      truthBoundary: "USAspending performance-period award counts remain visible in Award & Contract History but are not relabeled as active contracts.",
      opportunities: this.preview(model?.opportunities?.liveAndForecast, this.previewLimits.opportunities),
      recompetes: this.preview(model?.opportunities?.recompetes, this.previewLimits.recompetes),
      primePartners: this.preview(model?.primePartners?.records, this.previewLimits.primePartners),
      buyers: this.preview(model?.buyerIntelligence?.records, this.previewLimits.buyers),
      competitors: this.preview(model?.competitors?.records, this.previewLimits.competitors),
      vehicles: this.preview(model?.vehicles?.current, this.previewLimits.vehicles),
      cta: "Unlock the full company-specific growth intelligence with P2GC."
    };
    return model;
  }
}

module.exports = DemoCommercialPreviewService;
