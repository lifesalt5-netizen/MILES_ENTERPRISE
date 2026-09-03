'use strict';

const gsaEbuyPolicy = require('../governance/GsaEbuyAccessPolicyService');
const universalPolicy = require('../governance/UniversalGovernmentOpportunityIndexPolicyService');

function clean(v) { return String(v == null ? '' : v).trim(); }
function norm(v) { return clean(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function list(v) { return Array.isArray(v) ? v.filter(Boolean) : (v == null || v === '' ? [] : [v]); }
function pick(row, names) { for (const n of names) if (row && row[n] != null && clean(row[n]) !== '') return row[n]; return null; }
function dateOnly(v) { const d = new Date(v || 0); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0,10); }

const MARKETS = Object.freeze(['FEDERAL','SLED','LOCAL']);
const STAGES = Object.freeze(['OPEN','RFI','SOURCES_SOUGHT','PRESOLICITATION','DRAFT','FORECAST','RECOMPETE','RECENT_SIMILAR_AWARD','SPECIAL_NOTICE','UNKNOWN']);
const STAGE_PRIORITY = Object.freeze({ OPEN:0,RFI:1,SOURCES_SOUGHT:2,PRESOLICITATION:3,DRAFT:4,FORECAST:5,SPECIAL_NOTICE:6,RECOMPETE:7,RECENT_SIMILAR_AWARD:8,UNKNOWN:9 });

function stageOf(row = {}) {
  const code = clean(pick(row,['ptype','noticeTypeCode','notice_type_code'])).toLowerCase();
  const text = norm([pick(row,['noticeType','notice_type','type','opportunityType','procurement_type','stage','status']),pick(row,['title','name','opportunity_title','solicitation_title']),pick(row,['description','summary','synopsis','qualification'])].filter(Boolean).join(' '));
  if (code === 'r' || /SOURCES SOUGHT|SOURCE SOUGHT/.test(text)) return 'SOURCES_SOUGHT';
  if (/\bRFI\b|REQUEST FOR INFORMATION/.test(text)) return 'RFI';
  if (code === 'p' || /PRESOLICIT|PRE SOLICIT/.test(text)) return 'PRESOLICITATION';
  if (/DRAFT RFP|DRAFT RFQ|DRAFT SOLICIT|DRAFT REQUEST/.test(text)) return 'DRAFT';
  if (/FORECAST|PROCUREMENT PLAN|ACQUISITION PLAN|CAPITAL IMPROVEMENT PLAN|\bCIP\b|BUDGET SIGNAL/.test(text)) return 'FORECAST';
  if (/RECOMPETE|RE COMPETE|EXPIRING CONTRACT|EXPIRATION SIGNAL/.test(text)) return 'RECOMPETE';
  if (code === 'a' || /AWARD NOTICE|RECENT SIMILAR AWARD|HISTORICAL MISSED|AWARDED TO/.test(text)) return 'RECENT_SIMILAR_AWARD';
  if (code === 's' || /SPECIAL NOTICE/.test(text)) return 'SPECIAL_NOTICE';
  if (code === 'o' || code === 'k' || /SOLICITATION|REQUEST FOR PROPOSAL|\bRFP\b|REQUEST FOR QUOTE|\bRFQ\b|INVITATION FOR BID|\bIFB\b|OPEN BID/.test(text)) return 'OPEN';
  return 'UNKNOWN';
}

function marketOf(row = {}) {
  const explicit = norm(pick(row,['market','marketLevel','market_level','jurisdiction_level','government_level','source_level','level']));
  if (/LOCAL|COUNTY|CITY|MUNICIPAL|TOWN|VILLAGE|DISTRICT|AUTHORITY/.test(explicit)) return 'LOCAL';
  if (/SLED|STATE|STATEWIDE|EDUCATION/.test(explicit)) return 'SLED';
  if (/FEDERAL/.test(explicit)) return 'FEDERAL';
  const text = norm([pick(row,['source','sourceName','source_name','portal','source_url','url']),pick(row,['agency','department','organization','buyer'])].filter(Boolean).join(' '));
  if (/SAM GOV|USASPENDING|FEDERAL|UNITED STATES|DEPARTMENT OF|GSA|NASA|DHS|HHS|VETERANS AFFAIRS|US ARMY|US NAVY|AIR FORCE/.test(text)) return 'FEDERAL';
  if (/COUNTY|CITY OF|TOWN OF|VILLAGE OF|SCHOOL DISTRICT|TRANSIT AUTHORITY|AIRPORT AUTHORITY|WATER DISTRICT|PORT AUTHORITY/.test(text)) return 'LOCAL';
  if (/STATE OF|COMMONWEALTH OF|UNIVERSITY|STATE UNIVERSITY|DEPARTMENT OF TRANSPORTATION/.test(text)) return 'SLED';
  return clean(row.market) || 'FEDERAL';
}

function normalizeRecord(row = {}, defaults = {}) {
  const market = MARKETS.includes(clean(defaults.market || row.market).toUpperCase()) ? clean(defaults.market || row.market).toUpperCase() : marketOf(row);
  const stage = STAGES.includes(clean(defaults.stage || row.stage).toUpperCase()) ? clean(defaults.stage || row.stage).toUpperCase() : stageOf(row);
  const sourceUrl = pick(row,['sourceUrl','source_url','url','link']);
  return {
    id:pick(row,['id','noticeId','notice_id','solicitationNumber','solicitation_number','opportunity_id','award_id']) || null,
    noticeId:pick(row,['noticeId','notice_id']) || null,
    solicitationNumber:pick(row,['solicitationNumber','solicitation_number']) || null,
    market,
    stage,
    title:pick(row,['title','name','opportunity_title','solicitation_title']) || 'Untitled government opportunity signal',
    agency:pick(row,['agency','department','organization','buyer','awardingAgency']) || null,
    office:pick(row,['office','subAgency','sub_agency','awardingSubAgency']) || null,
    naics:pick(row,['naics','naicsCode','naics_code','primary_naics']) || null,
    psc:pick(row,['psc','pscCode','psc_code']) || null,
    setAside:pick(row,['setAside','set_aside','setAsideDescription','typeOfSetAsideDescription']) || null,
    postedDate:dateOnly(pick(row,['postedDate','posted_date','publishDate','publish_date','date'])),
    dueDate:dateOnly(pick(row,['dueDate','due_date','responseDeadLine','response_deadline','closeDate','close_date'])),
    estimatedValue:Number.isFinite(Number(pick(row,['estimatedValue','estimated_value','value','amount']))) ? Number(pick(row,['estimatedValue','estimated_value','value','amount'])) : null,
    source:pick(row,['source','sourceName','source_name','portal']) || defaults.source || null,
    sourceUrl:sourceUrl || null,
    sourceAccess:defaults.sourceAccess || row.sourceAccess || 'PUBLIC_OR_STAGED',
    qualification:pick(row,['qualification','prospectClaim','fitReason','fit_reason']) || defaults.qualification || null,
    fitScore:Number.isFinite(Number(row.fitScore)) ? Number(row.fitScore) : null,
    confidence:pick(row,['confidence','evidenceConfidence','evidence_confidence']) || defaults.confidence || 'SOURCE_DEPENDENT',
    capabilityStatus:row.capabilityStatus || null,
    capabilityClass:row.capabilityClass || null,
    directPursuitCapabilitySupported:row.directPursuitCapabilitySupported === true ? true : (row.directPursuitCapabilitySupported === false ? false : null),
    directPursuitEligible:row.directPursuitEligible === true ? true : (row.directPursuitEligible === false ? false : null),
    eligibilityStatus:row.eligibilityStatus || null,
    eligibilityBlocker:row.eligibilityBlocker || null,
    fitReasons:list(row.fitReasons),
    freshnessAt:pick(row,['freshnessAt','generatedAt','updatedAt','updated_at','last_seen_at']) || defaults.freshnessAt || null,
    collectionPriority:Number.isFinite(Number(defaults.collectionPriority)) ? Number(defaults.collectionPriority) : 1
  };
}

function semanticKey(row) {
  return norm([row.market,row.agency,row.title,row.naics,row.dueDate].join('|')) || clean(row.solicitationNumber || row.noticeId || row.id);
}
function dedupe(records = []) {
  const map = new Map();
  for (const row of records) {
    const key = semanticKey(row);
    if (!key) continue;
    const current = map.get(key);
    if (!current || Number(row.fitScore||0)>Number(current.fitScore||0) || (!current.sourceUrl && row.sourceUrl) || (!current.dueDate && row.dueDate)) map.set(key,row);
  }
  return [...map.values()];
}

class DemoUnifiedOpportunityService {
  build(model = {}, additions = [], context = {}) {
    const base = [];
    const blockedGatedSources = [];
    const accessContext = Object.keys(context || {}).length ? context : { prospectDemo:true,activePayingClient:false,dedicatedClientWorkspace:false,authorizedAccess:false,withinGrantedScope:false };

    const addGoverned = (row, defaults = {}) => {
      const normalized = normalizeRecord(row, defaults);
      const universalAccess = universalPolicy.classify({ ...row, ...normalized }, accessContext);
      if (!universalAccess.allowed) {
        blockedGatedSources.push({ source:normalized.source || null,sourceUrl:normalized.sourceUrl || null,market:normalized.market,stage:normalized.stage,evidenceLane:universalAccess.evidenceLane,badge:universalAccess.badge,reason:universalAccess.reason,fallbackRequired:universalAccess.fallbackRequired === true });
        return;
      }
      const ebuyAccess = gsaEbuyPolicy.evaluate({ ...row, ...normalized }, { authorizedEbuyAccess:accessContext.authorizedEbuyAccess === true || accessContext.authorizedAccess === true,accessEvidenceId:accessContext.accessEvidenceId || row.accessEvidenceId || row.authorizedAccessEvidence,withinGrantedScope:accessContext.withinGrantedScope !== false && row.withinGrantedScope !== false });
      if (!ebuyAccess.allowed) {
        blockedGatedSources.push({ source:normalized.source || null,sourceUrl:normalized.sourceUrl || null,market:normalized.market,stage:normalized.stage,evidenceLane:'COVERAGE_GAP',badge:'GATED / COVERAGE GAP',reason:ebuyAccess.reason,fallbackRequired:true,fallbackMode:ebuyAccess.fallbackMode });
        return;
      }
      normalized.evidenceLane = universalAccess.evidenceLane;
      normalized.evidenceBadge = universalAccess.badge;
      normalized.live = universalAccess.live === true;
      normalized.restricted = universalAccess.restricted === true;
      normalized.accessDecisionStatus = ebuyAccess.status === 'NOT_EBUY_SOURCE' ? universalAccess.evidenceLane : ebuyAccess.status;
      if (ebuyAccess.requiredLabel) normalized.sourceAccess = ebuyAccess.requiredLabel;
      base.push(normalized);
    };

    for (const row of list(model.opportunities?.liveAndForecast)) addGoverned(row,{collectionPriority:0});
    for (const row of list(model.opportunities?.recompetes)) addGoverned(row,{stage:'RECOMPETE',collectionPriority:2});
    for (const row of list(model.opportunities?.similarRecentAwards)) addGoverned(row,{stage:'RECENT_SIMILAR_AWARD',sourceAccess:'PUBLIC_AWARD_HISTORY',collectionPriority:3});
    for (const row of list(additions)) addGoverned(row,{collectionPriority:0});

    const records = dedupe(base).sort((a,b) => {
      const score = Number(b.fitScore || 0) - Number(a.fitScore || 0);
      if (score) return score;
      const collectionPriority = Number(a.collectionPriority || 0) - Number(b.collectionPriority || 0);
      if (collectionPriority) return collectionPriority;
      const stagePriority = Number(STAGE_PRIORITY[a.stage] ?? 99) - Number(STAGE_PRIORITY[b.stage] ?? 99);
      if (stagePriority) return stagePriority;
      const aDate = clean(a.dueDate || a.postedDate || '9999-12-31');
      const bDate = clean(b.dueDate || b.postedDate || '9999-12-31');
      return aDate.localeCompare(bDate);
    });

    const byMarket = {};
    for (const market of MARKETS) {
      const marketRecords = records.filter(r => r.market === market);
      const byStage = {};
      for (const stage of STAGES) byStage[stage] = marketRecords.filter(r => r.stage === stage);
      byMarket[market] = { total:marketRecords.length, records:marketRecords, byStage };
    }
    const byEvidenceLane = records.reduce((acc, row) => { const lane = row.evidenceLane || 'UNKNOWN'; if (!acc[lane]) acc[lane] = []; acc[lane].push(row); return acc; }, {});

    return {
      status:records.length ? 'UNIVERSAL_GOVERNMENT_OPPORTUNITY_INDEX_AVAILABLE' : 'NO_QUALIFIED_PUBLIC_OPPORTUNITY_OR_HISTORY_SIGNAL',
      markets:byMarket,
      evidenceLanes:byEvidenceLane,
      records,
      totals:{ all:records.length, federal:byMarket.FEDERAL.total, sled:byMarket.SLED.total, local:byMarket.LOCAL.total },
      taxonomy:{ markets:MARKETS, stages:STAGES },
      sourceAccessGovernance:{ policy:'UNIVERSAL_GOVERNMENT_OPPORTUNITY_INDEX',blockedUnauthorizedOrGatedRecords:blockedGatedSources.length,blockedGatedSources,prospectDemo:accessContext.prospectDemo === true,activePayingClient:accessContext.activePayingClient === true,dedicatedClientWorkspace:accessContext.dedicatedClientWorkspace === true,fallbackMode:'PUBLIC_AWARD_HISTORY_FORECAST_RECOMPETE_AND_VEHICLE_INTELLIGENCE' },
      rules:{ publicSourcesPreferred:true,bypassAuthentication:false,bypassAccessControls:false,unauthorizedAuthenticatedScraping:false,restrictedLiveRequiresActivePayingClientDedicatedWorkspaceAuthorizationAndEvidence:true,restrictedClientDataNeverAllowedInProspectDemo:true,loginGatedSourcesNeverPretendedLive:true,historicalProxyMustBeLabeledNonLive:true,noFitBehavior:'SHOW_NO_QUALIFIED_FITS_WITH_SOURCE_COVERAGE_INSTEAD_OF_BROKEN_BLANK',lockedPreview:'REVEAL_SMALL_NUMBER_OF_KNOWN_MATCHES_AND_LOCK_ONLY_REAL_REMAINDER',capabilityRule:'NAICS_IS_CANDIDATE_DISCOVERY_ONLY_DIRECT_FIT_REQUIRES_DEMONSTRATED_CAPABILITY_EVIDENCE' }
    };
  }
}

module.exports = DemoUnifiedOpportunityService;
module.exports.normalizeRecord = normalizeRecord;
module.exports.stageOf = stageOf;
module.exports.marketOf = marketOf;
module.exports.semanticKey = semanticKey;
module.exports.dedupe = dedupe;
