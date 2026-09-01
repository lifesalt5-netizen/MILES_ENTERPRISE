'use strict';

const fs = require('fs');
const path = require('path');
const AwardHistoryTruthService = require('../orion/AwardHistoryTruthService');
const PrimeSubcontractHistoryNetworkService = require('../teaming/PrimeSubcontractHistoryNetworkService');

function clean(v) { return String(v == null ? '' : v).trim(); }
function norm(v) { return clean(v).toUpperCase(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function uniq(v) { return [...new Set((v || []).map(clean).filter(Boolean))]; }
function arr(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
function dateOnly(v) { const d = new Date(v || 0); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
function column(row, names) { for (const n of names) if (row && row[n] != null && clean(row[n]) !== '') return row[n]; return null; }
function includesAny(text, values) { const t = norm(text); return (values || []).some(v => v && t.includes(norm(v))); }
function walk(root, matcher, max = 100) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes:true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (matcher(p, e.name)) out.push(p);
      if (out.length >= max) break;
    }
  }
  return out;
}
function newest(paths) {
  return (paths || []).map(p => { try { return { p, m:fs.statSync(p).mtimeMs }; } catch { return null; } }).filter(Boolean).sort((a,b)=>b.m-a.m)[0]?.p || null;
}

class DemoCanonicalIntelligenceService {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.orion = options.orion || null;
    this.awards = options.awards || new AwardHistoryTruthService({ requestTimeoutMs:Number(process.env.P2GC_DEMO_AWARD_TIMEOUT_MS || 20000) });
    this.network = options.network || new PrimeSubcontractHistoryNetworkService();
    this.networkCache = null;
    this.networkCacheAt = 0;
  }

  getOrion() { if (!this.orion) this.orion = require('../../CONNECTORS/ORION/connector'); return this.orion; }

  async awardTruth(model) {
    const uei = clean(model?.profile?.uei);
    if (!uei) return null;
    try { return await this.awards.auditByUei(uei, { companyName:model?.profile?.companyName, maxPages:25, pageSize:100 }); }
    catch (error) { return { ok:false, status:'AWARD_TRUTH_UNAVAILABLE', error:error.message }; }
  }

  buyerHistoryFromAwards(audit) {
    if (!audit?.ok) return [];
    const grouped = new Map();
    for (const row of [...arr(audit.primeAwards), ...arr(audit.subcontracts)]) {
      const agency = clean(row.awardingAgency) || 'Unknown agency';
      if (!grouped.has(agency)) grouped.set(agency, { agency, spend:0, awardIds:new Set(), primeAwards:0, subawards:0 });
      const g = grouped.get(agency);
      g.spend += num(row.amount);
      const id = row.awardId || row.primeAwardId || row.subawardId;
      if (id) g.awardIds.add(String(id));
      if (row.role === 'SUBCONTRACT') g.subawards += 1; else g.primeAwards += 1;
    }
    return [...grouped.values()].map(g => ({
      agency:g.agency,
      buyer:g.agency,
      spend:g.spend,
      awardCount:g.awardIds.size || g.primeAwards + g.subawards,
      primeAwardCount:g.primeAwards,
      subcontractAwardCount:g.subawards,
      source:'USAspending.gov',
      evidenceStatus:'ORION_VERIFIED_AWARD_HISTORY'
    })).sort((a,b)=>b.spend-a.spend);
  }

  applyAwardTruth(model, audit) {
    model.evidence = model.evidence || {};
    model.evidence.authoritativeAwardHistory = audit || { ok:false, status:'NOT_RUN' };
    if (!audit?.ok) return model;
    const s = audit.summary || {};
    model.revenue = model.revenue || { current:{}, opportunity:{} };
    model.revenue.current = model.revenue.current || {};
    model.revenue.current.federal = num(s.federalRevenue);
    model.currentState = model.currentState || {};
    model.currentState.federalSales = num(s.federalRevenue);
    model.currentState.awardCount = num(s.awardCount);
    model.currentState.activeContracts = null;
    model.currentState.activeContractsStatus = 'NOT_DERIVED_FROM_AWARD_COUNT';

    const buyers = this.buyerHistoryFromAwards(audit);
    model.currentState.agencyRelationships = buyers.map(x=>x.agency);
    model.buyerIntelligence = {
      status:buyers.length ? 'AUTHORITATIVE_AWARD_DERIVED_BUYER_HISTORY' : 'NO_BUYER_HISTORY_IN_AUTHORITATIVE_AWARD_READ',
      records:buyers,
      source:'USAspending.gov prime + subcontract award history'
    };
    const maxSpend = Math.max(1, ...buyers.map(x=>num(x.spend)));
    const maxAwards = Math.max(1, ...buyers.map(x=>num(x.awardCount)));
    model.agencyAlignment = {
      status:buyers.length ? 'AUTHORITATIVE_HISTORICAL_ALIGNMENT' : 'NO_QUALIFIED_AGENCY_ALIGNMENT',
      agencies:buyers.map(x=>({
        agency:x.agency,
        fitScore:Math.round(((num(x.spend)/maxSpend)*0.7 + (num(x.awardCount)/maxAwards)*0.3)*100),
        historicalSpend:x.spend,
        awardCount:x.awardCount,
        primeAwardCount:x.primeAwardCount,
        subcontractAwardCount:x.subcontractAwardCount,
        basis:'USAspending prime/subaward history',
        evidenceStatus:'ORION_VERIFIED'
      }))
    };
    if (model.revenue.opportunity?.status === 'BLOCKED_PENDING_REVENUE_RECONCILIATION') {
      model.revenue.opportunity = { status:'REQUIRES_RECALCULATION_FROM_RECONCILED_BASELINE', currentFederalRevenue:num(s.federalRevenue), modeledPotentialFederalRevenue:null, modeledGrowthOpportunity:null, disclosure:'Growth modeling is withheld until recalculated from the reconciled authoritative federal baseline.' };
    }
    return model;
  }

  opportunityRows(model) {
    const orion = this.getOrion();
    try { orion.initialize(); } catch {}
    let cols=[];
    try { cols = orion.query('PRAGMA table_info(opportunities)').map(x=>x.name); } catch { return []; }
    if (!cols.length) return [];
    let rows=[];
    try { rows = orion.query("SELECT * FROM opportunities ORDER BY CASE WHEN due_date = '' OR due_date IS NULL THEN 1 ELSE 0 END, due_date ASC LIMIT 2000"); } catch { return []; }
    const now = new Date().toISOString().slice(0,10);
    const naics = arr(model.profile?.naicsCodes).map(String);
    const agencies = arr(model.currentState?.agencyRelationships);
    return rows.map(row => {
      const title = clean(column(row,['title','opportunity_title','name']));
      const source = clean(column(row,['source','source_name','feed']));
      const status = clean(column(row,['status','opportunity_status']));
      const due = dateOnly(column(row,['due_date','response_deadline','deadline','close_date']));
      const rowNaics = clean(column(row,['naics','naics_code','primary_naics']));
      const agency = clean(column(row,['agency','agency_name','department','buyer_name']));
      const hay = JSON.stringify(row);
      let score = 0;
      if (rowNaics && naics.includes(rowNaics)) score += 60;
      else if (includesAny(hay, naics)) score += 40;
      if (agency && agencies.some(a=>norm(a)===norm(agency))) score += 25;
      else if (includesAny(hay, agencies)) score += 15;
      if (/SOURCE.?SOUGHT|RFI|FORECAST|RFP|RFQ|SOLICITATION|OPPORTUNITY/i.test(`${source} ${status} ${title}`)) score += 10;
      if (due && due < now) score -= 100;
      const kind = /SOURCE.?SOUGHT|RFI|PRE.?SOLICIT/i.test(`${source} ${status} ${title}`) ? 'PRE_SOLICITATION'
        : /FORECAST/i.test(`${source} ${status} ${title}`) ? 'FORECAST'
        : 'LIVE';
      const updated = dateOnly(column(row,['updated_at','last_updated','modified_date','posted_date','publish_date','created_at']));
      return { title:title || null, agency:agency || null, naics:rowNaics || null, source:source || null, status:status || null, dueDate:due, updatedDate:updated, kind, fitScore:score, sourceRecord:row };
    }).filter(x=>x.title && x.fitScore >= 40).sort((a,b)=>b.fitScore-a.fitScore || String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999')));
  }

  applyOpportunities(model) {
    const rows = this.opportunityRows(model);
    const existing = arr(model.opportunities?.liveAndForecast);
    const byKey = new Map();
    for (const x of [...rows, ...existing]) {
      const key = norm(`${x.title}|${x.source}|${x.dueDate || x.due_date || ''}`);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, x);
    }
    const merged=[...byKey.values()];
    const live=merged.filter(x=>!x.kind || x.kind==='LIVE');
    const forecast=merged.filter(x=>x.kind==='FORECAST');
    const pre=merged.filter(x=>x.kind==='PRE_SOLICITATION');
    model.opportunities = model.opportunities || {};
    model.opportunities.liveAndForecast = merged;
    model.opportunities.live = live;
    model.opportunities.forecast = forecast;
    model.opportunities.preSolicitation = pre;
    model.opportunities.status = merged.length ? 'CURRENT_QUALIFIED_OPPORTUNITIES_AVAILABLE' : 'NO_CURRENT_QUALIFIED_FITS';
    model.opportunities.currentFeedAsOf = newest(merged.map(x=>x.updatedDate).filter(Boolean)) || merged.map(x=>x.updatedDate).filter(Boolean).sort().reverse()[0] || null;
    model.opportunities.sourceMethod = 'ORION current opportunity feed re-filtered by company NAICS + award-derived agencies + current deadlines';
    return model;
  }

  subawardCsvFiles() {
    const root = path.join(this.root,'DATA','staging','government_data','usaspending_awards');
    return walk(root, (p,n)=>/\.csv$/i.test(n) && /sub|award/i.test(n), 20);
  }

  async subcontractNetwork() {
    const ttl = 15*60*1000;
    if (this.networkCache && Date.now()-this.networkCacheAt < ttl) return this.networkCache;
    const files=this.subawardCsvFiles();
    if (!files.length) return null;
    this.networkCache = await this.network.run({ csvFiles:files });
    this.networkCacheAt=Date.now();
    return this.networkCache;
  }

  async applySub2Prime(model) {
    const network = await this.subcontractNetwork();
    model.evidence = model.evidence || {};
    model.evidence.subcontractNetwork = network ? { status:network.status, generatedAt:network.generatedAt, counts:network.counts, source:network.evidence?.source } : { status:'NO_STAGED_SUBAWARD_EXPORT_FOUND' };
    if (!network?.ok || !network.primes?.length) return model;
    const clientNaics = arr(model.profile?.naicsCodes).map(String);
    const clientAgencies = arr(model.currentState?.agencyRelationships);
    const candidates = network.primes.map(p=>{
      const historicalNaics = uniq(p.subcontractors.flatMap(s=>s.naics || []));
      const historicalPsc = uniq(p.subcontractors.flatMap(s=>s.psc || []));
      const agencyOverlap = p.agencies.filter(a=>clientAgencies.some(c=>norm(c)===norm(a)));
      const naicsAlreadyUsed = clientNaics.filter(n=>historicalNaics.includes(n));
      const whitespaceNaics = clientNaics.filter(n=>!historicalNaics.includes(n));
      const fitScore = Math.min(100, Math.round((agencyOverlap.length?40:0) + (naicsAlreadyUsed.length?25:0) + (whitespaceNaics.length?20:0) + (p.subawardCount>2?10:0) + (p.totalSubawardAmount>0?5:0)));
      return {
        company:p.prime?.name || null,
        uei:p.prime?.uei || null,
        fitScore,
        agencyOverlap,
        historicalAgencies:p.agencies,
        historicalSubawardAmount:p.totalSubawardAmount,
        historicalSubawardCount:p.subawardCount,
        historicalSubcontractors:p.subcontractors.slice(0,8).map(s=>({ company:s.subcontractor?.name||null, uei:s.subcontractor?.uei||null, totalAmount:s.totalAmount, subawardCount:s.subawardCount, naics:s.naics, psc:s.psc, agencies:s.agencies, descriptions:s.descriptions, evidenceStatus:s.confidence })),
        historicalNaics,
        historicalPsc,
        clientNaicsAlreadyUsed:naicsAlreadyUsed,
        capabilityWhitespaceNaics:whitespaceNaics,
        rationale: agencyOverlap.length ? `Prime has historical subcontract activity with ${agencyOverlap.join(', ')}; client capability overlap/whitespace evaluated against actual subaward history.` : `Client capability fit evaluated against this prime's actual USAspending subcontract history.`,
        confidence:fitScore>=70?'HIGH_EVIDENCE_FIT':fitScore>=45?'MEDIUM_EVIDENCE_FIT':'LOW_EVIDENCE_FIT',
        source:'USAspending.gov subaward history'
      };
    }).filter(x=>x.company && x.fitScore>=45).sort((a,b)=>b.fitScore-a.fitScore || b.historicalSubawardAmount-a.historicalSubawardAmount);
    model.primePartners = { status:candidates.length?'SUB2PRIME_EVIDENCE_NETWORK_AVAILABLE':'NO_QUALIFIED_PRIME_FITS', records:candidates, strategy:arr(model.primePartners?.strategy), disclosure:'Prime fits are derived from historical USAspending subcontract relationships plus client NAICS and award-derived agency alignment. Different-NAICS whitespace can be a positive fit when the prime has not historically covered that capability.' };
    model.subcontracting = { status:candidates.length?'SUB2PRIME_FITS_AVAILABLE':'NO_QUALIFIED_TEAMING_FITS', records:candidates, strategy:arr(model.subcontracting?.strategy) };
    return model;
  }

  async applyGsa(model) {
    const uei=norm(model.profile?.uei);
    if (!uei) return model;
    const root=path.join(this.root,'DATA','staging','government_data','gsa_segmentation');
    const files=walk(root,(p,n)=>n==='gsa_segmented_current_holders.jsonl',50);
    const latest=newest(files);
    if (!latest) return model;
    let hit=null;
    try {
      for (const line of fs.readFileSync(latest,'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const row=JSON.parse(line); if (norm(row.uei)===uei) { hit=row; break; }
      }
    } catch {}
    model.evidence = model.evidence || {};
    model.evidence.gsaCurrentHolderLookup = { sourceFile:latest, matched:Boolean(hit) };
    if (hit) {
      model.profile.gsaStatus='CURRENT_MAS_HOLDER_CONFIRMED';
      const vehicle=`GSA MAS ${hit.contractNumber||''}`.trim();
      model.profile.contractVehicles=uniq([...(model.profile.contractVehicles||[]),vehicle]);
      model.currentState.contractVehicles=model.profile.contractVehicles;
      model.vehicles = model.vehicles || {};
      model.vehicles.current=model.profile.contractVehicles;
      model.vehicles.status='CURRENT_GSA_HOLDER_CONFIRMED';
      model.vehicles.gsa=hit;
    }
    return model;
  }

  removeContradictions(model) {
    const awards=num(model.currentState?.awardCount);
    if (awards>0 && model.opportunities?.recompetes) {
      model.opportunities.recompetes = model.opportunities.recompetes.filter(r=>!/^ZERO_AWARD_VENDOR$/i.test(clean(r.title)) && !/ZERO_AWARD_VENDOR/i.test(clean(r.signalType)));
    }
    if (model.profile?.samStatus && /^(A|ACTIVE)$/i.test(clean(model.profile.samStatus))) model.currentState.samRegistration=true;
    const hasBuyers=arr(model.buyerIntelligence?.records).length>0;
    if (hasBuyers) model.currentState.agencyRelationships=uniq(model.buyerIntelligence.records.map(x=>x.agency));
    model.truthIntegrity = model.truthIntegrity || {};
    model.truthIntegrity.canonicalEnrichmentApplied=true;
    model.truthIntegrity.canonicalSources=['USAspending.gov prime/subaward history','ORION current opportunity feed','GSA current-holder staging when available','USAspending subaward network'];
    return model;
  }

  async enrich(input={}) {
    if (!input?.ok) return input;
    const model=JSON.parse(JSON.stringify(input));
    const audit=await this.awardTruth(model);
    this.applyAwardTruth(model,audit);
    await this.applyGsa(model);
    this.applyOpportunities(model);
    await this.applySub2Prime(model);
    this.removeContradictions(model);
    model.generatedAt=new Date().toISOString();
    model.status='DEMO_CANONICAL_INTELLIGENCE_READY';
    return model;
  }
}

module.exports = DemoCanonicalIntelligenceService;
