"use strict";

const PrimeCandidateDiscoveryService = require('./PrimeCandidateDiscoveryService');

function num(value) {
  if (value === null || value === undefined || clean(value) === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function arr(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function uniq(values) { return [...new Set(arr(values).filter(Boolean))]; }
function clean(value) { return String(value == null ? '' : value).trim(); }
function norm(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }

function capabilityGroup(naics, text = '') {
  const code = clean(naics).replace(/\D/g,'');
  const t = norm(text);
  if (/^11/.test(code) || /AGRICULT|FARM|FOOD|PRODUCE|FRUIT|VEGETABLE|BEAN|GRAIN/.test(t)) return 'AGRICULTURE_FOOD';
  if (/^42|^44|^45/.test(code) || /WHOLESALE|DISTRIBUT|SUPPLY|COMMODIT/.test(t)) return 'WHOLESALE_DISTRIBUTION';
  if (/^48|^49/.test(code) || /TRANSPORT|LOGISTIC|WAREHOUS|DELIVERY|FREIGHT/.test(t)) return 'TRANSPORT_LOGISTICS';
  if (/^51|^5415/.test(code) || /SOFTWARE|INFORMATION TECHNOLOGY|\bIT\b|CYBER|DATA|COMPUT|NETWORK|SYSTEM/.test(t)) return 'IT_TECHNOLOGY';
  if (/^5416|^5413|^5417|^5419/.test(code) || /CONSULT|PROFESSIONAL|ENGINEER|RESEARCH|MANAGEMENT/.test(t)) return 'PROFESSIONAL_SERVICES';
  if (/^61/.test(code) || /TRAIN|EDUCAT|INSTRUCTION|LEARNING/.test(t)) return 'TRAINING_EDUCATION';
  if (/^62/.test(code) || /HEALTH|MEDICAL|CLINIC|HOSPITAL/.test(t)) return 'HEALTHCARE';
  if (/^23/.test(code) || /CONSTRUCT|BUILD|FACILIT|RENOVAT/.test(t)) return 'CONSTRUCTION_FACILITIES';
  if (/^31|^32|^33/.test(code) || /MANUFACTUR|FABRICAT|EQUIPMENT/.test(t)) return 'MANUFACTURING';
  return code ? `NAICS_${code.slice(0,2)}` : 'OTHER';
}

function semanticOpportunityKey(row) {
  const semantic = norm(`${row?.agency}|${row?.title}|${row?.naics}|${row?.dueDate}`);
  if (semantic) return semantic;
  return clean(row?.solicitationNumber || row?.noticeId || row?.id).toUpperCase();
}

function dedupeOpportunities(records) {
  const map = new Map();
  for (const row of arr(records)) {
    const key = semanticOpportunityKey(row);
    if (!key) continue;
    const current = map.get(key);
    if (!current || (num(row?.fitScore) || 0) > (num(current?.fitScore) || 0)) map.set(key, row);
  }
  return [...map.values()];
}

function balancedPreview(records, limit, groupFn) {
  const source = arr(records);
  const max = Math.max(0, Number(limit || 0));
  if (!max || !source.length) return { totalKnown:source.length, visibleCount:0, lockedCount:source.length, visible:[], capabilityGroups:[] };
  const buckets = new Map();
  for (const row of source) {
    const group = clean(groupFn ? groupFn(row) : 'OTHER') || 'OTHER';
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group).push(row);
  }
  for (const rows of buckets.values()) rows.sort((a,b)=>(num(b?.fitScore)||0)-(num(a?.fitScore)||0));
  const visible=[];
  const groups=[...buckets.keys()];
  let round=0;
  while (visible.length < max) {
    let added=false;
    for (const group of groups) {
      const row=buckets.get(group)?.[round];
      if (!row) continue;
      visible.push(row);
      added=true;
      if (visible.length >= max) break;
    }
    if (!added) break;
    round += 1;
  }
  return {
    totalKnown: source.length,
    visibleCount: visible.length,
    lockedCount: Math.max(0, source.length-visible.length),
    visible,
    capabilityGroups: uniq(visible.map(groupFn || (()=>'OTHER')))
  };
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
  const totalValue = Math.max(rows.reduce((sum,row)=>sum+Math.max(0,Number(row.historicalAwardValue||0)),0),1);
  const totalAwards = Math.max(rows.reduce((sum,row)=>sum+Math.max(0,Number(row.awardCount||0)),0),1);
  model.agencyAlignment = {
    status:'CONFIRMED_USASPENDING_HISTORICAL_CONCENTRATION',
    metricLabel:'Historical award concentration',
    agencies:rows.slice(0,10).map(row=>({
      ...row,
      fitScore:null,
      historicalConcentrationPct:Math.round(((row.historicalAwardValue/totalValue)*0.7 + (row.awardCount/totalAwards)*0.3)*100),
      basis:'Confirmed USAspending historical award concentration aggregated by agency for this UEI; this is not a modeled future-fit score.',
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
    if (hasCurrentGsa && /primary growth driver:\s*vehicle gap|vehicle gap contractor|missing vehicle|no contract vehicle|multiple vehicle coverage|activate and expand contract vehicle coverage|expand contract vehicle coverage and activate existing schedules?|activate existing schedules?|close vehicle and agency access gaps/i.test(t)) return true;
    if (!recompetes.length && /prioriti[sz]e .*recompete|recompete\/incumbent|incumbent-displacement signal/i.test(t)) return true;
    if (!samActive && /sam entity appears active|sam active|registration expiration is current|optimi[sz]e sam profile/i.test(t)) return true;
    if (model?.profile?.cage && /cage present|cage.*missing/i.test(t)) return true;
    return false;
  };
  for (const key of ['immediate','vehicle','agency','partner','opportunity','growth']) recommendations[key] = arr(recommendations[key]).filter(item=>!reject(item));
  if (model?.vehicles) model.vehicles.recommendations = arr(model.vehicles.recommendations).filter(item=>!reject(item));
  if (model?.primePartners) model.primePartners.strategy = arr(model.primePartners.strategy).filter(item=>!reject(item));
  if (model?.subcontracting) model.subcontracting.strategy = arr(model.subcontracting.strategy).filter(item=>!reject(item));
  if (model?.gaps) model.gaps.items = arr(model.gaps.items).filter(item=>!reject(item));
  if (hasCurrentGsa) {
    recommendations.vehicle = uniq([...arr(recommendations.vehicle),'Optimize utilization of the confirmed current GSA MAS against validated demand and awarded SIN/category scope.']);
    if (model?.vehicles) model.vehicles.recommendations = uniq([...arr(model.vehicles.recommendations),'Optimize utilization of the confirmed current GSA MAS against validated demand and awarded SIN/category scope.']);
  }
}

function normalizeUnknownRevenue(model) {
  const current = model?.revenue?.current;
  if (!current) return;
  for (const field of ['state','local','commercial']) {
    const status = clean(current[`${field}Status`] || model?.currentState?.[`${field}SalesStatus`]);
    if (current[field] === 0 && !/CONFIRMED|AUTHORITATIVE|ZERO_PERMITTED/i.test(status)) current[field] = null;
  }
  if (model?.currentState?.stateLocalSales === 0 && !/CONFIRMED|AUTHORITATIVE|ZERO_PERMITTED/i.test(clean(model.currentState.stateLocalSalesStatus))) model.currentState.stateLocalSales = null;
}

function enforceEvidenceBackedReadiness(model) {
  const readiness = model?.readiness;
  if (!readiness?.categories) return;
  const categories = { ...readiness.categories };
  delete categories.marketing;
  delete categories.positioning;
  const scored = Object.values(categories).map(category=>num(category?.score)).filter(score=>score!=null);
  model.readiness = { ...readiness, categories, overall:scored.length ? Math.round(scored.reduce((sum,score)=>sum+score,0)/scored.length) : null, methodology:'Evidence-weighted readiness score using only current registrations/vehicle evidence and authoritative award/buyer evidence. Unsupported inherited marketing or positioning scores are withheld rather than treated as verified.' };
}

function reconcileExplicitUnknownSafety(model) {
  const integrity=model?.truthIntegrity;
  if (!integrity) return;
  const blockers=arr(integrity.blockers);
  const conflicts=arr(integrity.conflicts);
  const samUnknown=integrity?.sourceCoverage?.sam!==true && model?.currentState?.samRegistration==null && /UNVERIFIED|UNKNOWN|NOT CONFIRMED/i.test(clean(model?.profile?.samStatus));
  if (!samUnknown || conflicts.length) return;
  const nonSamBlockers=blockers.filter(x=>clean(x)!=='CANONICAL_SOURCE_COVERAGE_SAM_NOT_GREEN');
  if (nonSamBlockers.length) return;
  model.truthIntegrity={ ...integrity, clientSafe:true, status:'CANONICAL_CURRENT_TRUTH_RECONCILED_WITH_EXPLICIT_SAM_UNKNOWN', blockers:[], warnings:uniq([...(integrity.warnings||[]),'Current SAM status is explicitly UNKNOWN/UNVERIFIED and is not inferred from other sources.']) };
  model.status='DEMO_READY_WITH_EXPLICIT_SAM_UNKNOWN';
  model.evidence=model.evidence||{};
  model.evidence.truthIntegrity=model.truthIntegrity;
}

function protectEstablishedAwardeePathway(model) {
  const awardCount = num(model?.awardHistory?.summary?.awardCount ?? model?.currentState?.awardCount);
  if (awardCount == null || awardCount <= 0) return;
  if (!/FIRST[_ -]?ORDER|FIRST[_ -]?AWARD|GSA_ACTIVATION_PATHWAY/i.test(`${model?.pathway?.type||''} ${model?.pathway?.title||''}`)) return;
  model.pathway = {
    type:'FEDERAL_GROWTH_PATHWAY',
    title:'Federal Growth Pathway™',
    steps:['Validate current award and buyer concentration','Optimize utilization of current contract vehicles','Expand into adjacent aligned agencies/buyers','Build prime and teaming relationships','Match current qualified opportunities to demonstrated capability','Strengthen recompete and incumbent-displacement positioning where validated signals exist','Increase sustainable federal obligations']
  };
}

function sumKnown(records, field) {
  let total = 0;
  let known = 0;
  for (const row of arr(records)) {
    const value = num(row?.[field]);
    if (value == null || value <= 0) continue;
    total += value;
    known += 1;
  }
  return { total, known };
}

function buildProofTotals(model) {
  const opportunities = arr(model?.opportunities?.liveAndForecast);
  const oppValue = sumKnown(opportunities, 'estimatedValue');
  const recompetes = arr(model?.opportunities?.recompetes);
  const recompeteValue = sumKnown(recompetes, 'value');
  const buyers = arr(model?.buyerIntelligence?.records);
  const qualification = model?.opportunities?.qualification || model?.opportunityQualification || null;
  return {
    opportunities:{
      total:opportunities.length,
      knownValue:oppValue.total,
      knownValueCount:oppValue.known,
      unknownValueCount:Math.max(0,opportunities.length-oppValue.known),
      directFitSupported:Number(qualification?.directFitSupported ?? opportunities.filter(x=>x.qualificationTier==='DIRECT_FIT_SUPPORTED').length),
      teamingPathSupported:Number(qualification?.teamingPathSupported ?? opportunities.filter(x=>x.qualificationTier==='TEAMING_PATH_SUPPORTED').length),
      nearFitGapClosable:Number(qualification?.nearFitGapClosable ?? opportunities.filter(x=>x.nearFit===true).length),
      capabilityValidationRequired:Number(qualification?.capabilityValidationRequired ?? opportunities.filter(x=>x.qualificationTier==='CAPABILITY_VALIDATION_REQUIRED').length),
      notRecommendedDirectPursuit:Number(qualification?.notRecommendedDirectPursuit ?? opportunities.filter(x=>x.qualificationTier==='NOT_RECOMMENDED_DIRECT_PURSUIT').length),
      recommendationEligible:Number(qualification?.recommendationEligible ?? opportunities.filter(x=>x.recommendationEligible===true).length)
    },
    primePartners:{ total:arr(model?.primePartners?.records).length },
    recompetes:{ total:recompetes.length, knownValue:recompeteValue.total, knownValueCount:recompeteValue.known, unknownValueCount:Math.max(0,recompetes.length-recompeteValue.known) },
    buyers:{ total:buyers.length, agencies:new Set(buyers.map(x=>norm(x?.agency)).filter(Boolean)).size },
    competitors:{ total:arr(model?.competitors?.records).length },
    vehicles:{ total:arr(model?.vehicles?.current).length }
  };
}

class DemoCommercialPreviewService {
  constructor(options = {}) {
    this.previewLimits = {
      opportunities: Number(options.opportunities || 6),
      recompetes: Number(options.recompetes || 4),
      primePartners: Number(options.primePartners || 6),
      buyers: Number(options.buyers || 3),
      competitors: Number(options.competitors || 3),
      vehicles: Number(options.vehicles || 2)
    };
    this.primeDiscovery = options.primeDiscoveryService || new PrimeCandidateDiscoveryService({ rootDir:options.rootDir });
  }

  preview(records, limit) {
    const source = arr(records);
    const visible = source.slice(0, Math.max(0, limit));
    return { totalKnown:source.length, visibleCount:visible.length, lockedCount:Math.max(0,source.length-visible.length), visible };
  }

  derivePrimeCandidates(model) {
    const existing = arr(model?.primePartners?.records);
    if (existing.length) return existing;
    try {
      const discovered=this.primeDiscovery.discover(model,{limit:20});
      if(discovered?.ok&&arr(discovered.records).length){
        model.evidence=model.evidence||{};
        model.evidence.primeCandidateDiscovery={status:discovered.status,source:discovered.source,safety:discovered.safety};
        return discovered.records;
      }
    } catch(error) {
      model.evidence=model.evidence||{};
      model.evidence.primeCandidateDiscovery={status:'PRIME_DISCOVERY_FAILED_CLOSED',error:String(error?.message||error)};
    }
    const prospectRevenue = num(model?.revenue?.current?.federal);
    return arr(model?.competitors?.records)
      .filter(row => row && row.company)
      .filter(row => prospectRevenue == null || num(row.federalRevenue) == null || num(row.federalRevenue) > prospectRevenue)
      .slice(0, 5)
      .map(row => ({ company:row.company, uei:row.uei||null, vehicle:row.vehicle||null, federalRevenue:num(row.federalRevenue), awardCount:num(row.awardCount), agencies:uniq(row.agencies), basis:row.basis||"ORION market-peer model", confidence:row.confidence||"MODELED_CANDIDATE", partnerStatus:"MODELED_PRIME_TEAMING_CANDIDATE", disclosure:"Candidate inferred from federal scale and market-peer alignment. Validate current vehicle, agency, contract and contact evidence before outreach." }));
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
    protectEstablishedAwardeePathway(model);
    enforceEvidenceBackedReadiness(model);
    reconcileExplicitUnknownSafety(model);
  }

  apply(model) {
    if (!model?.ok) return model;
    this.enforceClientTruthBoundary(model);
    const primeRecords = this.derivePrimeCandidates(model);
    if (!arr(model?.primePartners?.records).length && primeRecords.length) {
      model.primePartners = { ...(model.primePartners || {}), status:"MODELED_PRIME_TEAMING_CANDIDATES_AVAILABLE", records:primeRecords, disclosure:"Prime/team candidates are evidence-backed modeled candidates from validated federal award/buyer history where direct teaming evidence is incomplete. Validate current vehicle, capability whitespace and SBLO/contact evidence before outreach." };
    }
    const opportunities = arr(model?.opportunities?.liveAndForecast);
    const primePartners = arr(model?.primePartners?.records);
    const buyers = arr(model?.buyerIntelligence?.records);
    model.commercialPreview = {
      mode:"PROOF_THEN_UNLOCK",
      rule:"Reveal a capability-balanced sample of evidence-backed forward-looking records. Lock only known additional records; never invent hidden inventory. Historical awards remain fully accessible and are not paywalled.",
      truthBoundary:"Discovery is not qualification. Opportunity totals distinguish direct-fit, near-fit, teaming/access, validation-required and not-recommended records. Near-fit records must state the missing requirement and closure path and cannot be represented as missed revenue or direct-pursuit qualified. USAspending performance-period award counts remain visible in Award & Contract History but are not relabeled as active contracts. Unknown non-federal revenue is not rendered as zero. Restricted set-aside opportunities fail closed on direct-pursuit eligibility until the matching certification is confirmed. Unsupported inherited readiness categories and stale or contradicted recommendations are suppressed after canonical truth hydration. Prime/team candidates are modeled only from validated award/buyer evidence and are not represented as confirmed relationships. Opportunity and recompete dollar totals include only positive published/known values; absent or zero-like placeholders are treated as undisclosed. Semantic duplicates are collapsed before preview counts are calculated. Historical agency metrics are presented as historical concentration, never as future-fit percentages.",
      totals:buildProofTotals(model),
      opportunities: balancedPreview(opportunities, this.previewLimits.opportunities, row=>capabilityGroup(row?.naics, `${row?.title||''} ${row?.qualification||''}`)),
      recompetes: balancedPreview(model?.opportunities?.recompetes, this.previewLimits.recompetes, row=>capabilityGroup(row?.naics, `${row?.title||''} ${row?.agency||''}`)),
      primePartners: balancedPreview(primePartners, this.previewLimits.primePartners, row=>capabilityGroup(arr(row?.matchedNaics)[0], `${row?.basis||''} ${row?.company||''}`)),
      buyers: balancedPreview(buyers, this.previewLimits.buyers, row=>norm(row?.agency)||'OTHER'),
      competitors: this.preview(model?.competitors?.records, this.previewLimits.competitors),
      vehicles: this.preview(model?.vehicles?.current, this.previewLimits.vehicles),
      cta:"Unlock the full company-specific growth intelligence with P2GC."
    };
    return model;
  }
}

module.exports = DemoCommercialPreviewService;
module.exports.helpers = { capabilityGroup, semanticOpportunityKey, dedupeOpportunities, balancedPreview, applySetAsideEligibility, consolidateAgencyAlignment, scrubRecommendations, normalizeUnknownRevenue, enforceEvidenceBackedReadiness, reconcileExplicitUnknownSafety, protectEstablishedAwardeePathway, buildProofTotals };
