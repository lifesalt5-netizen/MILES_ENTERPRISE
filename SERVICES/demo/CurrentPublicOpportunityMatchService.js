'use strict';

const fs = require('fs');
const path = require('path');
const SamOpportunityNaicsIndexService = require('./SamOpportunityNaicsIndexService');
const OpportunityQualificationGapService = require('./OpportunityQualificationGapService');

function clean(v) { return String(v == null ? '' : v).trim(); }
function norm(v) { return clean(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function header(v) { return clean(v).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function list(v) { return Array.isArray(v) ? v.filter(Boolean) : (v == null || v === '' ? [] : [v]); }
function dateOnly(v) { const d = new Date(v || 0); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }
function first(row, names) { for (const name of names) { const value = row?.[header(name)]; if (value != null && clean(value) !== '') return value; } return null; }
function number(v) { const n = Number(String(v ?? '').replace(/[$,]/g, '').trim()); return Number.isFinite(n) ? n : null; }
function boolish(v) {
  const value = clean(v).toLowerCase();
  if (!value) return null;
  if (['true','1','yes','y','active'].includes(value)) return true;
  if (['false','0','no','n','inactive','archived'].includes(value)) return false;
  return null;
}
function stageOf(row) {
  const code = clean(first(row, ['type','noticeTypeCode','notice_type_code'])).toLowerCase();
  const text = norm([first(row,['type','baseType','archiveType','noticeType']), first(row,['title'])].filter(Boolean).join(' '));
  if (code === 'r' || /SOURCES SOUGHT|SOURCE SOUGHT/.test(text)) return 'SOURCES_SOUGHT';
  if (/\bRFI\b|REQUEST FOR INFORMATION/.test(text)) return 'RFI';
  if (code === 'p' || /PRESOLICIT|PRE SOLICIT/.test(text)) return 'PRESOLICITATION';
  if (/DRAFT RFP|DRAFT RFQ|DRAFT SOLICIT|DRAFT REQUEST/.test(text)) return 'DRAFT';
  if (/FORECAST|PROCUREMENT PLAN|ACQUISITION PLAN/.test(text)) return 'FORECAST';
  if (code === 's' || /SPECIAL NOTICE/.test(text)) return 'SPECIAL_NOTICE';
  if (code === 'o' || code === 'k' || /SOLICITATION|REQUEST FOR PROPOSAL|\bRFP\b|REQUEST FOR QUOTE|\bRFQ\b|INVITATION FOR BID|\bIFB\b/.test(text)) return 'OPEN';
  return 'UNKNOWN';
}
function sourceUrl(row, noticeId) {
  const direct = first(row, ['uiLink','link','url','additionalInfoLink']);
  if (direct) return clean(direct);
  return noticeId ? `https://sam.gov/opp/${encodeURIComponent(clean(noticeId))}/view` : 'https://sam.gov/content/opportunities';
}
function sourceFileFromReport(rootDir) {
  const reportPath = path.join(rootDir, 'DATA', 'orion_refresh', 'latest_sam_bulk_acquisition.json');
  const report = readJson(reportPath);
  const entry = list(report?.files).find(x => x?.role === 'contract_opportunities' || /ContractOpportunitiesFullCSV\.csv$/i.test(clean(x?.fileName || x?.path)));
  return {
    reportPath,
    report,
    generatedAt: report?.generatedAt || null,
    file: entry?.path || null,
    sourceUrl: entry?.sourceUrl || 'https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public'
  };
}
function ageHours(iso, nowMs = Date.now()) { const ms = Date.parse(iso || ''); return Number.isFinite(ms) ? (nowMs - ms) / 3600000 : null; }
function compatibleSetAside(text, profile) {
  const t = norm(text);
  if (!t) return { score:0, reason:null };
  const certs = norm(list(profile?.certifications).join(' '));
  const checks = [
    ['SDVOSB', /SERVICE DISABLED VETERAN|\bSDVOSB\b/],
    ['EDWOSB', /ECONOMICALLY DISADVANTAGED WOMEN OWNED|\bEDWOSB\b/],
    ['WOSB', /WOMEN OWNED SMALL BUSINESS|\bWOSB\b/],
    ['8(A)', /\b8 A\b|8\(A\)/],
    ['HUBZONE', /HUBZONE/]
  ];
  for (const [cert, re] of checks) {
    if (re.test(t)) return certs.includes(cert) ? { score:12, reason:`${cert} set-aside aligns with identified certification` } : { score:-25, reason:`${cert} set-aside requires current certification validation`, eligibilityBlocked:true };
  }
  if (/TOTAL SMALL BUSINESS|SMALL BUSINESS SET ASIDE|SMALL BUSINESS/.test(t)) return { score:8, reason:'Small-business set-aside signal' };
  return { score:0, reason:`Set-aside: ${clean(text)}` };
}

function scopeClass(title, naics) {
  const text = norm(title);
  if (/SIGN LANGUAGE|INTERPRET|INTERPRETER|TRANSLAT|LANGUAGE SERVICE/.test(text)) return 'LANGUAGE_INTERPRETATION';
  if (/GENERATOR|ELECTRICAL|HVAC|PLUMB|MECHANICAL REPAIR|EQUIPMENT REPAIR|PREVENTIVE MAINTENANCE|MAINTENANCE AND REPAIR/.test(text)) return 'SPECIALIZED_MAINTENANCE';
  if (/SOFTWARE|DATABASE|COMPUTER|CYBER|NETWORK|INFORMATION TECHNOLOGY|\bIT\b|SYSTEMS?|APPLICATION|DATA (?:SYSTEM|PLATFORM|ANALYT)/.test(text)) return 'IT_TECHNOLOGY';
  if (/WAREHOUS|DISTRIBUT|FREIGHT|LOGISTIC|TRANSPORT|DELIVERY/.test(text)) return 'TRANSPORT_LOGISTICS';
  if (/FRUIT|VEGETABLE|FOOD|PRODUCE|BEAN|GRAIN|AGRICULT|COMMODIT/.test(text)) return 'AGRICULTURE_FOOD';
  if (/TRAINING|SEMINAR|LEARNING|INSTRUCTION|EDUCATION/.test(text)) return 'TRAINING_EDUCATION';
  if (/CONSULT|PROGRAM MANAGEMENT|MANAGEMENT SUPPORT|PROFESSIONAL SERVICES|HUMAN RESOURCES|COMMUNICATION/.test(text)) return 'PROFESSIONAL_SERVICES';
  const code=clean(naics).replace(/\D/g,'');
  if (/^5415|^51/.test(code)) return 'IT_TECHNOLOGY';
  if (/^48|^49/.test(code)) return 'TRANSPORT_LOGISTICS';
  if (/^11|^311|^4244|^4245/.test(code)) return 'AGRICULTURE_FOOD';
  if (/^611/.test(code)) return 'TRAINING_EDUCATION';
  if (/^5416/.test(code)) return 'PROFESSIONAL_SERVICES';
  if (/^5612/.test(code)) return 'FACILITIES_SUPPORT_GENERAL';
  return 'OTHER';
}

function capabilityEvidence(model) {
  const awards=list(model?.awardHistory?.primeAwards);
  const awardText=norm(awards.map(row=>row?.description).filter(Boolean).join(' | '));
  const gsaText=norm(list(model?.profile?.gsaContracts).map(row=>JSON.stringify(row)).join(' | '));
  const websiteText=norm([model?.profile?.website, model?.profile?.description, model?.profile?.capabilities].filter(Boolean).join(' | '));
  return { awardText, gsaText, websiteText, awardCount:awards.length };
}

function capabilityAssessment(title, naics, model) {
  const cls=scopeClass(title, naics);
  const ev=capabilityEvidence(model);
  const profileNaics=new Set(list(model?.profile?.naicsCodes).map(x=>clean(x).replace(/\D/g,'')).filter(Boolean));
  const exactNaics=profileNaics.has(clean(naics).replace(/\D/g,''));
  const proven=(regex)=>regex.test(ev.awardText) || regex.test(ev.gsaText) || regex.test(ev.websiteText);
  let supported=false;
  let basis=null;
  if (cls==='IT_TECHNOLOGY' && (proven(/54151S|SOFTWARE|DATABASE|COMPUTER|CYBER|NETWORK|INFORMATION TECHNOLOGY|SYSTEM/) || /5415/.test(ev.gsaText))) {
    supported=true; basis='Current GSA/contract capability evidence supports IT or systems work';
  } else if (cls==='AGRICULTURE_FOOD' && proven(/FRUIT|VEGETABLE|FOOD|PRODUCE|BEAN|GRAIN|AGRICULT|COMMODIT/)) {
    supported=true; basis='Authoritative award/capability history supports agriculture or food-supply work';
  } else if (cls==='TRANSPORT_LOGISTICS' && proven(/WAREHOUS|DISTRIBUT|FREIGHT|LOGISTIC|TRANSPORT|DELIVERY/)) {
    supported=true; basis='Award/capability evidence supports logistics, warehousing or distribution work';
  } else if (cls==='TRAINING_EDUCATION' && proven(/611430|TRAINING|SEMINAR|LEARNING|INSTRUCTION|EDUCATION/)) {
    supported=true; basis='Current GSA/contract capability evidence supports training or education work';
  } else if (cls==='PROFESSIONAL_SERVICES' && proven(/541612|CONSULT|PROFESSIONAL SERVICES|HUMAN RESOURCES|MANAGEMENT/)) {
    supported=true; basis='Current GSA/contract capability evidence supports professional-services work';
  }

  if (supported) return { status:'DEMONSTRATED_CAPABILITY_SUPPORTED', directFit:true, score:20, reason:basis, scopeClass:cls };
  if (cls==='SPECIALIZED_MAINTENANCE') return { status:'CAPABILITY_VALIDATION_REQUIRED', directFit:false, score:-30, reason:'Specialized maintenance/repair scope is not proven by current award or GSA capability evidence; NAICS overlap alone is insufficient.', scopeClass:cls };
  if (cls==='LANGUAGE_INTERPRETATION') return { status:'CAPABILITY_VALIDATION_REQUIRED', directFit:false, score:-35, reason:'Interpretation/language-service capability is not proven by current award or GSA capability evidence; NAICS overlap alone is insufficient.', scopeClass:cls };
  if (cls==='FACILITIES_SUPPORT_GENERAL') return { status:'CAPABILITY_VALIDATION_REQUIRED', directFit:false, score:-20, reason:'Broad facilities-support NAICS overlap does not prove the specific technical scope; validate capability before pursuit.', scopeClass:cls };
  if (exactNaics) return { status:'PROFILE_CAPABILITY_MATCH_VALIDATION_REQUIRED', directFit:false, score:-8, reason:'Exact registered NAICS supports candidate discovery, but direct capability still requires scope or past-performance validation.', scopeClass:cls };
  return { status:'CAPABILITY_VALIDATION_REQUIRED', directFit:false, score:-15, reason:'Current evidence does not yet prove direct performance capability for this scope.', scopeClass:cls };
}

function qualificationTier(capability, setAsideFit) {
  const cls = clean(capability?.scopeClass);
  if (capability?.directFit === true && setAsideFit?.eligibilityBlocked === true) return { code:'TEAMING_PATH_SUPPORTED', directPursuit:false, teamingCandidate:true, recommendationEligible:true, allowedAction:'EVALUATE_TEAMING_OR_ACCESS_PATH', reason:'Demonstrated capability supports the scope, but current direct-pursuit eligibility/access is not confirmed.' };
  if (capability?.directFit === true) return { code:'DIRECT_FIT_SUPPORTED', directPursuit:true, teamingCandidate:false, recommendationEligible:true, allowedAction:'DIRECT_PURSUIT_QUALIFICATION', reason:'Demonstrated capability evidence supports the scope and no current eligibility blocker is identified.' };
  if (['SPECIALIZED_MAINTENANCE','LANGUAGE_INTERPRETATION'].includes(cls)) return { code:'NOT_RECOMMENDED_DIRECT_PURSUIT', directPursuit:false, teamingCandidate:false, recommendationEligible:false, allowedAction:'DO_NOT_RECOMMEND_DIRECT_PURSUIT_WITHOUT_NEW_EVIDENCE', reason:'The current evidence does not support direct performance of this specialized scope.' };
  return { code:'CAPABILITY_VALIDATION_REQUIRED', directPursuit:false, teamingCandidate:false, recommendationEligible:false, allowedAction:'VALIDATE_CAPABILITY_BEFORE_RECOMMENDATION', reason:'NAICS or profile overlap discovered the candidate, but demonstrated capability has not yet been proven.' };
}

class CurrentPublicOpportunityMatchService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.maxAgeHours = Math.max(1, Number(options.maxAgeHours || process.env.MILES_OPPORTUNITY_EVIDENCE_MAX_AGE_HOURS || 48));
    this.now = options.now ? new Date(options.now) : null;
    this.index = options.indexService || new SamOpportunityNaicsIndexService({ rootDir:this.rootDir });
  }

  async match(model = {}, options = {}) {
    const started = Date.now();
    const now = options.now ? new Date(options.now) : (this.now || new Date());
    const asOf = now.toISOString().slice(0, 10);
    const source = sourceFileFromReport(this.rootDir);
    const age = ageHours(source.generatedAt, now.getTime());
    const fresh = age != null && age >= 0 && age <= this.maxAgeHours;
    const naicsSet = new Set(list(model?.profile?.naicsCodes).map(x => clean(x).replace(/\D/g,'')).filter(x => x.length >= 5));

    if (!source.report?.ok || !source.file || !fs.existsSync(source.file)) return { ok:false, status:'CURRENT_PUBLIC_OPPORTUNITY_SOURCE_UNAVAILABLE', generatedAt:new Date().toISOString(), source:{ authority:'SAM.gov Public Contract Opportunities bulk extract', reportPath:source.reportPath, file:source.file, sourceUrl:source.sourceUrl, fresh:false, ageHours:age }, records:[], blockers:['SAM_PUBLIC_OPPORTUNITY_BULK_EXTRACT_NOT_AVAILABLE'], safety:{ readOnly:true, authenticatedScraping:false, loginAutomation:false } };
    if (!fresh) return { ok:false, status:'CURRENT_PUBLIC_OPPORTUNITY_SOURCE_STALE', generatedAt:new Date().toISOString(), source:{ authority:'SAM.gov Public Contract Opportunities bulk extract', reportPath:source.reportPath, file:source.file, sourceUrl:source.sourceUrl, generatedAt:source.generatedAt, fresh:false, ageHours:age, maxAgeHours:this.maxAgeHours }, records:[], blockers:['SAM_PUBLIC_OPPORTUNITY_BULK_EXTRACT_STALE'], safety:{ readOnly:true, authenticatedScraping:false, loginAutomation:false } };
    if (!naicsSet.size) return { ok:false, status:'PROSPECT_NAICS_REQUIRED_FOR_CURRENT_OPPORTUNITY_MATCH', generatedAt:new Date().toISOString(), source:{ authority:'SAM.gov Public Contract Opportunities bulk extract', file:source.file, sourceUrl:source.sourceUrl, generatedAt:source.generatedAt, fresh:true, ageHours:age }, records:[], blockers:['PROSPECT_NAICS_UNAVAILABLE'], safety:{ readOnly:true } };

    const limit = Math.max(1, Math.min(Number(options.limit || 30), 100));
    const indexed = await this.index.rowsForNaics(source.file, [...naicsSet]);
    const candidates = [];
    let naicsMatched = 0;
    for (const row of indexed.rows) {
      const naics = clean(first(row, ['naicsCode','naics','primaryNaics'])).replace(/\D/g,'');
      if (!naicsSet.has(naics)) continue;
      naicsMatched += 1;
      const active = boolish(first(row,['active','isActive']));
      if (active === false) continue;
      const dueDate = dateOnly(first(row,['responseDeadLine','responseDeadline','dueDate','closeDate']));
      const archiveDate = dateOnly(first(row,['archiveDate']));
      if (dueDate && dueDate < asOf) continue;
      if (!dueDate && archiveDate && archiveDate < asOf) continue;
      const stage = stageOf(row);
      const title = clean(first(row,['title','opportunityTitle','solicitationTitle']));
      if (!title) continue;
      const noticeId = first(row,['noticeId','id']);
      const setAside = first(row,['setAside','setAsideDescription','typeOfSetAsideDescription']);
      const setAsideFit = compatibleSetAside(setAside, model?.profile || {});
      const capability = capabilityAssessment(title, naics, model);
      const tier = qualificationTier(capability, setAsideFit);
      const gapAnalysis = OpportunityQualificationGapService.analyze({ title, capability, setAsideFit, vehicleAccessBlocked:false });
      const reasons = [`Exact prospect NAICS ${naics} match`, 'Current public SAM.gov opportunity source', capability.reason, tier.reason];
      if (setAsideFit.reason) reasons.push(setAsideFit.reason);
      let fitScore = 45 + capability.score + setAsideFit.score;
      if (dueDate) fitScore += 5;
      if (['RFI','SOURCES_SOUGHT','PRESOLICITATION','OPEN'].includes(stage)) fitScore += 5;
      if (!capability.directFit) fitScore=Math.min(fitScore,59);
      if (setAsideFit.eligibilityBlocked) fitScore=Math.min(fitScore,49);
      if (tier.code === 'NOT_RECOMMENDED_DIRECT_PURSUIT') fitScore=Math.min(fitScore,39);
      fitScore = Math.max(0, Math.min(100, fitScore));
      candidates.push({
        id:noticeId || first(row,['solicitationNumber','solicitation']) || null,
        noticeId:noticeId || null,
        solicitationNumber:first(row,['solicitationNumber','solicitation','sol']) || null,
        title,
        market:'FEDERAL',
        stage,
        status:active === true ? 'ACTIVE' : 'CURRENT_SOURCE_RECORD',
        agency:first(row,['departmentIndAgency','department','agency']) || null,
        office:first(row,['office','subTier','subtier']) || null,
        naics,
        psc:first(row,['classificationCode','psc','pscCode']) || null,
        setAside:setAside || null,
        postedDate:dateOnly(first(row,['postedDate','publishDate'])),
        dueDate,
        estimatedValue:number(first(row,['awardAmount','awardValue','estimatedValue'])),
        source:'SAM.gov Public Contract Opportunities',
        sourceUrl:sourceUrl(row, noticeId),
        sourceAccess:'PUBLIC',
        qualification:reasons.filter(Boolean).join('; '),
        fitReasons:reasons.filter(Boolean),
        fitScore,
        capabilityStatus:capability.status,
        capabilityClass:capability.scopeClass,
        directPursuitCapabilitySupported:capability.directFit,
        eligibilityStatus:setAsideFit.eligibilityBlocked ? 'SET_ASIDE_ELIGIBILITY_NOT_CONFIRMED' : null,
        qualificationTier:tier.code,
        recommendationEligible:tier.recommendationEligible,
        allowedAction:tier.allowedAction,
        teamingPathCandidate:tier.teamingCandidate,
        qualificationGapState:gapAnalysis.state,
        nearFit:gapAnalysis.nearFit,
        materialGapCount:gapAnalysis.materialGapCount,
        missingRequirements:gapAnalysis.missingRequirements,
        qualificationGaps:gapAnalysis.gaps,
        gapClosureOptions:gapAnalysis.closureOptions,
        confidence:capability.directFit ? 'CURRENT_PUBLIC_SOURCE_WITH_DEMONSTRATED_CAPABILITY_SUPPORT' : 'CURRENT_PUBLIC_SOURCE_NAICS_CANDIDATE_CAPABILITY_VALIDATION_REQUIRED',
        freshnessAt:source.generatedAt,
        live:true
      });
    }

    const deduped = new Map();
    for (const row of candidates) {
      const key = norm(`${row.agency}|${row.title}|${row.naics}|${row.dueDate}`) || clean(row.noticeId || row.solicitationNumber);
      const current = deduped.get(key);
      if (!current || row.fitScore > current.fitScore) deduped.set(key, row);
    }
    const records = [...deduped.values()]
      .sort((a,b) => (b.fitScore-a.fitScore) || clean(a.dueDate || '9999-12-31').localeCompare(clean(b.dueDate || '9999-12-31')))
      .slice(0, limit);

    const qualification = {
      discovered:records.length,
      directFitSupported:records.filter(row=>row.qualificationTier==='DIRECT_FIT_SUPPORTED').length,
      teamingPathSupported:records.filter(row=>row.qualificationTier==='TEAMING_PATH_SUPPORTED').length,
      nearFitGapClosable:records.filter(row=>row.nearFit===true).length,
      capabilityValidationRequired:records.filter(row=>row.qualificationTier==='CAPABILITY_VALIDATION_REQUIRED').length,
      notRecommendedDirectPursuit:records.filter(row=>row.qualificationTier==='NOT_RECOMMENDED_DIRECT_PURSUIT').length,
      recommendationEligible:records.filter(row=>row.recommendationEligible===true).length,
      rule:'Discovery is not qualification. ORION preserves near-fit candidates when a discrete capability, eligibility, or access gap may be closable and states the missing requirement plus closure options.'
    };

    return {
      ok:true,
      status:records.length ? 'CURRENT_PUBLIC_OPPORTUNITY_CANDIDATES_AVAILABLE' : 'NO_CURRENT_PUBLIC_NAICS_MATCHES_FOUND',
      generatedAt:new Date().toISOString(),
      source:{ authority:'SAM.gov Public Contract Opportunities bulk extract', reportPath:source.reportPath, file:source.file, sourceUrl:source.sourceUrl, generatedAt:source.generatedAt, fresh:true, ageHours:age, maxAgeHours:this.maxAgeHours },
      match:{
        asOfDate:asOf,
        prospectNaics:[...naicsSet],
        rowsScanned:indexed.rows.length,
        exactNaicsRows:naicsMatched,
        candidatesBeforeDedupe:candidates.length,
        returned:records.length,
        directCapabilitySupported:records.filter(row=>row.directPursuitCapabilitySupported===true).length,
        capabilityValidationRequired:records.filter(row=>row.directPursuitCapabilitySupported!==true).length,
        qualification,
        lookupMs:indexed.lookupMs,
        totalMatchMs:Date.now()-started,
        indexKind:indexed.cacheKind,
        rule:'Exact NAICS discovers candidates only. Full qualification requires solicitation-specific requirement validation against authoritative company evidence.'
      },
      qualification,
      records,
      blockers:[],
      safety:{ readOnly:true, authenticatedScraping:false, loginAutomation:false, restrictedPortalAccess:false }
    };
  }
}

module.exports = CurrentPublicOpportunityMatchService;
module.exports.stageOf = stageOf;
module.exports.sourceFileFromReport = sourceFileFromReport;
module.exports.compatibleSetAside = compatibleSetAside;
module.exports.scopeClass = scopeClass;
module.exports.capabilityAssessment = capabilityAssessment;
module.exports.qualificationTier = qualificationTier;
