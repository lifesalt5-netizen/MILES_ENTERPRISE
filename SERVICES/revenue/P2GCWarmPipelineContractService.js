'use strict';

const path = require('path');

const SHEET_NAME = 'Warm Prospect Master';
const EXISTING_HEADERS = Object.freeze([
  'Company','Primary Contact','Email','Phone','Relationship','Evidence Level','Last Known Stage','Last Known Touch',
  'Past Conversation / Need','What They Wanted','Known Price / Terms','Potential Value','Value Basis','Objection / Why Stalled',
  'Federal Position / Vehicles','Agencies / Buyers','Current Trigger / Opportunity','Biggest Gap','Reason to Reopen Now',
  'Recommended P2GC Offer','Next Action','Demo Required?','Best Outreach','Evidence Source','Source Confidence',
  'Commercial Terms / Proposal','Explicit Need','Meeting / Call','Specific Gov Issue','Timing / Trigger','Multiple Interactions',
  'Decision Maker Involved','Prior Paid / Client','Clear No','Unqualified','Score','Priority','Outreach Status','Last Outreach Result',
  'Next Follow-Up','Contact Verified?'
]);

const INTENT_HEADERS = Object.freeze([
  'Website / Domain','Contact Title','Profile / LinkedIn','Lead Source','Source URL','Original Post Date','Date Discovered',
  'Request / Pain Point','Signal Excerpt','Lead Category','Lead Temperature','Urgency','P2GC Fit','Research Completed',
  'Research Evidence URLs','Outreach Prepared','Outreach Sent','Follow-Up Date','Response','Closed / Won / Lost','Revenue','Notes'
]);

const REQUIRED_HEADERS = Object.freeze([...EXISTING_HEADERS, ...INTENT_HEADERS]);
const TEMPERATURE_PRIORITY = Object.freeze({ HOT: 'HOT-INTENT', WARM: 'WARM-INTENT', WATCH: 'WATCH-INTENT' });

