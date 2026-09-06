'use strict';

const fs = require('fs');
const path = require('path');
const Policy = require('./P2GCMarketingSalesOperatingPolicy');
const P2GCWarmPipelineContractService = require('./P2GCWarmPipelineContractService');

function clean(v){ return String(v ?? '').trim(); }
function lower(v){ return clean(v).toLowerCase(); }
function arr(v){ return Array.isArray(v) ? v : []; }
function num(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
function mkdir(dir){ fs.mkdirSync(dir,{recursive:true}); }
function readJson(file,fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return fallback;} }
function writeJson(file,value){ mkdir(path.dirname(file)); fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n','utf8'); }
function readJsonl(file){ try{return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}catch{return [];} }
function appendJsonl(file,value){ mkdir(path.dirname(file)); fs.appendFileSync(file,JSON.stringify(value)+'\n','utf8'); }
function iso(v){ const d=v?new Date(v):new Date(); return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString(); }
function dayKey(v){ return iso(v).slice(0,10); }
function startOfWeek(now=new Date()){
  const d=new Date(now); const day=(d.getDay()+6)%7; d.setHours(0,0,0,0); d.setDate(d.getDate()-day); return d;
}
function startOfMonth(now=new Date()){ const d=new Date(now); d.setHours(0,0,0,0); d.setDate(1); return d; }
function within(ts,start,end){ const t=Date.parse(ts||''); return Number.isFinite(t)&&t>=start.getTime()&&t<=end.getTime(); }

const FUNNEL_STAGES=[
  'companiesScanned','companiesWithMeaningfulFinding','outreachSent','replies','positiveReplies','diagnosticRequested',
  'diagnosticViewed','fullReviewRequested','qualified','meeting','proposal','closedWon','revenue'
];

const SEGMENTS=[
  'P2GC – GSA No Sales','P2GC – GSA Low Sales','P2GC – VA Growth','P2GC – Recompete / Protect Revenue',
  'P2GC – Agency Concentration','P2GC – Agency Expansion','P2GC – Sub → Prime','P2GC – Teaming',
  'P2GC – Qualified Capture','P2GC – Vehicle Expansion','P2GC – SLED/Commercial → Federal','P2GC – Established Federal Growth'
];

class P2GCMarketingActivityService {
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,'..','..'));
    this.dataDir=path.join(this.rootDir,'DATA','marketing_activity');
    this.publicDir=path.join(this.rootDir,'SERVICES','ceo_dashboard','public');
    this.paths={
      history:path.join(this.dataDir,'activity_history.jsonl'),
      calendar:path.join(this.dataDir,'calendar.json'),
      campaigns:path.join(this.dataDir,'campaigns.json'),
      messages:path.join(this.dataDir,'message_library.json'),
      domains:path.join(this.dataDir,'domain_health.json'),
      diagnostics:path.join(this.dataDir,'diagnostics.json'),
      interactions:path.join(this.dataDir,'diagnostic_interactions.jsonl'),
      qualification:path.join(this.dataDir,'qualification.jsonl'),
      warmSync:path.join(this.dataDir,'warm_pipeline_sync_queue.json'),
      snapshot:path.join(this.dataDir,'latest_ceo_snapshot.json'),
      publicSnapshot:path.join(this.publicDir,'marketing-activity.json')
    };
    this.warmPipeline=new P2GCWarmPipelineContractService({rootDir:this.rootDir});
    this.ensureBootstrap();
  }

  ensureBootstrap(){
    mkdir(this.dataDir);
    const defaults={
      [this.paths.calendar]:[], [this.paths.campaigns]:[], [this.paths.messages]:[], [this.paths.diagnostics]:[], [this.paths.warmSync]:[]
    };
    for(const [file,value] of Object.entries(defaults)) if(!fs.existsSync(file)) writeJson(file,value);
    if(!fs.existsSync(this.paths.domains)){
      const secondary=Policy.DEFAULT_SECONDARY_DOMAINS.map(domain=>({domain,mailbox:'',warmupStatus:'UNKNOWN',sendingStatus:'PAUSED',dailyVolume:0,bounceRate:null,replyRate:null,spamComplaintSignals:null,inboxPlacementStatus:'UNKNOWN',healthIndicator:'WATCH',lastHealthCheck:null,recommendedMaxSendingVolume:0}));
      secondary.unshift({domain:'p2gc.com',mailbox:'',warmupStatus:'N/A',sendingStatus:'DISABLED',dailyVolume:0,bounceRate:null,replyRate:null,spamComplaintSignals:null,inboxPlacementStatus:'PROTECTED_PRIMARY_DOMAIN',healthIndicator:'PROTECTED',lastHealthCheck:new Date().toISOString(),recommendedMaxSendingVolume:0,coldSendingDisabled:true});
      writeJson(this.paths.domains,secondary);
    }
    if(!fs.existsSync(this.paths.snapshot)) this.refreshSnapshot();
  }

  recordActivity(input={}){
    const record=Policy.activityRecord(input);
    if(record.senderMailbox && Policy.isProtectedDomain(record.senderMailbox) && /COLD|FIRST_TOUCH|FOLLOW_UP|PROSPECT/i.test(record.action)){
      record.status='BLOCKED';
      record.result={code:'P2GC_PRIMARY_DOMAIN_COLD_SEND_HARD_BLOCK'};
    }
    appendJsonl(this.paths.history,record);
    this.refreshSnapshot();
    return record;
  }

  scheduleActivity(input={}){
    const items=readJson(this.paths.calendar,[]);
    const item={
      id:input.id||`cal_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
      scheduledAt:iso(input.scheduledAt), channel:clean(input.channel).toUpperCase(), campaign:clean(input.campaign), segment:clean(input.segment),
      action:clean(input.action), message:clean(input.message), subject:clean(input.subject), audienceSize:num(input.audienceSize), status:clean(input.status||'PLANNED').toUpperCase(),
      sendingMailbox:lower(input.sendingMailbox), senderDisplayName:'Kevin', account:clean(input.account), createdAt:new Date().toISOString()
    };
    if(item.sendingMailbox && Policy.isProtectedDomain(item.sendingMailbox)){
      item.status='BLOCKED'; item.blockReason='P2GC_PRIMARY_DOMAIN_COLD_SEND_HARD_BLOCK';
    }
    items.push(item); writeJson(this.paths.calendar,items); this.refreshSnapshot(); return item;
  }

  registerMessageVersion(input={}){
    const library=readJson(this.paths.messages,[]);
    const item={
      id:input.id||`msg_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, createdAt:new Date().toISOString(),
      version:clean(input.version||`v${library.length+1}`), active:input.active!==false, channel:clean(input.channel).toUpperCase(), segment:clean(input.segment),
      type:clean(input.type), subject:clean(input.subject), content:clean(input.content), cta:clean(input.cta), metrics:{sends:0,positiveReplies:0,diagnosticRequests:0,meetings:0,closedRevenue:0}
    };
    library.push(item); writeJson(this.paths.messages,library); this.refreshSnapshot(); return item;
  }

  registerCampaign(input={}){
    const campaigns=readJson(this.paths.campaigns,[]);
    const identity=Policy.validateVisibleIdentity({senderName:input.senderDisplayName||'Kevin',companyName:'Pathways 2 Government Contracting'});
    if(!identity.ok) return identity;
    const sender=Policy.assertColdSenderSafe(input.sendingMailbox,{mailboxHealthy:input.mailboxHealthy===true,healthVerifiedAt:input.healthVerifiedAt});
    if(!sender.ok) return sender;
    const firstTouch=Policy.validateFirstTouch({body:input.firstTouchBody,hasAttachment:input.hasAttachment,hasCalendly:input.hasCalendly,diagnosticLink:input.diagnosticLink,asksForMeeting:input.asksForMeeting});
    if(!firstTouch.ok) return {ok:false,code:'P2GC_FIRST_TOUCH_POLICY_BLOCK',errors:firstTouch.errors};
    const item={
      id:input.id||`camp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, name:clean(input.name), segment:clean(input.segment), sendingDomain:Policy.domainOf(input.sendingMailbox),
      sendingMailbox:lower(input.sendingMailbox), senderDisplayName:'Kevin', subject:clean(input.subject), firstTouchBody:clean(input.firstTouchBody), personalizationVariables:arr(input.personalizationVariables),
      createdAt:new Date().toISOString(), status:clean(input.status||'READY').toUpperCase(), metrics:{qualifiedCompanies:0,emailsScheduled:0,sent:0,replies:0,positiveReplies:0,negativeReplies:0,diagnosticRequests:0,diagnosticViews:0,qualifiedReviewRequests:0,meetings:0,proposals:0,closes:0,revenue:0,spamComplaints:0,unsubscribes:0,bounces:0}
    };
    campaigns.push(item); writeJson(this.paths.campaigns,campaigns); this.refreshSnapshot(); return {ok:true,campaign:item};
  }

  registerDiagnostic(input={}){
    const findings=arr(input.findings).filter(f=>f&&clean(f.finding)&&clean(f.source)&&clean(f.asOfDate));
    if(!clean(input.company)||findings.length===0) return {ok:false,code:'P2GC_DIAGNOSTIC_REQUIRES_COMPANY_AND_SOURCED_FINDING'};
    const diagnostics=readJson(this.paths.diagnostics,[]);
    const token=Policy.createPrivateDiagnosticToken();
    const diagnostic={
      id:input.id||`diag_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, token, privatePath:Policy.buildPrivateDiagnosticPath(token), company:clean(input.company), website:clean(input.website), contact:clean(input.contact), contactRole:clean(input.contactRole), email:lower(input.email), UEI:clean(input.UEI), CAGE:clean(input.CAGE),
      federalStatus:clean(input.federalStatus), gsaStatus:clean(input.gsaStatus), vaStatus:clean(input.vaStatus), sins:arr(input.sins), naics:arr(input.naics), currentRecentAwardActivity:input.currentRecentAwardActivity||null, fiveYearAwardHistory:input.fiveYearAwardHistory||null, topAgencies:arr(input.topAgencies), revenueConcentration:input.revenueConcentration||null, knownVehicleSales:input.knownVehicleSales||null,
      recompeteExpirySignals:arr(input.recompeteExpirySignals), buyerWhitespace:arr(input.buyerWhitespace), relevantCurrentOpportunities:arr(input.relevantCurrentOpportunities), teamingPrimePossibilities:arr(input.teamingPrimePossibilities), findings:findings.slice(0,12), strongestFindings:findings.slice(0,3),
      protect:arr(input.protect), expand:arr(input.expand), capture:arr(input.capture), outreachSegment:clean(input.outreachSegment), salesReadinessEstimate:clean(input.salesReadinessEstimate), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), status:'PREPARED_BEFORE_OUTREACH'
    };
    diagnostics.push(diagnostic); writeJson(this.paths.diagnostics,diagnostics);
    this.queueWarmPipelineSync(diagnostic);
    this.refreshSnapshot();
    return {ok:true,diagnostic};
  }

  queueWarmPipelineSync(diagnostic={}){
    const queue=readJson(this.paths.warmSync,[]);
    const mapped=this.warmPipeline.mapLead({
      company:diagnostic.company, website:diagnostic.website, contactName:diagnostic.contact, email:diagnostic.email,
      leadCategory:diagnostic.outreachSegment, leadTemperature:/HIGH|HOT/i.test(diagnostic.salesReadinessEstimate)?'HOT':'WARM',
      currentNeed:arr(diagnostic.strongestFindings).map(x=>x.finding).join(' | '), fitRationale:'Company-specific verified finding exists; private diagnostic prepared before outreach.',
      researchCompleted:true, researchEvidenceUrls:arr(diagnostic.findings).map(x=>x.source), outreachPrepared:true, outreachSent:false,
      federalPosition:[diagnostic.federalStatus,diagnostic.gsaStatus,diagnostic.vaStatus].filter(Boolean).join(' | '),
      recommendedP2GCOffer:'Federal Growth Diagnostic — Protect / Expand / Capture', nextAction:'Permission-first outreach; send private diagnostic only after positive reply.',
      evidenceLevel:'Sourced company-specific diagnostic', sourceConfidence:'Verified source + as-of date required'
    });
    queue.push({queuedAt:new Date().toISOString(),diagnosticId:diagnostic.id,company:diagnostic.company,row:mapped,status:'READY_FOR_WARM_PIPELINE_UPSERT'});
    writeJson(this.paths.warmSync,queue); return queue[queue.length-1];
  }

  recordDiagnosticInteraction(input={}){
    const event={id:input.id||`view_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,timestamp:new Date().toISOString(),diagnosticId:clean(input.diagnosticId),token:clean(input.token),company:clean(input.company),contact:clean(input.contact),section:clean(input.section),opportunityId:clean(input.opportunityId),cta:clean(input.cta),event:clean(input.event||'VIEW').toUpperCase(),metadata:input.metadata||{}};
    appendJsonl(this.paths.interactions,event); this.refreshSnapshot(); return event;
  }

  recordQualification(input={}){
    const decision=Policy.qualifiesForKevinCalendar(input);
    const record={timestamp:new Date().toISOString(),company:clean(input.company),contact:clean(input.contact),goal:clean(input.goal),executionPreference:clean(input.executionPreference),timing:clean(input.timing),willingnessToInvest:clean(input.willingnessToInvest),fullReviewRequested:input.fullReviewRequested===true,substantiveSalesQuestion:input.substantiveSalesQuestion===true,realOpportunity:input.realOpportunity===true,...decision};
    appendJsonl(this.paths.qualification,record); this.refreshSnapshot(); return record;
  }

  domainHealthUpdate(input={}){
    const rows=readJson(this.paths.domains,[]); const domain=lower(input.domain||Policy.domainOf(input.mailbox));
    let row=rows.find(x=>lower(x.domain)===domain&&(!input.mailbox||lower(x.mailbox)===lower(input.mailbox)));
    if(!row){ row={domain,mailbox:lower(input.mailbox)}; rows.push(row); }
    Object.assign(row,{warmupStatus:clean(input.warmupStatus||row.warmupStatus||'UNKNOWN').toUpperCase(),sendingStatus:clean(input.sendingStatus||row.sendingStatus||'PAUSED').toUpperCase(),dailyVolume:num(input.dailyVolume??row.dailyVolume),bounceRate:input.bounceRate??row.bounceRate??null,replyRate:input.replyRate??row.replyRate??null,spamComplaintSignals:input.spamComplaintSignals??row.spamComplaintSignals??null,inboxPlacementStatus:clean(input.inboxPlacementStatus||row.inboxPlacementStatus||'UNKNOWN').toUpperCase(),healthIndicator:clean(input.healthIndicator||row.healthIndicator||'WATCH').toUpperCase(),lastHealthCheck:iso(input.lastHealthCheck),recommendedMaxSendingVolume:num(input.recommendedMaxSendingVolume??row.recommendedMaxSendingVolume)});
    if(Policy.isProtectedDomain(domain)){ row.sendingStatus='DISABLED'; row.healthIndicator='PROTECTED'; row.recommendedMaxSendingVolume=0; row.coldSendingDisabled=true; }
    if(['PAUSED','UNHEALTHY','CRITICAL'].includes(row.healthIndicator)) row.sendingStatus='PAUSED';
    writeJson(this.paths.domains,rows); this.refreshSnapshot(); return row;
  }

  aggregatePeriod(history,start,end){
    const inPeriod=history.filter(x=>within(x.timestamp,start,end));
    const counts={companiesScanned:0,companiesWithMeaningfulFinding:0,outreachSent:0,replies:0,positiveReplies:0,diagnosticRequested:0,diagnosticViewed:0,fullReviewRequested:0,qualified:0,meeting:0,proposal:0,closedWon:0,revenue:0,linkedinProspectsIdentified:0,linkedinConnectionsSent:0,linkedinConnectionsAccepted:0,linkedinConversationsStarted:0,marketingPostsPublished:0,pipelineCreated:0};
    for(const r of inPeriod){
      const a=clean(r.action).toUpperCase();
      if(/COMPANY_SCAN/.test(a)) counts.companiesScanned+=Math.max(1,num(r.audienceSize));
      if(/MEANINGFUL_FINDING|QUALIFIED_FOR_OUTREACH/.test(a)) counts.companiesWithMeaningfulFinding+=Math.max(1,num(r.audienceSize));
      if(/EMAIL_SENT|FIRST_TOUCH_SENT|FOLLOW_UP_SENT|OUTREACH_SENT/.test(a)) counts.outreachSent+=Math.max(1,num(r.audienceSize));
      if(/REPLY/.test(a)) counts.replies+=1;
      if(/POSITIVE_REPLY/.test(a)) counts.positiveReplies+=1;
      if(/DIAGNOSTIC_REQUEST/.test(a)) counts.diagnosticRequested+=1;
      if(/DIAGNOSTIC_VIEW/.test(a)) counts.diagnosticViewed+=1;
      if(/FULL_REVIEW_REQUEST/.test(a)) counts.fullReviewRequested+=1;
      if(/QUALIFIED_HIGH_INTENT/.test(a)) counts.qualified+=1;
      if(/MEETING_BOOKED/.test(a)) counts.meeting+=1;
      if(/PROPOSAL/.test(a)) counts.proposal+=1;
      if(/CLOSED_WON/.test(a)){ counts.closedWon+=1; counts.revenue+=num(r.result?.revenue); }
      if(/LINKEDIN_PROSPECT_IDENTIFIED/.test(a)) counts.linkedinProspectsIdentified+=Math.max(1,num(r.audienceSize));
      if(/LINKEDIN_CONNECTION_SENT/.test(a)) counts.linkedinConnectionsSent+=Math.max(1,num(r.audienceSize));
      if(/LINKEDIN_CONNECTION_ACCEPTED/.test(a)) counts.linkedinConnectionsAccepted+=1;
      if(/LINKEDIN_CONVERSATION/.test(a)) counts.linkedinConversationsStarted+=1;
      if(/LINKEDIN_POST_PUBLISHED/.test(a)) counts.marketingPostsPublished+=1;
      if(/PIPELINE_CREATED/.test(a)) counts.pipelineCreated+=num(r.result?.pipelineValue||0);
    }
    return counts;
  }

  funnelFrom(history){
    const stageCounts={}; for(const s of FUNNEL_STAGES) stageCounts[s]=0;
    const now=new Date(), start=new Date(now.getTime()-365*86400000);
    const p=this.aggregatePeriod(history,start,now);
    Object.assign(stageCounts,p);
    const sequence=['companiesScanned','companiesWithMeaningfulFinding','outreachSent','replies','positiveReplies','diagnosticRequested','diagnosticViewed','fullReviewRequested','qualified','meeting','proposal','closedWon'];
    const conversions=[];
    for(let i=1;i<sequence.length;i++){ const from=stageCounts[sequence[i-1]]||0,to=stageCounts[sequence[i]]||0; conversions.push({from:sequence[i-1],to:sequence[i],ratePct:from?Number((to/from*100).toFixed(1)):0}); }
    return {stages:stageCounts,conversions};
  }

  refreshSnapshot(){
    const now=new Date(); const history=readJsonl(this.paths.history); const calendar=readJson(this.paths.calendar,[]); const campaigns=readJson(this.paths.campaigns,[]); const messages=readJson(this.paths.messages,[]); const domains=readJson(this.paths.domains,[]); const diagnostics=readJson(this.paths.diagnostics,[]); const interactions=readJsonl(this.paths.interactions); const qualification=readJsonl(this.paths.qualification);
    const todayStart=new Date(now); todayStart.setHours(0,0,0,0); const todayEnd=new Date(now); todayEnd.setHours(23,59,59,999);
    const todayCalendar=calendar.filter(x=>dayKey(x.scheduledAt)===dayKey(now)).sort((a,b)=>String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
    const future=calendar.filter(x=>Date.parse(x.scheduledAt)>=now.getTime()&&['PLANNED','READY','SCHEDULED'].includes(clean(x.status).toUpperCase())).sort((a,b)=>String(a.scheduledAt).localeCompare(String(b.scheduledAt))).slice(0,100);
    const snapshot={
      generatedAt:now.toISOString(), status:'ACTIVE', operatingSystem:'P2GC_MARKETING_SALES_OS_V1', senderIdentity:'Kevin', protectedPrimaryDomain:{domain:'p2gc.com',coldSending:'DISABLED',failover:'DISABLED'},
      whatIsGoingOut:{today:todayCalendar,totalMarketingTouchesToday:todayCalendar.reduce((n,x)=>n+Math.max(1,num(x.audienceSize)),0),next:future.slice(0,20)},
      calendar:{today:todayCalendar,week:calendar.filter(x=>within(x.scheduledAt,startOfWeek(now),new Date(startOfWeek(now).getTime()+7*86400000))),month:calendar.filter(x=>within(x.scheduledAt,startOfMonth(now),new Date(now.getFullYear(),now.getMonth()+1,1)))},
      emailActivity:{campaigns,today:history.filter(x=>dayKey(x.timestamp)===dayKey(now)&&x.channel==='EMAIL'),exactMessageHistory:history.filter(x=>x.channel==='EMAIL').slice(-200).reverse()},
      linkedinActivity:{searches:history.filter(x=>x.channel==='LINKEDIN'&&/SEARCH/.test(x.action)).slice(-100).reverse(),connections:history.filter(x=>x.channel==='LINKEDIN'&&/CONNECTION/.test(x.action)).slice(-100).reverse(),messages:history.filter(x=>x.channel==='LINKEDIN'&&/MESSAGE/.test(x.action)).slice(-100).reverse(),posts:history.filter(x=>x.channel==='LINKEDIN'&&/POST/.test(x.action)).slice(-100).reverse()},
      outboundDomainHealth:domains,
      auditHistory:history.slice(-500).reverse(),
      messageLibrary:messages,
      diagnostics:{prepared:diagnostics.length,items:diagnostics.slice(-100).reverse(),interactions:interactions.slice(-300).reverse()},
      qualification:{latest:qualification.slice(-100).reverse(),highIntent:qualification.filter(x=>x.highIntent).length,researchOnly:qualification.filter(x=>x.researchOnly).length},
      scorecard:{today:this.aggregatePeriod(history,todayStart,todayEnd),weekToDate:this.aggregatePeriod(history,startOfWeek(now),now),monthToDate:this.aggregatePeriod(history,startOfMonth(now),now)},
      funnel:this.funnelFrom(history),
      segments:SEGMENTS,
      warmPipelineSyncQueue:readJson(this.paths.warmSync,[]).slice(-100).reverse(),
      governance:{qualityOrder:['RELEVANCE','ACCURACY','DELIVERABILITY','BUYING_INTENT','CONVERSION','REVENUE'],rawSendVolumePrimary:false,globalSuppressionRequired:true,largeNewCampaignNeedsKevinWhenRiskChanges:true,paidResourcesNeedKevin:true}
    };
    writeJson(this.paths.snapshot,snapshot); writeJson(this.paths.publicSnapshot,snapshot); return snapshot;
  }
}

module.exports=P2GCMarketingActivityService;
