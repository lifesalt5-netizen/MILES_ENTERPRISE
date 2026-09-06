'use strict';

const fs=require('fs');
const path=require('path');
const Policy=require('./P2GCMarketingSalesOperatingPolicy');
const P2GCMarketingActivityService=require('./P2GCMarketingActivityService');
const GlobalSuppressionService=require('./GlobalSuppressionService');

function clean(v){return String(v??'').trim();}
function lower(v){return clean(v).toLowerCase();}
function arr(v){return Array.isArray(v)?v:[];}
function ensureDir(d){fs.mkdirSync(d,{recursive:true});}
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function writeJson(file,value){ensureDir(path.dirname(file));fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n','utf8');}
function time(v){const n=Date.parse(clean(v));return Number.isFinite(n)?n:0;}

const REQUIRED_FINDING_LABELS=new Set(['CONFIRMED FACT','CALCULATED INDICATOR','P2GC OBSERVATION / RECOMMENDATION']);
const ACTIVE_REPLY_STATUSES=new Set(['DIAGNOSTIC_PREPARED_BEFORE_OUTREACH','OUTREACH_READY','OUTREACH_SENT','REPLY_RECEIVED','DIAGNOSTIC_REQUESTED','PRIVATE_DIAGNOSTIC_LINK_RELEASED']);

class P2GCCompanySpecificOutboundPipelineService{
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,'..','..'));
    this.activity=options.activityService||new P2GCMarketingActivityService({rootDir:this.rootDir});
    this.suppression=options.suppressionService||new GlobalSuppressionService({rootDir:this.rootDir});
    this.stateFile=path.join(this.rootDir,'DATA','marketing_activity','company_specific_pipeline.json');
    if(!fs.existsSync(this.stateFile))writeJson(this.stateFile,[]);
  }

  validateFinding(f={}){
    const label=clean(f.label||f.type).toUpperCase();
    const errors=[];
    if(!REQUIRED_FINDING_LABELS.has(label))errors.push('FINDING_LABEL_REQUIRED');
    if(!clean(f.finding))errors.push('FINDING_TEXT_REQUIRED');
    if(!clean(f.source))errors.push('FINDING_SOURCE_REQUIRED');
    if(!clean(f.asOfDate))errors.push('FINDING_AS_OF_DATE_REQUIRED');
    if(!clean(f.metricDefinition))errors.push('FINDING_METRIC_DEFINITION_REQUIRED');
    return {ok:errors.length===0,errors,label};
  }

  qualifyCompany(input={}){
    const email=lower(input.email);
    if(!clean(input.company))return {ok:false,code:'COMPANY_REQUIRED'};
    if(email&&this.suppression.isSuppressed(email))return {ok:false,code:'GLOBAL_SUPPRESSION_BLOCK',suppression:this.suppression.get(email)};
    const findings=arr(input.findings);
    if(findings.length===0)return {ok:false,code:'NO_MEANINGFUL_COMPANY_SPECIFIC_FINDING_DO_NOT_CONTACT'};
    const checked=findings.map(f=>({finding:f,validation:this.validateFinding(f)}));
    const valid=checked.filter(x=>x.validation.ok).map(x=>({...x.finding,label:x.validation.label}));
    if(valid.length===0)return {ok:false,code:'NO_SUPPORTABLE_SOURCED_FINDING_DO_NOT_CONTACT',findingValidation:checked};
    return {ok:true,company:clean(input.company),email,validFindings:valid,strongestFindings:valid.slice(0,3)};
  }

  prepareBeforeOutreach(input={}){
    const q=this.qualifyCompany(input);
    if(!q.ok)return q;
    const diagnosticResult=this.activity.registerDiagnostic({...input,findings:q.validFindings,strongestFindings:q.strongestFindings});
    if(!diagnosticResult.ok)return diagnosticResult;
    const record={
      id:`pipe_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
      company:clean(input.company),website:clean(input.website),contact:clean(input.contact),contactRole:clean(input.contactRole),email:q.email,
      segment:clean(input.outreachSegment),diagnosticId:diagnosticResult.diagnostic.id,diagnosticToken:diagnosticResult.diagnostic.token,privatePath:diagnosticResult.diagnostic.privatePath,
      strongestFindings:q.strongestFindings,status:'DIAGNOSTIC_PREPARED_BEFORE_OUTREACH',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
      positiveReply:false,privateLinkReleasedAt:null,privateLinkReleasedFrom:null,
      coldSequence:{step:0,replyReceived:false,stopped:false}
    };
    const rows=readJson(this.stateFile,[]);rows.push(record);writeJson(this.stateFile,rows);
    this.activity.recordActivity({channel:'SYSTEM',campaign:record.segment,segment:record.segment,action:'QUALIFIED_FOR_OUTREACH_MEANINGFUL_FINDING',recipient:record.email,audienceSize:1,status:'READY',message:q.strongestFindings.map(x=>x.finding).join(' | '),result:{diagnosticId:record.diagnosticId}});
    return {ok:true,record,diagnostic:diagnosticResult.diagnostic};
  }

  findActiveByEmail(email){
    const key=lower(email);if(!key)return null;
    return arr(readJson(this.stateFile,[]))
      .filter(row=>lower(row.email)===key&&ACTIVE_REPLY_STATUSES.has(clean(row.status).toUpperCase()))
      .sort((a,b)=>time(b.updatedAt||b.createdAt)-time(a.updatedAt||a.createdAt))[0]||null;
  }

  firstEmail(record={},options={}){
    const senderCheck=Policy.assertColdSenderSafe(options.sendingMailbox,{mailboxHealthy:options.mailboxHealthy===true,healthVerifiedAt:options.healthVerifiedAt});
    if(!senderCheck.ok)return senderCheck;
    const first=arr(record.strongestFindings)[0];
    if(!first)return {ok:false,code:'NO_FINDING_FOR_FIRST_EMAIL'};
    const second=arr(record.strongestFindings)[1];
    const contactFirst=clean(record.contact).split(/\s+/)[0]||'there';
    const body=[
      `Hi ${contactFirst},`,'',
      `P2GC reviewed ${record.company}'s current federal footprint, and one thing stood out: ${clean(first.finding)}`,
      second?clean(second.finding):'','',
      'We prepared a brief company-specific Federal Growth Snapshot using current public federal contracting data.','',
      'Would you like me to send you the private link?','',
      'Kevin','Pathways 2 Government Contracting'
    ].filter((line,i,a)=>!(line===''&&a[i-1]==='')).join('\n');
    const policy=Policy.validateFirstTouch({body});
    if(!policy.ok)return {ok:false,code:'FIRST_TOUCH_POLICY_BLOCK',errors:policy.errors};
    return {ok:true,fromName:'Kevin',fromMailbox:senderCheck.senderEmail,subject:clean(options.subject||`${record.company} — federal growth snapshot`),body,diagnosticLinkIncluded:false,calendlyIncluded:false,asksForMeeting:false};
  }

  followUp(record={},day=3){
    const first=clean(record.contact).split(/\s+/)[0]||'there';
    if(Number(day)===3)return {ok:true,day:3,body:`${first} — worth sending over?`};
    if(Number(day)===7)return {ok:true,day:7,body:`I'll close this out if it's not something you're looking at right now. If you'd like the ${record.company} Federal Growth Snapshot, I'm happy to send it.`};
    return {ok:false,code:'NO_APPROVED_FOLLOW_UP_FOR_DAY'};
  }

  markReply({pipelineId,replyText,email,sourceId,positiveOverride,hardSuppressionOverride=false,category=''}={}){
    const rows=readJson(this.stateFile,[]);const row=rows.find(x=>x.id===pipelineId);
    if(!row)return {ok:false,code:'PIPELINE_RECORD_NOT_FOUND'};
    row.coldSequence=row.coldSequence||{};row.coldSequence.replyReceived=true;row.coldSequence.stopped=true;row.coldSequence.stopReason='REPLY_RECEIVED';row.replyText=clean(replyText);row.replyCategory=clean(category).toUpperCase()||null;row.updatedAt=new Date().toISOString();
    const explicitDnc=/\b(stop|unsubscribe|remove me|do not contact|don't contact)\b/i.test(replyText||'');
    if(hardSuppressionOverride===true||explicitDnc){
      row.positiveReply=false;
      const reason=clean(category).toUpperCase()||'PROSPECT_DO_NOT_CONTACT';
      const result=this.suppression.upsert({email:email||row.email,reason,category:reason,source:'P2GC_REPLY_INTELLIGENCE',sourceId,evidence:clean(replyText),hard:true});
      row.status='GLOBAL_SUPPRESSION_ADDED';writeJson(this.stateFile,rows);
      this.activity.recordActivity({channel:'EMAIL',campaign:row.segment,segment:row.segment,action:'REPLY_SUPPRESSED',recipient:row.email,status:'SUPPRESSED',reply:clean(replyText),result:{...result,category:reason,pipelineId:row.id,diagnosticId:row.diagnosticId}});
      return {ok:true,suppressed:true,positive:false,row,result};
    }
    const positive=positiveOverride===true?true:positiveOverride===false?false:Policy.positiveReplyIntent(replyText);
    row.positiveReply=positive;
    row.status=positive?'DIAGNOSTIC_REQUESTED':'REPLY_RECEIVED';writeJson(this.stateFile,rows);
    this.activity.recordActivity({channel:'EMAIL',campaign:row.segment,segment:row.segment,action:positive?'POSITIVE_REPLY_DIAGNOSTIC_REQUEST':'REPLY_RECEIVED',recipient:row.email,status:'REPLIED',reply:clean(replyText),result:{diagnosticId:row.diagnosticId,pipelineId:row.id,positiveReply:positive,category:row.replyCategory}});
    return {ok:true,positive,row};
  }

  markClassifiedReply({email,replyText,sourceId,category,qualifiedPositive=false,hardSuppression=false}={}){
    const row=this.findActiveByEmail(email);
    if(!row)return {ok:true,matched:false,status:'NO_ACTIVE_COMPANY_SPECIFIC_PIPELINE'};
    const categoryKey=clean(category).toUpperCase();
    const positiveEligible=qualifiedPositive===true&&!['REFERRAL'].includes(categoryKey);
    const result=this.markReply({pipelineId:row.id,replyText,email,sourceId,category:categoryKey,positiveOverride:positiveEligible?true:undefined,hardSuppressionOverride:hardSuppression===true});
    return {...result,matched:true,pipelineId:row.id,diagnosticId:row.diagnosticId,company:row.company,segment:row.segment};
  }

  positiveReplyLinkMessage({pipelineId,sendingMailbox}={}){
    const rows=readJson(this.stateFile,[]);const row=rows.find(x=>x.id===pipelineId);
    if(!row)return {ok:false,code:'PIPELINE_RECORD_NOT_FOUND'};
    if(row.positiveReply!==true || !['DIAGNOSTIC_REQUESTED','PRIVATE_DIAGNOSTIC_LINK_RELEASED'].includes(row.status))return {ok:false,code:'POSITIVE_REPLY_REQUIRED_BEFORE_PRIVATE_LINK'};
    if(Policy.isProtectedDomain(sendingMailbox))return {ok:false,code:'P2GC_PRIMARY_DOMAIN_HANDOFF_TOO_EARLY'};
    if(!Policy.isApprovedSecondaryDomain(sendingMailbox))return {ok:false,code:'P2GC_PRIVATE_LINK_MUST_STAY_ON_APPROVED_SECONDARY_THREAD'};
    const urlBase=clean(process.env.P2GC_PRIVATE_REVIEW_BASE_URL||'');
    const link=urlBase?`${urlBase.replace(/\/$/,'')}${row.privatePath}`:row.privatePath;
    const body=`Absolutely.\n\nHere is the private Federal Growth Snapshot we prepared for ${row.company}:\n\n${link}\n\nIt uses ${row.company}'s actual public federal contracting data and shows the main areas that stood out along with the underlying sources.\n\nI've left enough visible for you to determine whether the findings are relevant. If they are, you can request the complete review and decide whether you want the intelligence for your internal team or want P2GC involved in executing it.\n\nKevin`;
    row.privateLinkReleasedAt=row.privateLinkReleasedAt||new Date().toISOString();
    row.privateLinkReleasedFrom=lower(sendingMailbox);
    row.status='PRIVATE_DIAGNOSTIC_LINK_RELEASED';row.updatedAt=new Date().toISOString();writeJson(this.stateFile,rows);
    this.activity.recordActivity({channel:'EMAIL',campaign:row.segment,segment:row.segment,action:'PRIVATE_DIAGNOSTIC_LINK_RELEASED_AFTER_POSITIVE_REPLY',recipient:row.email,senderMailbox:lower(sendingMailbox),status:'READY_TO_SEND_IN_SAME_THREAD',message:body,result:{pipelineId:row.id,diagnosticId:row.diagnosticId,privatePath:row.privatePath}});
    return {ok:true,fromName:'Kevin',fromMailbox:lower(sendingMailbox),sameThreadRequired:true,body,privateLink:link,privateLinkReleasedAt:row.privateLinkReleasedAt,pipelineId:row.id,diagnosticId:row.diagnosticId};
  }

  qualification(input={}){
    const result=this.activity.recordQualification(input);
    this.activity.recordActivity({channel:'SYSTEM',campaign:'QUALIFICATION',segment:clean(input.segment),action:result.highIntent?'QUALIFIED_HIGH_INTENT':'QUALIFICATION_NURTURE',recipient:clean(input.contact),status:result.highIntent?'QUALIFIED':'NURTURE',message:[input.goal,input.executionPreference,input.timing,input.willingnessToInvest].filter(Boolean).join(' | '),result});
    return result;
  }

  kevinPreCallBrief({pipelineId,qualification={}}={}){
    const rows=readJson(this.stateFile,[]);const row=rows.find(x=>x.id===pipelineId);if(!row)return {ok:false,code:'PIPELINE_RECORD_NOT_FOUND'};
    const decision=Policy.qualifiesForKevinCalendar(qualification);
    if(!decision.highIntent)return {ok:false,code:'KEVIN_CALENDAR_NOT_HIGH_INTENT',decision};
    const snapshot=this.activity.refreshSnapshot();
    const interactions=arr(snapshot.diagnostics?.interactions).filter(x=>x.diagnosticId===row.diagnosticId);
    return {ok:true,brief:{company:row.company,contact:row.contact,email:row.email,outreachTrigger:arr(row.strongestFindings).map(x=>x.finding),sourceData:arr(row.strongestFindings).map(x=>({source:x.source,asOfDate:x.asOfDate,metricDefinition:x.metricDefinition,label:x.label})),whatEmailTheyReceived:'Permission-first company-specific finding email; private link only after reply.',whatTheyReplied:row.replyText||'',diagnosticSectionsViewed:interactions.map(x=>x.section).filter(Boolean),viewCount:interactions.length,opportunitiesOpened:interactions.map(x=>x.opportunityId).filter(Boolean),ctaSelections:interactions.map(x=>x.cta).filter(Boolean),primaryGoal:qualification.goal,executionPreference:qualification.executionPreference,timing:qualification.timing,willingnessToInvest:qualification.willingnessToInvest,likelyServiceLevel:clean(qualification.executionPreference),recommendedClose:'Decide whether internal execution, P2GC collaboration, or P2GC-led execution makes the most sense.',suggestedOpening:"You've already seen the preliminary findings. I want to use our time today to show you what we found beyond the preview, what I believe deserves action first, and then decide whether this makes sense for your team to execute internally or for P2GC to help with."}};
  }
}

module.exports=P2GCCompanySpecificOutboundPipelineService;
module.exports.ACTIVE_REPLY_STATUSES=ACTIVE_REPLY_STATUSES;
