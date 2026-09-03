"use strict";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function arr(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function uniq(values) { return [...new Set(arr(values).filter(Boolean))]; }
function clean(value) { return String(value == null ? '' : value).trim(); }
function norm(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }

function dedupeOpportunities(records) {
  const map = new Map();
  for (const row of arr(records)) {
    const key = clean(row?.noticeId || row?.id || row?.solicitationNumber).toUpperCase() || norm(`${row?.agency}|${row?.title}|${row?.dueDate}`);
    if (!key) continue;
    const current = map.get(key);
    if (!current || (num(row?.fitScore) || 0) > (num(current?.fitScore) || 0)) map.set(key, row);
  }
  return [...map.values()];
}

function applySetAsideEligibility(model) {
  if (!model?.opportunities) return;
  const certText = norm([
    ...arr(model?.profile?.certifications),
    ...arr(model?.currentState?.certifications),
    model?.profile?.smallBusinessStatus,
    model?.currentState?.smallBusinessStatus
  ].filter(Boolean).join(' '));
  const checks = [
    { name:'SDVOSB', setAside:/SERVICE DISABLED VETERAN|\bSDVOSB\b/, cert:/SERVICE DISABLED VETERAN|\bSDVOSB\b/ },
    { name:'EDWOSB', setAside:/ECONOMICALLY DISADVANTAGED WOMEN OWNED|\bEDWOSB\b/, cert:/ECONOMICALLY DISADVANTAGED WOMEN OWNED|\bEDWOSB\b/ },
    { name:'WOSB', setAside:/WOMEN OWNED SMALL BUSINESS|\bWOSB\b/, cert:/WOMEN OWNED SMALL BUSINESS|\bWOSB\b/ },
    { name:'8(a)', setAside:/\b8\s*A\b|8\(A\)/, cert:/\b8\s*A\b|8\(A\)/ },
    { name:'HUBZone', setAside:/HUBZONE/, cert:/HUBZONE/ }
  ];
  model.opportunities.liveAndForecast = arr(model.opportunities.liveAndForecast).map(row => {
    const setAside = norm(row?.setAside);
    if (!setAside) return row;
    for (const check of checks) {
      if (!check.setAside.test(setAside)) continue;
      if (check.cert.test(certText)) return { ...row, directPursuitEligible:true, eligibilityStatus:`${check.name.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}_ELIGIBILITY_CONFIRMED_FROM_PROFILE` };
      return {
        ...row,
        directPursuitEligible:false,
        eligibilityStatus:'SET_ASIDE_ELIGIBILITY_NOT_CONFIRMED',
        eligibilityBlocker:`${check.name} set-aside requires current certification evidence before direct pursuit.`,
        fitScore:Math.min(num(row?.fitScore) == null ? 49 : num(row.fitScore),49),
        qualification:[clean(row?.qualification), `${check.name} direct-pursuit eligibility is not confirmed; teaming may still be evaluated separately.`].filter(Boolean).join('; '),
        confidence:'CURRENT_PUBLIC_SOURCE_MATCH_WITH_ELIGIBILITY_BLOCKER'
      };
    }
    return row;
  });
}

function consolidateAgencyAlignment(model) {
  const buyers = arr(model?.buyerIntelligence?.records);
  if (!buyers.length) return;
  const grouped = new Map();
  for (const row of buyers) {
    const agency = clean(row?.agency) || 'Agency unavailable';
    const key = norm(agency);
    const current = grouped.get(key) || { agency, historicalAwardValue:0, awardCount:0 };
    current.historicalAwardValue += Number(row?.historicalAwardValue || row?.spend || 0);
    current.awardCount += Number(row?.awardCount || 0);
    grouped.set(key, current);
  }
  const rows = [...grouped.values()].sort((a,b)=>b.historicalAwardValue-a.historicalAwardValue || b.awardCount-a.awardCount);
  const maxValue = Math.max(...rows.map(x=>x.historicalAwardValue),1);
  const maxAwards = Math.max(...rows.map(x=>x.awardCount),1);
  model.agencyAlignment = {
    status:'CONFIRMED_USASPENDING_HISTORICAL_ALIGNMENT',
    agencies:rows.slice(0,10).map(row=>({
      ...row,
      fitScore:Math.round(((row.historicalAwardValue/maxValue)*0.7 + (row.awardCount/maxAwards)*0.3)*100),
      basis:'Confirmed USAspending award history aggregated by agency for this UEI',
      confidence:'CONFIRMED_HISTORICAL_BUYER'
    }))
  };
}

function scrubRecommendations(model) {
  const recommendations = model?.recommendations;
  if (!recommendations) return;
  const hasCurrentGsa = model?.profile?.gsaHolderVerified === true || /CURRENT GSA MAS HOLDER/i.test(clean(model?.profile?.gsaStatus));
  const revenueModeled = model?.revenue?.opportunity?.modeledPotentialFederalRevenue != null || model?.revenue?.opportunity?.modeledGrowthOpportunity != null;
  const recompetes = arr(model?.opportunities?.recompetes);
  const samActive = model?.currentState?.samRegistration === true || /^ACTIVE$/i.test(clean(model?.profile?.samStatus));

  const reject = text => {
    const t = clean(text);
    if (!revenueModeled && /revenue leakage|modeled (potential )?revenue|commercial pain point.*\$/i.test(t)) return true;
    if (hasCurrentGsa && /primary growth driver:\s*vehicle gap|vehicle gap contractor|missing vehicle|no contract vehicle/i.test(t)) return true;
    if (!recompetes.length && /prioriti[sz]e .*recompete|recompete\/incumbent|incumbent-displacement signal/i.test(t)) return true;
    if (!samActive && /sam entity appears active|sam active|registration expiration is current|optimi[sz]e sam profile/i.test(t)) return true;
    return false;
  };

  for (const key of ['immediate','vehicle','agency','partner','opportunity','growth']) {
    recommendations[key] = arr(recommendations[key]).filter(item=>!reject(item));
  }
  if (model?.vehicles) model.vehicles.recommendations = arr(model.vehicles.recommendations).filter(item=>!reject(item));
  if (model?.primePartners) model.primePartners.strategy = arr(model.primePartners.strategy).filter(item=>!reject(item));
  if (model?.subcontracting) model.subcontracting.strategy = arr(model.subcontracting.strategy).filter(item=>!reject(item));
  if (model?.gaps) model.gaps.items = arr(model.gaps.items).filter(item=>!reject(item));
}

function normalizeUnknownRevenue(model) {
  const current = model?.revenue?.current;
  if (!current) return;
  for (const field of ['state','local','commercial']) {
    const status = clean(current[`${field}Status`] || model?.currentState?.[`${field}SalesStatus`]);
    if (current[field] === 0 && !/CONFIRMED|AUTHORITATIVE|ZERO_PERMITTED/i.test(status)) current[field] = null;
  }
  if (model?.currentState?.stateLocalSales === 0 && !/CONFIRMED|AUTHORITATIVE|ZERO_PERMITTED/i.test(clean(model.currentState.stateLocalSalesStatus))) {
    model.currentState.stateLocalSales = null;
  }
}

function enforceEvidenceBackedReadiness(model) {
  const readiness = model?.readiness;
  if (!readiness?.categories) return;
  const categories = { ...readiness.categories };
  for (const key of ['marketing','positioning']) {
    const category = categories[key];
    const checks = arr(category?.checks);
    const canonicalEvidence = checks.length > 0 && checks.some(check => clean(check?.label));
    if (!canonicalEvidence) delete categories[key];
  }
  const scored = Object.values(categories).map(category=>num(category?.score)).filter(score=>score!=null);
  model.readiness = {
    ...readiness,
    categories,
    overall:scored.length ? Math.round(scored.reduce((sum,score)=>sum+score,0)/scored.length) : null,
    methodology:'Evidence-weighted readiness score using only categories with explicit current checks. Unsupported inherited marketing or positioning scores are withheld rather than treated as verified.'
  };
}

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
    normalizeUnknownRevenue(model);
    if (model?.opportunities) model.opportunities.liveAndForecast = dedupeOpportunities(model.opportunities.liveAndForecast);
    applySetAsideEligibility(model);
    consolidateAgencyAlignment(model);
    scrubRecommendations(model);
    enforceEvidenceBackedReadiness(model);
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
      truthBoundary: "USAspending performance-period award counts remain visible in Award & Contract History but are not relabeled as active contracts. Unknown non-federal revenue is not rendered as zero. Restricted set-aside opportunities fail closed on direct-pursuit eligibility until the matching certification is confirmed. Unsupported inherited readiness categories and stale or contradicted recommendations are suppressed after canonical truth hydration.",
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
module.exports.helpers = { dedupeOpportunities, applySetAsideEligibility, consolidateAgencyAlignment, scrubRecommendations, normalizeUnknownRevenue, enforceEvidenceBackedReadiness };
