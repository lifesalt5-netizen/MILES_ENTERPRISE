'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const AwardHistoryTruthService = require('../orion/AwardHistoryTruthService');
const CurrentGsaHolderTruthService = require('./CurrentGsaHolderTruthService');
const CurrentPublicOpportunityMatchService = require('./CurrentPublicOpportunityMatchService');

function clean(v) { return String(v == null ? '' : v).trim(); }
function norm(v) { return clean(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function list(v) { return Array.isArray(v) ? v.filter(Boolean) : (v == null || v === '' ? [] : [v]); }
function uniq(values) { return [...new Set(list(values).map(clean).filter(Boolean))]; }
function num(v) { if (v === null || v === undefined || clean(v) === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }
function ageHours(iso, nowMs = Date.now()) { const ms = Date.parse(iso || ''); return Number.isFinite(ms) ? (nowMs - ms) / 3600000 : null; }
function dateOnly(v) { const d = new Date(v || 0); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0,10); }
function scoreCategory(label, checks) {
  const total = checks.reduce((sum, x) => sum + x.weight, 0) || 1;
  const earned = checks.reduce((sum, x) => sum + (x.pass ? x.weight : 0), 0);
  return { label, score:Math.round((earned/total)*100), evidence:checks.filter(x=>x.pass).map(x=>x.label), missing:checks.filter(x=>!x.pass).map(x=>x.label), checks };
}
function stableKey(row, fallbackFields = []) {
  const uei = clean(row?.uei);
  if (uei) return `UEI:${uei.toUpperCase()}`;
  const name = norm(row?.company || row?.legalBusinessName || row?.recipientName);
  if (name) return `NAME:${name}`;
  return norm(fallbackFields.map(k => row?.[k]).join('|'));
}
function dedupeEntities(rows) {
  const map = new Map();
  for (const row of list(rows)) {
    const company = norm(row?.company || row?.legalBusinessName || row?.recipientName);
    if (!company || /DOMESTIC AWARDEES.*UNDISCLOSED|UNDISCLOSED DOMESTIC AWARDEE|MISCELLANEOUS FOREIGN AWARDEES/.test(company)) continue;
    const key = stableKey(row, ['company','federalRevenue','awardCount']);
    if (!key) continue;
    const current = map.get(key);
    if (!current || (num(row?.federalRevenue) || 0) > (num(current?.federalRevenue) || 0)) map.set(key, row);
  }
  return [...map.values()];
}
function dedupeOpportunity(rows) {
  const map = new Map();
  for (const row of list(rows)) {
    const key = clean(row?.noticeId || row?.id || row?.solicitationNumber) || norm(`${row?.agency}|${row?.title}|${row?.dueDate}`);
    if (!key) continue;
    const current = map.get(key);
    if (!current || (num(row?.fitScore) || 0) > (num(current?.fitScore) || 0)) map.set(key,row);
  }
  return [...map.values()];
}
function removeMatching(items, patterns) { return list(items).filter(item => !patterns.some(re => re.test(clean(item)))); }

async function findJsonlExact(file, targetUei) {
  if (!file || !fs.existsSync(file) || !targetUei) return null;
  const target = clean(targetUei).toUpperCase();
  const input = fs.createReadStream(file,{encoding:'utf8'});
  const lines = readline.createInterface({input,crlfDelay:Infinity});
  for await (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (clean(row?.uei).toUpperCase() === target) { lines.close(); input.destroy(); return row; }
  }
  return null;
}

class ExecutiveBlueprintCanonicalTruthService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.awardHistory = options.awardHistoryService || new AwardHistoryTruthService({ requestTimeoutMs:Number(options.awardTimeoutMs || 30000) });
    this.gsa = options.gsaTruthService || new CurrentGsaHolderTruthService({ rootDir:this.rootDir, timeoutMs:Number(options.gsaTimeoutMs || 30000) });
    this.opportunities = options.opportunityService || new CurrentPublicOpportunityMatchService({ rootDir:this.rootDir });
    this.maxAggregateAgeHours = Math.max(24, Number(options.maxAggregateAgeHours || process.env.MILES_AWARD_AGGREGATE_MAX_AGE_HOURS || 72));
    this.now = options.now ? new Date(options.now) : null;
  }

  async aggregateEvidence(uei) {
    const executionPath = path.join(this.rootDir,'DATA','orion_refresh','gsa_execution','latest_gsa_data_execution.json');
    const execution = readJson(executionPath);
    const aggregatePath = execution?.outputPaths?.awardAggregatePath || execution?.results?.awardAggregation?.aggregatePath || null;
    const generatedAt = execution?.results?.awardAggregation?.generatedAt || execution?.completedAt || null;
    const nowMs = (this.now || new Date()).getTime();
    const age = ageHours(generatedAt, nowMs);
    const fresh = Boolean(execution?.results?.awardAggregation?.ok === true && aggregatePath && fs.existsSync(aggregatePath) && age != null && age >= 0 && age <= this.maxAggregateAgeHours);
    if (!fresh) return { ok:false, status:'CURRENT_USASPENDING_OBLIGATION_AGGREGATE_UNAVAILABLE_OR_STALE', row:null, source:{ executionPath, aggregatePath, generatedAt, ageHours:age, maxAgeHours:this.maxAggregateAgeHours, fresh:false } };
    const row = await findJsonlExact(aggregatePath, uei);
    const window = execution?.results?.segmentation?.inputs?.measurementWindow || null;
    return { ok:true, status:row ? 'CURRENT_USASPENDING_OBLIGATION_EVIDENCE_AVAILABLE' : 'NO_OBLIGATION_ROW_FOR_UEI_IN_CURRENT_MEASUREMENT_WINDOW', row, source:{ authority:'USAspending.gov governed staging aggregate', executionPath, aggregatePath, generatedAt, ageHours:age, maxAgeHours:this.maxAggregateAgeHours, fresh:true, measurementWindow:window } };
  }

  async safeAwardHistory(uei, companyName) {
    if (!uei) return { ok:false, status:'UEI_REQUIRED_FOR_AUTHORITATIVE_AWARD_HISTORY', zeroAwardClassificationPermitted:false };
    try {
      return await this.awardHistory.auditByUei(uei,{ companyName, pageSize:100, maxPages:20 });
    } catch (error) {
      return { ok:false, status:'AUTHORITATIVE_AWARD_HISTORY_LOOKUP_FAILED', error:String(error?.message || error), zeroAwardClassificationPermitted:false };
    }
  }

  async safeGsa(uei, companyName) {
    try { return await this.gsa.lookup(uei, companyName); }
    catch (error) { return { ok:false, status:'CURRENT_GSA_HOLDER_LOOKUP_FAILED', holder:null, records:[], limitations:[String(error?.message || error)] }; }
  }

  async safeOpportunities(model) {
    try { return await this.opportunities.match(model,{ limit:30, now:this.now || undefined }); }
    catch (error) { return { ok:false, status:'CURRENT_PUBLIC_OPPORTUNITY_MATCH_FAILED', records:[], blockers:[String(error?.message || error)] }; }
  }

  buildBuyerTruth(award) {
    const groups = new Map();
    for (const row of [...list(award?.primeAwards), ...list(award?.subcontracts)]) {
      const agency = clean(row?.awardingAgency) || 'Agency unavailable';
      const office = clean(row?.awardingSubAgency) || null;
      const key = `${norm(agency)}|${norm(office)}`;
      const current = groups.get(key) || { agency, buyer:office, historicalAwardValue:0, awardCount:0, source:'USAspending.gov', confidence:'CONFIRMED_AWARD_HISTORY' };
      current.historicalAwardValue += Number(row?.amount || 0);
      current.awardCount += 1;
      groups.set(key,current);
    }
    return [...groups.values()].sort((a,b) => b.historicalAwardValue-a.historicalAwardValue || b.awardCount-a.awardCount).slice(0,20);
  }

  buildAgencyAlignment(buyers) {
    if (!buyers.length) return { status:'UNAVAILABLE', agencies:[] };
    const maxAmount = Math.max(...buyers.map(x=>Number(x.historicalAwardValue || 0)),1);
    const maxAwards = Math.max(...buyers.map(x=>Number(x.awardCount || 0)),1);
    return {
      status:'CONFIRMED_USASPENDING_HISTORICAL_ALIGNMENT',
      agencies:buyers.slice(0,10).map(row => ({
        agency:row.agency,
        fitScore:Math.round(((Number(row.historicalAwardValue||0)/maxAmount)*0.7 + (Number(row.awardCount||0)/maxAwards)*0.3)*100),
        historicalAwardValue:row.historicalAwardValue,
        awardCount:row.awardCount,
        basis:'Confirmed USAspending award history for this UEI',
        confidence:'CONFIRMED_HISTORICAL_BUYER'
      }))
    };
  }

  normalizeAwards(award, asOfDate) {
    const prime = list(award?.primeAwards).map(row => ({
      role:'PRIME', awardId:row.awardId || null, awardType:row.awardType || null, amount:num(row.amount), startDate:dateOnly(row.startDate), endDate:dateOnly(row.endDate), description:row.description || null, awardingAgency:row.awardingAgency || null, awardingSubAgency:row.awardingSubAgency || null, source:row.source || 'USAspending.gov', confidence:'CONFIRMED_AWARD_HISTORY'
    }));
    const sub = list(award?.subcontracts).map(row => ({
      role:'SUBCONTRACT', awardId:row.subawardId || row.primeAwardId || null, primeAwardId:row.primeAwardId || null, amount:num(row.amount), actionDate:dateOnly(row.actionDate), description:row.description || null, awardingAgency:row.awardingAgency || null, source:row.source || 'USAspending.gov', confidence:'CONFIRMED_AWARD_HISTORY'
    }));
    const activePrime = prime.filter(row => row.startDate && row.endDate && row.startDate <= asOfDate && row.endDate >= asOfDate);
    return { prime, sub, activePrime };
  }

  applyGsa(model, gsa) {
    const profile = model.profile || (model.profile={});
    const state = model.currentState || (model.currentState={});
    const vehicles = model.vehicles || (model.vehicles={ current:[], recommendations:[] });
    profile.gsaEvidenceStatus = gsa.status;
    profile.gsaHolderVerified = gsa.ok === true ? gsa.holder === true : null;
    profile.gsaContracts = list(gsa.records);
    if (gsa.ok === true && gsa.holder === true) {
      profile.gsaStatus = 'CURRENT GSA MAS HOLDER';
      profile.contractVehicles = uniq([...list(profile.contractVehicles),'GSA MAS']);
      state.contractVehicles = uniq([...list(state.contractVehicles),'GSA MAS']);
      vehicles.current = uniq([...list(vehicles.current),'GSA MAS']);
      vehicles.status = 'CURRENT_GSA_MAS_HOLDER_CONFIRMED';
      vehicles.details = list(gsa.records);
      const socio = uniq(list(gsa.records).map(x=>x.socioEconomicIndicators));
      if (socio.some(x=>/SMALL BUSINESS/i.test(x))) {
        profile.smallBusinessStatus = 'SMALL BUSINESS';
        state.smallBusinessStatus = 'SMALL BUSINESS';
      }
    } else if (gsa.ok === true && gsa.holder === false) {
      profile.gsaStatus = 'CURRENT GSA MAS NON-HOLDER';
      profile.gsaContracts = [];
    } else {
      profile.gsaStatus = /GSA|MAS/i.test(clean(profile.gsaStatus)) ? 'GSA STATUS REQUIRES CURRENT SOURCE REVIEW' : 'CURRENT GSA STATUS UNVERIFIED';
    }
  }

  applyAwards(model, award, aggregate, asOfDate) {
    const state = model.currentState || (model.currentState={});
    const revenue = model.revenue || (model.revenue={ current:{}, opportunity:{} });
    revenue.current = revenue.current || {};
    const authoritative = award?.ok === true && award?.dataQuality?.zeroAwardClassificationPermitted === true;
    if (!authoritative) {
      state.awardCount = null;
      state.awardCountStatus = 'AUTHORITATIVE_AWARD_HISTORY_UNAVAILABLE';
      state.activeContracts = null;
      state.activeContractsStatus = 'UNVERIFIED';
      revenue.current.federal = null;
      revenue.current.federalStatus = 'CURRENT_OBLIGATION_EVIDENCE_UNAVAILABLE';
      model.awardHistory = { status:award?.status || 'UNAVAILABLE', truthClass:'UNKNOWN', source:award?.source || null, summary:null, primeAwards:[], subcontracts:[], activePrimeAwards:[] };
      return;
    }

    const normalized = this.normalizeAwards(award, asOfDate);
    const summary = award.summary || {};
    state.awardCount = Number(summary.awardCount || 0);
    state.awardCountStatus = 'CONFIRMED_DISTINCT_PRIME_PLUS_SUBCONTRACT_AWARDS';
    state.activeContracts = normalized.activePrime.length;
    state.activeContractsStatus = 'CONFIRMED_CURRENT_PERFORMANCE_PERIOD_FROM_USASPENDING_DATES';
    state.activeContractsLabel = 'Prime awards in current performance period';
    model.awardHistory = {
      status:'CONFIRMED_USASPENDING_AWARD_HISTORY',
      truthClass:'CONFIRMED',
      source:award.source,
      governingDefinition:award.governingDefinition,
      summary:{ ...summary, activePrimeAwardCount:normalized.activePrime.length, awardedValueDefinition:'Award Amount returned by USAspending award search; do not treat IDV/Schedule ceiling as realized sales.' },
      primeAwards:normalized.prime,
      subcontracts:normalized.sub,
      activePrimeAwards:normalized.activePrime,
      warnings:list(award?.dataQuality?.warnings)
    };

    const buyers = this.buildBuyerTruth(award);
    model.buyerIntelligence = { status:buyers.length ? 'CONFIRMED_USASPENDING_BUYER_HISTORY' : 'CONFIRMED_NO_LINKED_AWARD_BUYER_HISTORY', records:buyers, source:'USAspending.gov', truthClass:'CONFIRMED' };
    model.agencyAlignment = this.buildAgencyAlignment(buyers);
    state.agencyRelationships = uniq(buyers.map(x=>x.agency));
    state.agencyRelationshipsStatus = buyers.length ? 'CONFIRMED_FROM_AWARD_HISTORY' : 'CONFIRMED_NONE_IN_AWARD_HISTORY';

    if (aggregate?.ok === true && aggregate?.row) {
      const total = num(aggregate.row.totalFederalObligations);
      revenue.current.federal = total;
      state.federalSales = total;
      state.federalSalesStatus = 'CONFIRMED_USASPENDING_OBLIGATIONS_MEASUREMENT_WINDOW';
      revenue.current.federalStatus = 'CONFIRMED_USASPENDING_OBLIGATIONS_MEASUREMENT_WINDOW';
      revenue.current.federalDefinition = 'Prime plus subcontract federal obligations in the governed current measurement window';
      revenue.current.measurementWindow = aggregate.source?.measurementWindow || null;
      revenue.current.primeFederalObligations = num(aggregate.row.primeFederalObligations);
      revenue.current.subawardObligations = num(aggregate.row.subawardObligations);
      revenue.current.source = aggregate.source;
    } else if (Number(summary.awardCount || 0) === 0) {
      revenue.current.federal = 0;
      state.federalSales = 0;
      state.federalSalesStatus = 'ZERO_PERMITTED_BY_AUTHORITATIVE_ZERO_AWARD_HISTORY';
      revenue.current.federalStatus = 'ZERO_PERMITTED_BY_AUTHORITATIVE_ZERO_AWARD_HISTORY';
      revenue.current.federalDefinition = 'Authoritative USAspending/SAM identity reconciliation found zero prime and subcontract awards.';
    } else {
      revenue.current.federal = null;
      state.federalSales = null;
      state.federalSalesStatus = 'CURRENT_OBLIGATION_TOTAL_UNAVAILABLE_HISTORICAL_AWARDS_EXIST';
      revenue.current.federalStatus = 'CURRENT_OBLIGATION_TOTAL_UNAVAILABLE_HISTORICAL_AWARDS_EXIST';
      revenue.current.federalDefinition = 'Historical award evidence exists, but current obligation total is not fresh enough to represent as sales.';
    }

    revenue.opportunity = {
      status:'MODELED_REVENUE_WITHHELD_PENDING_STRUCTURED_EVIDENCE',
      currentFederalRevenue:revenue.current.federal,
      modeledPotentialFederalRevenue:null,
      modeledGrowthOpportunity:null,
      disclosure:'No precise revenue-growth dollar estimate is shown unless a structured, provenance-backed revenue model supports it. Free-text recommendation amounts are not revenue forecasts.'
    };
  }

  applyOpportunities(model, opportunity) {
    model.opportunities = model.opportunities || {};
    const existing = list(model.opportunities.liveAndForecast).filter(row => row?.live !== false);
    const additions = opportunity?.ok === true ? list(opportunity.records) : [];
    model.opportunities.publicSourceAdditions = additions;
    model.opportunities.liveAndForecast = dedupeOpportunity([...additions, ...existing]).sort((a,b)=>(num(b.fitScore)||0)-(num(a.fitScore)||0)).slice(0,30);
    model.opportunities.sourceCoverage = {
      status:opportunity?.status || 'UNAVAILABLE',
      fresh:opportunity?.ok === true && opportunity?.source?.fresh === true,
      source:opportunity?.source || null,
      match:opportunity?.match || null,
      blockers:list(opportunity?.blockers),
      rule:'Only fresh, current public opportunity records may render as live. NAICS alignment is a candidate signal; scope, set-aside, vehicle and bid fit still require validation.'
    };
    model.opportunities.recompetes = list(model.opportunities.recompetes).filter(row => !/ZERO_AWARD_VENDOR|ZERO AWARD VENDOR/i.test(JSON.stringify(row || {})));

    model.recommendations = model.recommendations || {};
    const currentCount = model.opportunities.liveAndForecast.length;
    model.recommendations.opportunity = removeMatching(model.recommendations.opportunity,[/screen\s+\d+\s+linked opportunities/i,/linked opportunities against fit/i,/prioriti[sz]e\s+\d+\s+recompete/i]);
    if (currentCount) {
      model.recommendations.opportunity.unshift(`Review the top ${Math.min(currentCount,5)} current public opportunity candidate${Math.min(currentCount,5)===1?'':'s'} against scope, set-aside, vehicle and buyer fit before pursuit.`);
      model.recommendations.opportunity = uniq(model.recommendations.opportunity).slice(0,5);
    }
  }

  recomputeReadiness(model) {
    const p=model.profile||{}, s=model.currentState||{}, r=model.recommendations||{};
    const awards = num(s.awardCount);
    const federal = num(s.federalSales);
    const buyers = list(model.buyerIntelligence?.records);
    const vehicles = list(p.contractVehicles);
    const certs = list(p.certifications);
    const samActive = /^ACTIVE$/i.test(clean(p.samStatus));
    const categories = {
      eligibility:scoreCategory('Eligibility',[
        {label:'Primary NAICS identified',pass:list(p.naicsCodes).length>0,weight:30},
        {label:'Small-business status identified',pass:Boolean(p.smallBusinessStatus),weight:20},
        {label:'SAM entity appears active',pass:samActive,weight:30},
        {label:'Socioeconomic certification evidence',pass:certs.length>0,weight:20}
      ]),
      registrations:scoreCategory('Registrations',[
        {label:'UEI present',pass:Boolean(p.uei),weight:30},
        {label:'CAGE present',pass:Boolean(p.cage),weight:25},
        {label:'SAM active',pass:samActive,weight:35},
        {label:'Registration expiration is current',pass:Boolean(p.samExpirationCurrent),weight:10}
      ]),
      contractVehicles:scoreCategory('Contract Vehicles',[
        {label:'At least one current contract vehicle confirmed',pass:vehicles.length>0,weight:55},
        {label:'Multiple vehicle coverage',pass:vehicles.length>1,weight:20},
        {label:'Vehicle strategy exists',pass:list(r.vehicle).length>0,weight:25}
      ]),
      marketing:model.readiness?.categories?.marketing || scoreCategory('Marketing',[]),
      pastPerformance:scoreCategory('Past Performance',[
        {label:'Current federal obligation evidence recorded',pass:federal!=null && federal>0,weight:40},
        {label:'Federal awards recorded',pass:awards!=null && awards>0,weight:30},
        {label:'Agency/buyer history recorded',pass:buyers.length>0,weight:30}
      ]),
      positioning:model.readiness?.categories?.positioning || scoreCategory('Positioning',[]),
      relationships:scoreCategory('Relationships',[
        {label:'At least one agency/buyer relationship signal',pass:buyers.length>0,weight:45},
        {label:'Three or more buyer relationships',pass:buyers.length>=3,weight:25},
        {label:'Partner strategy identified',pass:list(r.partner).length>0,weight:20},
        {label:'Current opportunity/recompete signals',pass:list(model.opportunities?.liveAndForecast).length+list(model.opportunities?.recompetes).length>0,weight:10}
      ])
    };
    const scores=Object.values(categories).map(x=>x.score);
    model.readiness={ categories, overall:Math.round(scores.reduce((a,b)=>a+b,0)/scores.length), methodology:'Evidence-weighted readiness model using reconciled current SAM/GSA, authoritative award history, buyer history and current opportunity evidence. Unknown is not scored as zero evidence.' };
  }

  rebuildGapsAndPathway(model, award, gsa) {
    model.gaps = model.gaps || {items:[]};
    let gaps = list(model.gaps.items);
    if (award?.ok === true) {
      if (Number(award?.summary?.awardCount || 0)>0) gaps=removeMatching(gaps,[/Federal awards recorded/i,/agency\/buyer history recorded/i,/at least one agency\/buyer relationship/i]);
      if (model.revenue?.current?.federal != null) gaps=removeMatching(gaps,[/Federal revenue recorded/i]);
    }
    if (gsa?.ok === true && gsa.holder === true) gaps=removeMatching(gaps,[/At least one contract vehicle identified/i,/GSA.*not identified/i,/vehicle gap/i]);
    if (list(model.opportunities?.liveAndForecast).length) gaps=removeMatching(gaps,[/opportunity.*signal/i]);
    model.gaps.items=uniq(gaps);
    model.gaps.status=model.gaps.items.length?'GAPS_IDENTIFIED':'NO_GAPS_IDENTIFIED_FROM_CURRENT_EVIDENCE';

    const awardCount = award?.ok === true ? Number(award?.summary?.awardCount || 0) : null;
    const currentFederal = num(model.revenue?.current?.federal);
    const currentGsa = gsa?.ok === true && gsa.holder === true;
    if (currentGsa && (!currentFederal || currentFederal <= 0)) {
      model.pathway={ type:'GSA_ACTIVATION_PATHWAY', title:'GSA Activation & First-Order Pathway™', steps:['Confirm current MAS contract/SIN/category positioning','Map current agency demand to awarded GSA scope','Prioritize current public opportunities and buyer signals','Build prime/sub teaming around access gaps','Pursue the first qualified GSA order or federal task award','Measure obligations and buyer traction','Expand utilization across validated agencies'] };
    } else if ((awardCount!=null && awardCount>0) || (currentFederal!=null && currentFederal>0)) {
      model.pathway={ type:'FEDERAL_GROWTH_PATHWAY', title:'Federal Growth Pathway™', steps:['Validate current award and buyer concentration','Optimize current contract vehicles','Expand into adjacent aligned agencies/buyers','Build prime and teaming relationships','Match current qualified opportunities','Strengthen recompete and incumbent-displacement positioning','Increase sustainable federal obligations'] };
    } else if (award?.ok === true && award?.dataQuality?.zeroAwardClassificationPermitted === true && awardCount===0) {
      model.pathway={ type:'FIRST_AWARD_PATHWAY', title:'First Award Pathway™', steps:['Validate registrations','Optimize SAM profile','Complete/activate eligible certifications','Identify best-fit agencies and buyers','Build usable past-performance strategy','Pursue subcontracting and teaming opportunities','Pursue the first qualified award'] };
    } else {
      model.pathway={ type:'EVIDENCE_COMPLETION_PATHWAY', title:'Evidence Completion Pathway™', steps:['Complete authoritative award-history reconciliation','Verify current vehicle status','Refresh current public opportunity coverage','Confirm buyer and agency history','Then select first-award, activation, or growth pathway from proven evidence'] };
    }
  }

  finalIntegrity(model, award, gsa, opportunity, aggregate) {
    const existing = model.truthIntegrity || {};
    const conflicts = uniq(existing.conflicts || []);
    const coverage = {
      identity:Boolean(model.profile?.uei),
      sam:/^ACTIVE$|^INACTIVE$/i.test(clean(model.profile?.samStatus)),
      awardHistory:award?.ok === true && award?.dataQuality?.zeroAwardClassificationPermitted === true,
      gsaCurrent:gsa?.ok === true,
      currentPublicOpportunities:opportunity?.ok === true && opportunity?.source?.fresh === true,
      currentObligationAggregate:aggregate?.ok === true
    };
    const critical = ['identity','sam','awardHistory','gsaCurrent','currentPublicOpportunities'];
    const blockers = critical.filter(k=>coverage[k]!==true).map(k=>`CANONICAL_SOURCE_COVERAGE_${k.toUpperCase()}_NOT_GREEN`);
    model.truthIntegrity = {
      ...existing,
      status:conflicts.length || blockers.length ? 'CONFLICTED_OR_COVERAGE_REVIEW_REQUIRED' : 'CANONICAL_CURRENT_TRUTH_RECONCILED',
      clientSafe:conflicts.length===0 && blockers.length===0,
      conflicts,
      blockers,
      sourceCoverage:coverage,
      warnings:uniq([...(existing.warnings||[]), ...list(gsa?.limitations), ...list(opportunity?.blockers), ...(aggregate?.ok===true?[]:[aggregate?.status].filter(Boolean))]),
      rules:uniq([...(existing.rules||[]),'UNKNOWN_IS_NOT_ZERO_OR_NONE','AWARD_COUNT_IS_NOT_ACTIVE_CONTRACT_COUNT','GSA_STATUS_REQUIRES_CURRENT_GSA_ELIBRARY_TRUTH','LIVE_OPPORTUNITIES_REQUIRE_FRESH_PUBLIC_SOURCE','MODELED_REVENUE_REQUIRES_STRUCTURED_PROVENANCE','GENERIC_ZERO_AWARD_RECOMPETE_SIGNALS_DO_NOT_RENDER']),
      reconciledAt:new Date().toISOString()
    };
    model.status=model.truthIntegrity.clientSafe?'DEMO_READY':'DEMO_REVIEW_REQUIRED';
  }

  async hydrate(model = {}, options = {}) {
    if (!model?.ok) return model;
    const out = JSON.parse(JSON.stringify(model));
    const uei=clean(out.profile?.uei);
    const companyName=clean(out.profile?.companyName);
    const asOfDate=(this.now || new Date()).toISOString().slice(0,10);

    const [award,gsa,opportunity,aggregate] = await Promise.all([
      this.safeAwardHistory(uei,companyName),
      this.safeGsa(uei,companyName),
      this.safeOpportunities(out),
      this.aggregateEvidence(uei)
    ]);

    this.applyGsa(out,gsa);
    this.applyAwards(out,award,aggregate,asOfDate);
    this.applyOpportunities(out,opportunity);
    out.competitors = { ...(out.competitors||{}), records:dedupeEntities(out.competitors?.records).slice(0,10) };
    out.primePartners = { ...(out.primePartners||{}), records:dedupeEntities(out.primePartners?.records).slice(0,10) };
    this.rebuildGapsAndPathway(out,award,gsa);
    this.recomputeReadiness(out);
    this.finalIntegrity(out,award,gsa,opportunity,aggregate);

    out.evidence=out.evidence||{};
    out.evidence.canonicalTruth={
      generatedAt:new Date().toISOString(),
      requestedRefresh:options.refresh===true,
      awardHistory:{ status:award?.status||null, source:award?.source||null, authoritativeZeroPermitted:award?.dataQuality?.zeroAwardClassificationPermitted===true },
      currentGsa:{ status:gsa?.status||null, holder:gsa?.holder??null, source:gsa?.source||null },
      currentOpportunities:{ status:opportunity?.status||null, source:opportunity?.source||null, returned:list(opportunity?.records).length },
      federalObligations:{ status:aggregate?.status||null, source:aggregate?.source||null },
      rule:'Every material fact is hydrated from the best current authoritative evidence available. Missing source coverage fails closed to REVIEW_REQUIRED rather than fabricating zero/none.'
    };
    return out;
  }
}

module.exports = ExecutiveBlueprintCanonicalTruthService;
module.exports.dedupeEntities = dedupeEntities;
module.exports.dedupeOpportunity = dedupeOpportunity;
module.exports.findJsonlExact = findJsonlExact;
