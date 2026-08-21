"use strict";

const fs = require("fs");
const path = require("path");
const ReplyIntelligenceService = require("./ReplyIntelligenceService");
const GlobalSuppressionService = require("./GlobalSuppressionService");
const ExecutiveReplySurfacePolicyService = require("./ExecutiveReplySurfacePolicyService");
const ReplacementContactRecoveryService = require("./ReplacementContactRecoveryService");
const { evaluateQualifiedReplyForAutonomy } = require("./AutonomousQualifiedReplyPolicy");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 60;
const DEFAULT_MAX_PAGES = 5;
const MAX_PROCESSED_IDS = 10000;
const DEFAULT_CALENDLY_URL = "https://calendly.com/kevin-pathways2gc/30min";

function positiveInt(value, fallback) { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback; }
function readJson(filePath, fallback) { try { if (!fs.existsSync(filePath)) return fallback; return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; } }
function writeJsonAtomic(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive:true }); const temp=`${filePath}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(temp, JSON.stringify(value,null,2), "utf8"); fs.renameSync(temp,filePath); }
function appendJsonl(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive:true }); fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8"); }
function queueUpsert(filePath, entry, keyFn) { const existing=readJson(filePath,[]); const rows=Array.isArray(existing)?existing:[]; const key=keyFn(entry); const index=rows.findIndex(row=>keyFn(row)===key); if(index>=0) rows[index]={...rows[index],...entry}; else rows.push(entry); writeJsonAtomic(filePath,rows); return rows.length; }
function queueRemove(filePath, predicate) { const existing=readJson(filePath,[]); const rows=Array.isArray(existing)?existing:[]; const filtered=rows.filter(row=>!predicate(row)); if(filtered.length!==rows.length) writeJsonAtomic(filePath,filtered); return rows.length-filtered.length; }
function timestampMs(value) { const n=Date.parse(String(value||"")); return Number.isFinite(n)?n:0; }
function conversationKey(value={}) {
  const thread=String(value.threadId || value.thread_id || "").trim();
  if(thread) return `THREAD:${thread}`;
  const from=String(value.from || value.from_address_email || "").trim().toLowerCase();
  const campaign=String(value.campaignId || value.campaign_id || "").trim();
  return `FROM:${from}|CAMPAIGN:${campaign}`;
}
function latest(items) { return [...items].sort((a,b)=>timestampMs(b?.classification?.timestamp)-timestampMs(a?.classification?.timestamp))[0]; }
function selectConversationRepresentatives(classified=[]) {
  const groups=new Map();
  for(const row of classified){ const key=conversationKey(row.classification); if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(row); }
  const selected=[];
  for(const [key,rows] of groups){
    const hard=rows.filter(row=>row.classification?.hardSuppression);
    const human=rows.filter(row=>row.classification?.humanReply);
    const chosen=hard.length?latest(hard):human.length?latest(human):latest(rows);
    selected.push({...chosen,conversationKey:key,threadMessageCount:rows.length});
  }
  return selected.sort((a,b)=>timestampMs(a.classification?.timestamp)-timestampMs(b.classification?.timestamp));
}
function replyTargetUuid(item={}) { return String(item.reply_to_uuid || item.replyToUuid || item.email_uuid || item.uuid || item.id || "").trim(); }
function senderAccount(item={}) { return String(item.eaccount || item.sender_account || item.senderAccount || item.account || item.account_email || "").trim(); }
function replySubject(subject="") { const clean=String(subject||"").trim(); return /^re:/i.test(clean) ? clean : `Re: ${clean || "Government contracting"}`; }
function draftQualifiedReply(category, calendlyUrl=DEFAULT_CALENDLY_URL) {
  const link=String(calendlyUrl||DEFAULT_CALENDLY_URL).trim();
  const drafts={
    MEETING_INTENT:`Absolutely — happy to connect. You can choose a time that works for you here: ${link}\n\nKevin\nPathways 2 Government Contracting`,
    INTERESTED:`Thanks for the response. I’d be glad to learn where you’re trying to get traction in government contracting and see whether P2GC can help. You can choose a time here: ${link}\n\nKevin\nPathways 2 Government Contracting`,
    PRICING_QUESTION:`Thanks for reaching out. Pricing depends on where you are in the government contracting process and the support you need, so I don’t want to quote the wrong scope by email. The fastest way to identify the right fit is a short call: ${link}\n\nKevin\nPathways 2 Government Contracting`,
    REFERRAL:`Thank you for pointing me in the right direction — I appreciate it. I’ll follow up using the referral information you provided.\n\nKevin\nPathways 2 Government Contracting`
  };
  return drafts[String(category||"").toUpperCase()] || "";
}

class ReplyIntelligenceProductionLoopService {
  constructor(options={}) {
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,"..",".."));
    this.intervalMs=positiveInt(options.intervalMs||process.env.P2GC_REPLY_INTELLIGENCE_INTERVAL_MS,DEFAULT_INTERVAL_MS);
    this.lookbackDays=positiveInt(options.lookbackDays||process.env.P2GC_REPLY_LOOKBACK_DAYS,DEFAULT_LOOKBACK_DAYS);
    this.maxPages=positiveInt(options.maxPages||process.env.P2GC_REPLY_MAX_PAGES,DEFAULT_MAX_PAGES);
    this.emailSource=options.emailSource||null;
    this.classifier=options.classifier||new ReplyIntelligenceService();
    this.suppression=options.suppression||new GlobalSuppressionService({rootDir:this.rootDir});
    this.surfacePolicy=options.surfacePolicy||new ExecutiveReplySurfacePolicyService({rootDir:this.rootDir});
    this.replacementRecovery=options.replacementRecovery||new ReplacementContactRecoveryService();
    this.calendlyUrl=options.calendlyUrl||process.env.P2GC_CALENDLY_URL||DEFAULT_CALENDLY_URL;
    this.timer=null; this.running=false; this.passRunning=false;
    this.outputDir=options.outputDir||path.join(this.rootDir,"DATA","runtime","revenue","replies");
    this.statePath=path.join(this.outputDir,"reply_intelligence_state.json");
    this.latestPath=path.join(this.outputDir,"reply_intelligence_latest.json");
    this.kpiPath=path.join(this.outputDir,"reply_kpis_latest.json");
    this.activityPath=path.join(this.outputDir,"reply_activity_log.jsonl");
    this.qualifiedQueuePath=path.join(this.outputDir,"qualified_reply_queue.json");
    this.followupQueuePath=path.join(this.outputDir,"followup_queue.json");
    this.reviewQueuePath=path.join(this.outputDir,"manual_review_queue.json");
    this.replacementQueuePath=path.join(this.outputDir,"replacement_contact_queue.json");
    this.log=options.log||(message=>console.log(`[REPLY-INTEL] ${message}`));
  }

  getEmailSource(){ if(this.emailSource) return this.emailSource; const instantly=require(path.join(this.rootDir,"CONNECTORS","INSTANTLY","instantly.js")); return {async listEmails(params){return instantly.request("/emails",{method:"GET",params});}}; }
  initialState(){ return {version:5,processedIds:[],lastSuccessfulPollAt:null,cumulative:{rawReceived:0,humanReplies:0,meaningfulHumanReplies:0,qualifiedPositiveReplies:0,counts:{}},generatedAt:new Date().toISOString()}; }
  loadState(){ const state=readJson(this.statePath,this.initialState()); return {...this.initialState(),...state,processedIds:Array.isArray(state?.processedIds)?state.processedIds:[],cumulative:{...this.initialState().cumulative,...(state?.cumulative||{}),counts:{...(state?.cumulative?.counts||{})}}}; }
  saveState(state){ state.processedIds=[...new Set(state.processedIds||[])].slice(-MAX_PROCESSED_IDS); state.generatedAt=new Date().toISOString(); writeJsonAtomic(this.statePath,state); }

  async fetchReceivedEmails(state){
    const source=this.getEmailSource(); const firstMin=state.lastSuccessfulPollAt||new Date(Date.now()-this.lookbackDays*86400000).toISOString(); const items=[]; let startingAfter=null,pages=0;
    while(pages<this.maxPages){ const params={limit:100,email_type:"received",min_timestamp_created:firstMin}; if(startingAfter) params.starting_after=startingAfter; const response=await source.listEmails(params); const pageItems=Array.isArray(response?.items)?response.items:Array.isArray(response)?response:[]; items.push(...pageItems); pages+=1; startingAfter=response?.next_starting_after||null; if(!startingAfter||pageItems.length===0) break; }
    return {items,pages,minTimestamp:firstMin,truncated:Boolean(startingAfter)};
  }

  queueKey(row){ return row?.conversationKey || conversationKey(row); }
  sameConversation(row, classification){ return this.queueKey(row)===conversationKey(classification); }
  clearConversationQueues(classification){ const pred=row=>this.sameConversation(row,classification); queueRemove(this.qualifiedQueuePath,pred); queueRemove(this.followupQueuePath,pred); queueRemove(this.reviewQueuePath,pred); }

  recoverReplacementContact(item, classification, base){
    const replacement=this.replacementRecovery.detect(item);
    if(!replacement) return null;
    const departed=String(replacement.departedContactEmail||classification.from||"").toLowerCase();
    if(departed){
      this.suppression.upsert({email:departed,reason:"CONTACT_DEPARTED",category:"CONTACT_DEPARTED",source:"INSTANTLY_UNIBOX",sourceId:classification.emailId,campaignId:classification.campaignId,evidence:replacement.evidence,hard:true});
      const byEmail=row=>String(row?.from||row?.departedContactEmail||"").toLowerCase()===departed;
      queueRemove(this.qualifiedQueuePath,byEmail); queueRemove(this.followupQueuePath,byEmail); queueRemove(this.reviewQueuePath,byEmail);
    }
    const recovery={...replacement,conversationKey:base.conversationKey,threadId:classification.threadId,sourceEmailId:classification.emailId,campaignId:classification.campaignId,leadId:classification.leadId,source:"INSTANTLY_UNIBOX",status:"VERIFICATION_REQUIRED",owner:"MILES",nextAction:"VERIFY_SUPPRESSION_DEDUPE_AND_CREATE_REPLACEMENT_LEAD",requiredGates:["VERIFY_EMAIL","SUPPRESSION_CHECK","DUPLICATE_CHECK","PRESERVE_CAMPAIGN_CONTEXT","CREATE_REPLACEMENT_LEAD","RETIRE_OLD_CONTACT"],createdAt:new Date().toISOString()};
    queueUpsert(this.replacementQueuePath,recovery,row=>String(row?.replacementEmail||"").toLowerCase()+"|"+String(row?.campaignId||""));
    return recovery;
  }

  buildQualifiedReplyOperation(item, classification, base){
    const email=String(classification.from||"").trim().toLowerCase();
    const suppression= email && typeof this.suppression.get === "function" ? this.suppression.get(email) : null;
    const reply_to_uuid=replyTargetUuid(item);
    const eaccount=senderAccount(item);
    const autonomy=evaluateQualifiedReplyForAutonomy({...classification,reply_to_uuid,eaccount,suppressed:Boolean(suppression)});
    const bodyText=draftQualifiedReply(classification.category,this.calendlyUrl);
    const executable=autonomy.eligible && Boolean(bodyText);
    return {
      ...base,
      id:`QUALIFIED_REPLY_${reply_to_uuid || classification.emailId || Buffer.from(base.conversationKey).toString("base64url").slice(0,48)}`,
      title:`Respond to qualified ${classification.category} reply from ${email || "prospect"}`,
      objective:"Respond promptly to a qualified human reply and move the prospect toward a meeting without bypassing MILES write governance.",
      reason:`Reply Intelligence classified this as ${classification.category} with confidence ${classification.confidence}.`,
      provider:"INSTANTLY",connector:"INSTANTLY",system:"INSTANTLY",department:"Revenue Operations",
      action:executable?"replyToEmail":"REVIEW_QUALIFIED_REPLY",
      type:executable?"replyToEmail":"REVIEW_QUALIFIED_REPLY",
      capability:executable?"INSTANTLY_SEND_REPLY":"REVIEW_QUALIFIED_REPLY",
      reply_to_uuid,eaccount,subject:replySubject(classification.subject),body:{text:bodyText},
      contactEmail:email,campaignId:classification.campaignId,leadId:classification.leadId,
      status:executable?"READY":"REVIEW_REQUIRED",
      owner:executable?"MILES":"KEVIN",requiresKevin:false,requiresCEO:false,
      autonomy,
      requiredGates:["QUALIFIED_POSITIVE_CATEGORY","CONFIDENCE_0_90_PLUS","REPLY_IDENTITY","SENDER_ACCOUNT","GLOBAL_SUPPRESSION_CHECK","INSTANTLY_WRITE_GOVERNANCE"],
      nextAction:executable?"QUEUE_GOVERNED_INSTANTLY_REPLY":"REVIEW_MISSING_AUTONOMY_EVIDENCE"
    };
  }

  processClassification(item,classification,meta={}){
    const key=meta.conversationKey||conversationKey(classification);
    const base={...classification,conversationKey:key,threadMessageCount:Number(meta.threadMessageCount||1),source:"INSTANTLY_UNIBOX",processedAt:new Date().toISOString()};
    appendJsonl(this.activityPath,base);
    const email=classification.from;
    const queueKey=row=>this.queueKey(row);
    this.clearConversationQueues(base);
    const replacement=this.recoverReplacementContact(item,classification,base);
    if(replacement){ base.replacementContact=replacement; base.action="REPLACE_CONTACT_AND_CONTINUE"; base.priority="HIGH"; }
    else if(classification.qualifiedPositive) {
      const operation=this.buildQualifiedReplyOperation(item,classification,base);
      queueUpsert(this.qualifiedQueuePath,operation,queueKey);
      base.governedReplyOperation={id:operation.id,status:operation.status,action:operation.action,owner:operation.owner,autonomy:operation.autonomy};
    }
    else if(classification.category==="OOO"||classification.category==="NOT_NOW") queueUpsert(this.followupQueuePath,{...base,status:"SCHEDULED"},queueKey);
    else if(classification.category==="NEUTRAL_QUESTION"||classification.category==="UNKNOWN") queueUpsert(this.reviewQueuePath,{...base,status:"OPEN",owner:"MILES"},queueKey);
    if(classification.hardSuppression&&email){
      this.suppression.upsert({email,reason:classification.category,category:classification.category,source:"INSTANTLY_UNIBOX",sourceId:classification.emailId,campaignId:classification.campaignId,evidence:`${classification.subject} ${classification.preview}`,hard:true});
      const byEmail=row=>String(row?.from||row?.contactEmail||"").toLowerCase()===email;
      queueRemove(this.qualifiedQueuePath,byEmail); queueRemove(this.followupQueuePath,byEmail); queueRemove(this.reviewQueuePath,byEmail);
    }
    return this.surfacePolicy.apply(base);
  }

  updateCumulative(state,summary){ const c=state.cumulative; c.rawReceived+=Number(summary.rawReceived||0); c.humanReplies+=Number(summary.humanReplies||0); c.meaningfulHumanReplies+=Number(summary.meaningfulHumanReplies||0); c.qualifiedPositiveReplies+=Number(summary.qualifiedPositiveReplies||0); for(const [category,count] of Object.entries(summary.counts||{})) c.counts[category]=Number(c.counts[category]||0)+Number(count||0); c.humanReplyRatePct=c.rawReceived?Number(((c.humanReplies/c.rawReceived)*100).toFixed(2)):0; c.qualifiedPositiveRatePct=c.humanReplies?Number(((c.qualifiedPositiveReplies/c.humanReplies)*100).toFixed(2)):0; }

  async runOnce(){
    if(this.passRunning) return {ok:true,status:"REPLY_INTELLIGENCE_PASS_ALREADY_RUNNING",skipped:true};
    this.passRunning=true; const state=this.loadState();
    try{
      const fetched=await this.fetchReceivedEmails(state); const processed=new Set(state.processedIds); const fresh=fetched.items.filter(item=>{const id=String(item?.id||item?.message_id||"");return id&&!processed.has(id);});
      const classified=fresh.map(item=>({item,classification:this.classifier.classify(item)}));
      const representatives=selectConversationRepresentatives(classified);
      const routed=representatives.map(row=>this.processClassification(row.item,row.classification,{conversationKey:row.conversationKey,threadMessageCount:row.threadMessageCount}));
      const summary=this.classifier.summarize(routed);
      summary.rawReceivedMessages=fresh.length; summary.uniqueConversations=representatives.length; summary.duplicateThreadMessages=Math.max(0,fresh.length-representatives.length);
      this.updateCumulative(state,summary);
      for(const item of fresh){const id=String(item?.id||item?.message_id||""); if(id) state.processedIds.push(id);} state.lastSuccessfulPollAt=new Date().toISOString(); this.saveState(state);
      const executiveAlerts=routed.filter(item=>item.surfaceToExecutiveInbox===true);
      const suppressedFromExecutive=routed.filter(item=>item.surfaceToExecutiveInbox!==true);
      const replacements=routed.filter(item=>item.replacementContact?.detected===true);
      const governedReady=routed.filter(item=>item.governedReplyOperation?.status==="READY").length;
      const report={ok:true,service:"REPLY_INTELLIGENCE_PRODUCTION_LOOP",status:governedReady>0?"QUALIFIED_REPLIES_READY_FOR_GOVERNED_EXECUTION":executiveAlerts.length>0?"QUALIFIED_REPLIES_REQUIRE_IMMEDIATE_REVIEW":replacements.length>0?"REPLACEMENT_CONTACTS_REQUIRE_RECOVERY":summary.humanReplies>0?"HUMAN_REPLIES_CLASSIFIED":"NO_NEW_HUMAN_REPLIES",fetched:{rows:fetched.items.length,newRows:fresh.length,pages:fetched.pages,minTimestamp:fetched.minTimestamp,truncated:fetched.truncated},latest:summary,cumulative:state.cumulative,alerts:executiveAlerts,governedRepliesReady:governedReady,replacementContactsRecovered:replacements.length,replacementContacts:replacements.map(item=>item.replacementContact),executiveSurface:{policy:"QUALIFIED_POSITIVE_ONLY",rawForwardingAllowed:false,surfaced:executiveAlerts.length,withheld:suppressedFromExecutive.length,queue:this.surfacePolicy.queuePath},suppressionsAddedOrConfirmed:routed.filter(item=>item.hardSuppression||item.replacementContact?.departedContactEmail).length,followupsScheduled:routed.filter(item=>["OOO","NOT_NOW"].includes(item.category)&&!item.replacementContact).length,manualReview:routed.filter(item=>["NEUTRAL_QUESTION","UNKNOWN"].includes(item.category)&&!item.replacementContact).length,queues:{qualified:this.qualifiedQueuePath,followup:this.followupQueuePath,review:this.reviewQueuePath,replacementContacts:this.replacementQueuePath,suppression:this.suppression.filePath,executiveSurface:this.surfacePolicy.queuePath},safety:{instantlyReadOnly:true,sendsExecuted:0,repliesSent:0,campaignMutations:0,autoActivation:false,nonQualifiedExecutiveInboxAllowed:false,replacementLeadRequiresVerification:true,qualifiedReplyExecutionDelegatedToGovernedRevenuePath:true},generatedAt:new Date().toISOString()};
      writeJsonAtomic(this.latestPath,report); writeJsonAtomic(this.kpiPath,{generatedAt:report.generatedAt,primaryFunnel:["DELIVERED","HUMAN_REPLIES","QUALIFIED_POSITIVE_REPLIES","MEETINGS","HELD_MEETINGS","BLUEPRINT_DEMOS","PROPOSALS","REVENUE"],rawReplyMetricDeprecated:true,threadDeduplicated:true,latest:summary,cumulative:state.cumulative,executiveSurface:report.executiveSurface,governedRepliesReady:governedReady,replacementContactsRecovered:replacements.length});
      this.log(`${report.status}; messages=${fresh.length}; conversations=${representatives.length}; human=${summary.humanReplies}; qualified=${summary.qualifiedPositiveReplies}; governedReady=${governedReady}; surfaced=${executiveAlerts.length}; replacements=${replacements.length}`); return report;
    }catch(error){ const report={ok:false,service:"REPLY_INTELLIGENCE_PRODUCTION_LOOP",status:"REPLY_INTELLIGENCE_POLL_FAILED",error:error.stack||error.message,safety:{instantlyReadOnly:true,sendsExecuted:0,repliesSent:0,campaignMutations:0},generatedAt:new Date().toISOString()}; writeJsonAtomic(this.latestPath,report); this.log(`${report.status}: ${error.message}`); return report; }
    finally{this.passRunning=false;}
  }

  start(){ if(this.running) return {ok:true,status:"REPLY_INTELLIGENCE_LOOP_ALREADY_STARTED",intervalMs:this.intervalMs}; this.running=true; Promise.resolve().then(()=>this.runOnce()).catch(error=>this.log(`Initial pass failed: ${error.message}`)); this.timer=setInterval(()=>this.runOnce().catch(error=>this.log(`Scheduled pass failed: ${error.message}`)),this.intervalMs); if(typeof this.timer.unref==="function") this.timer.unref(); return {ok:true,status:"REPLY_INTELLIGENCE_LOOP_STARTED",intervalMs:this.intervalMs,instantlyReadOnly:true,autonomousRepliesAllowed:true,autonomousReplyExecution:"GOVERNED_REVENUE_PATH_ONLY",executiveSurfacePolicy:"QUALIFIED_POSITIVE_ONLY",rawForwardingAllowed:false,replacementContactRecovery:true}; }
  stop(){ if(this.timer) clearInterval(this.timer); this.timer=null; this.running=false; return {ok:true,status:"REPLY_INTELLIGENCE_LOOP_STOPPED"}; }
}

module.exports=ReplyIntelligenceProductionLoopService;
module.exports.ReplyIntelligenceProductionLoopService=ReplyIntelligenceProductionLoopService;
module.exports.DEFAULT_INTERVAL_MS=DEFAULT_INTERVAL_MS;
module.exports.DEFAULT_CALENDLY_URL=DEFAULT_CALENDLY_URL;
module.exports.helpers={positiveInt,readJson,writeJsonAtomic,appendJsonl,queueUpsert,queueRemove,timestampMs,conversationKey,selectConversationRepresentatives,replyTargetUuid,senderAccount,replySubject,draftQualifiedReply};