function clean(v){ return String(v ?? '').trim(); }
function lower(v){ return clean(v).toLowerCase(); }
function normalizeCompany(v){ return clean(v).toUpperCase().replace(/&/g,' AND ').replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function normalizeDomain(v){
  const raw=clean(v); if(!raw) return '';
  try { const u=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`); return u.hostname.toLowerCase().replace(/^www\./,''); }
  catch { return raw.toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split(/[/?#]/)[0]; }
}
function truthyText(v){ return v===true ? 'Y' : v===false ? 'N' : clean(v); }
function joinUrls(v){ return Array.isArray(v) ? v.map(clean).filter(Boolean).join(' | ') : clean(v); }

class P2GCWarmPipelineContractService {
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,'..','..'));
    this.workbookPath=options.workbookPath||process.env.P2GC_WARM_PIPELINE_XLSX||path.join(this.rootDir,'DATA','crm','P2GC_Warm_Prospect_Reactivation_Master_UPDATED_2026-08-28.xlsx');
    this.sheetName=options.sheetName||SHEET_NAME;
  }

  schema(){
    return {
      sheetName:this.sheetName,
      existingHeaders:[...EXISTING_HEADERS],
      intentHeaders:[...INTENT_HEADERS],
      requiredHeaders:[...REQUIRED_HEADERS],
      workbookPath:this.workbookPath,
      dedupePriority:['EMAIL','DOMAIN','COMPANY','CONTACT+COMPANY']
    };
  }

  validateHeaders(headers=[]){
    const actual=new Set((Array.isArray(headers)?headers:[]).map(clean));
    const missingExisting=EXISTING_HEADERS.filter(h=>!actual.has(h));
    const missingIntent=INTENT_HEADERS.filter(h=>!actual.has(h));
    return {
      ok:missingExisting.length===0,
      existingSchemaIntact:missingExisting.length===0,
      missingExisting,
      missingIntent,
      headersToAppend:missingIntent
    };
  }

  identity(row={}){
    const email=lower(row.Email||row.email||row.contactEmail);
    const domain=normalizeDomain(row['Website / Domain']||row.website||row.domain||row.companyDomain||(email.includes('@')?email.split('@')[1]:''));
    const company=normalizeCompany(row.Company||row.company||row.companyName||row.legalName);
    const contact=lower(row['Primary Contact']||row.contactName||row.person||row.poster);
    return {email,domain,company,contact};
  }

  matchScore(existing={},incoming={}){
    const a=this.identity(existing), b=this.identity(incoming);
    if(a.email&&b.email&&a.email===b.email) return {matched:true,score:100,reason:'EMAIL'};
    if(a.domain&&b.domain&&a.domain===b.domain) return {matched:true,score:90,reason:'DOMAIN'};
    if(a.company&&b.company&&a.company===b.company) return {matched:true,score:80,reason:'COMPANY'};
    if(a.contact&&b.contact&&a.company&&b.company&&a.contact===b.contact&&a.company===b.company) return {matched:true,score:70,reason:'CONTACT+COMPANY'};
    return {matched:false,score:0,reason:null};
  }

  findMatch(rows=[],incoming={}){
    let best=null;
    for(let i=0;i<(Array.isArray(rows)?rows:[]).length;i++){
      const match=this.matchScore(rows[i],incoming);
      if(match.matched&&(!best||match.score>best.score)) best={index:i,row:rows[i],...match};
    }
    return best;
  }

  mapLead(lead={}){
    const latestSignal=Array.isArray(lead.signals)&&lead.signals.length ? lead.signals[lead.signals.length-1] : {};
    const sourceUrl=clean(lead.sourceUrl||latestSignal.sourceUrl);
    const sourcePlatform=clean(lead.sourcePlatform||latestSignal.sourcePlatform);
    const originalPostDate=clean(lead.originalPostDate||latestSignal.originalPostDate);
    const discoveredAt=clean(lead.discoveredAt||latestSignal.discoveredAt||lead.createdAt);
    const needSummary=clean(lead.currentNeed||lead.needSummary||latestSignal.needSummary);
    const excerpt=clean(lead.excerpt||latestSignal.excerpt).slice(0,600);
    const temperature=clean(lead.leadTemperature||lead.temperature||'WATCH').toUpperCase();
    const category=clean(lead.leadCategory||latestSignal.signalType);
    const fit=clean(lead.fitRationale||latestSignal.fitRationale);
    const research=lead.research||{};
    const outreach=lead.outreach||{};
    const row={
      'Company':clean(lead.company||lead.companyName),
      'Primary Contact':clean(lead.contactName||lead.person||lead.poster),
      'Email':lower(lead.email||lead.contactEmail),
      'Phone':clean(lead.phone),
      'Relationship':clean(lead.relationship)||'Current intent lead',
      'Evidence Level':clean(lead.evidenceLevel)||'Current public signal',
      'Last Known Stage':clean(lead.lastKnownStage)||'Intent Signal / Research',
      'Last Known Touch':clean(lead.lastKnownTouch),
      'Past Conversation / Need':clean(lead.pastConversation)||needSummary,
      'What They Wanted':clean(lead.whatTheyWanted)||needSummary,
      'Known Price / Terms':clean(lead.knownPriceTerms),
      'Potential Value':lead.potentialValue==null?'':lead.potentialValue,
      'Value Basis':clean(lead.valueBasis),
      'Objection / Why Stalled':clean(lead.objection),
      'Federal Position / Vehicles':clean(research.federalPosition||lead.federalPosition),
      'Agencies / Buyers':clean(research.agenciesBuyers||lead.agenciesBuyers),
      'Current Trigger / Opportunity':needSummary,
      'Biggest Gap':clean(research.biggestGap||lead.biggestGap),
      'Reason to Reopen Now':clean(lead.reasonToAct)||fit,
      'Recommended P2GC Offer':clean(lead.recommendedService||lead.recommendedP2GCOffer),
      'Next Action':clean(lead.nextAction)||'Complete current research and prepare company-specific same-day outreach.',
      'Demo Required?':clean(lead.demoRequired)||'No — use current research/evidence',
      'Best Outreach':clean(lead.bestOutreach)||'Personal email + LinkedIn/message when appropriate',
      'Evidence Source':sourceUrl||sourcePlatform,
      'Source Confidence':clean(lead.sourceConfidence)||'Current public source',
      'Commercial Terms / Proposal':clean(lead.proposal),
      'Explicit Need':truthyText(lead.explicitNeed!==undefined?lead.explicitNeed:true),
      'Meeting / Call':clean(lead.meeting),
      'Specific Gov Issue':category||needSummary,
      'Timing / Trigger':clean(lead.urgency||latestSignal.urgency)||originalPostDate,
      'Multiple Interactions':truthyText(lead.multipleInteractions),
      'Decision Maker Involved':truthyText(lead.decisionMakerInvolved),
      'Prior Paid / Client':truthyText(lead.priorPaidClient),
      'Clear No':truthyText(lead.clearNo!==undefined?lead.clearNo:false),
      'Unqualified':truthyText(lead.unqualified!==undefined?lead.unqualified:false),
      'Score':lead.score==null?'':lead.score,
      'Priority':clean(lead.priority)||TEMPERATURE_PRIORITY[temperature]||'WATCH-INTENT',
      'Outreach Status':clean(lead.outreachStatus)||(lead.outreachSent?'Sent':lead.outreachPrepared?'Prepared':'Not Contacted'),
      'Last Outreach Result':clean(lead.lastOutreachResult||lead.response),
      'Next Follow-Up':clean(lead.followUpDate),
      'Contact Verified?':clean(lead.contactVerified)||'Needs verification',
      'Website / Domain':clean(lead.website||lead.domain||lead.companyDomain),
      'Contact Title':clean(lead.title),
      'Profile / LinkedIn':clean(lead.profileUrl||lead.linkedin),
      'Lead Source':sourcePlatform,
      'Source URL':sourceUrl,
      'Original Post Date':originalPostDate,
      'Date Discovered':discoveredAt,
      'Request / Pain Point':needSummary,
      'Signal Excerpt':excerpt,
      'Lead Category':category,
      'Lead Temperature':temperature,
      'Urgency':clean(lead.urgency||latestSignal.urgency),
      'P2GC Fit':fit,
      'Research Completed':truthyText(lead.researchCompleted),
      'Research Evidence URLs':joinUrls(research.evidenceUrls||lead.researchEvidenceUrls),
      'Outreach Prepared':truthyText(lead.outreachPrepared),
      'Outreach Sent':truthyText(lead.outreachSent),
      'Follow-Up Date':clean(lead.followUpDate),
      'Response':clean(lead.response),
      'Closed / Won / Lost':clean(lead.disposition||lead.closedStatus)||'OPEN',
      'Revenue':lead.revenue==null?'':lead.revenue,
      'Notes':clean(lead.notes)
    };
    return row;
  }

  mergeRow(existing={},incomingMapped={}){
    const merged={...existing};
    for(const header of REQUIRED_HEADERS){
      const next=incomingMapped[header];
      if(next!==undefined&&next!==null&&String(next).trim()!=='') merged[header]=next;
      else if(!(header in merged)) merged[header]='';
    }
    return merged;
  }

  planUpsert(rows=[],lead={}){
    const mapped=this.mapLead(lead);
    const match=this.findMatch(rows,mapped);
    if(match){
      return {ok:true,action:'UPDATE',matchIndex:match.index,matchReason:match.reason,row:this.mergeRow(match.row,mapped),schema:this.schema()};
    }
    return {ok:true,action:'APPEND',matchIndex:null,matchReason:null,row:this.mergeRow({},mapped),schema:this.schema()};
  }
}

module.exports=P2GCWarmPipelineContractService;
module.exports.SHEET_NAME=SHEET_NAME;
module.exports.EXISTING_HEADERS=EXISTING_HEADERS;
module.exports.INTENT_HEADERS=INTENT_HEADERS;
module.exports.REQUIRED_HEADERS=REQUIRED_HEADERS;
