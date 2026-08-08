"use strict";

const crypto=require("crypto"),fs=require("fs"),path=require("path");
function sha256(v){return crypto.createHash("sha256").update(v).digest("hex").toUpperCase();}
const AUTHORIZATION="AUTHORIZE_GATE_21_OUTBOUND_REMEDIATION_NO_LAUNCH";
const PLAN_FINGERPRINT="07745F581EE1D39C6C3809D03497680C480D0DBE72D184AF35CF084A231B3492";
const ROUTING_SHA="72383EABDECA53FCA74A03A5AEEEBA0F32F7AE36605AD98948DEFA5A2FD3F2BB";

class RevenueOutboundRemediationApplyService{
 constructor(options={}){
  this.service="REVENUE_OUTBOUND_REMEDIATION_APPLY";
  this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,"..",".."));
  this.planPath=options.planPath||path.join(this.rootDir,"DATA","runtime","revenue","outbound_remediation","plan.json");
  this.proposedRoutingPath=options.proposedRoutingPath||path.join(this.rootDir,"DATA","runtime","revenue","outbound_remediation","reply_routing_proposed.json");
  this.replyRoutingPath=options.replyRoutingPath||path.join(this.rootDir,"runtime","instantly_coo","reply_routing.json");
  this.outputRoot=options.outputRoot||path.join(this.rootDir,"DATA","runtime","revenue","outbound_remediation_apply");
  this.progressPath=options.progressPath||path.join(this.outputRoot,"progress.json");
  this.backupRoot=options.backupRoot||path.join(this.outputRoot,"campaign_backups");
  this.outputPath=options.outputPath||path.join(this.outputRoot,"manifest.json");
  this.generatedAt=options.generatedAt||(()=>new Date().toISOString());
  this.readProvider=options.readProvider|| (async id=>this.connector().getCampaign(id));
  this.updateProvider=options.updateProvider|| (async(id,payload)=>this.connector().updateCampaign(id,payload));
  this.pauseProvider=options.pauseProvider|| (async id=>this.connector().pauseCampaign(id,"Gate 21 governed remediation safety pause"));
 }
 connector(){const instantly=require(path.join(this.rootDir,"CONNECTORS","INSTANTLY","instantly.js"));if(instantly.getConfiguration().liveMutationsEnabled!==true)throw new Error("Instantly live mutations are not enabled.");return instantly;}
 plan(input={}){return{ok:true,service:this.service,mode:"PLAN_ONLY",status:"PLANNED",requestedAuthorization:input.authorization||null,providerWritesAuthorized:false,campaignsUpdated:0,emailsSent:false,campaignsLaunched:false};}
 loadJson(p){if(!fs.existsSync(p))throw new Error("Required Gate 21 evidence is missing: "+p);return JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));}
 confirmed(result,action){if(!result||typeof result!=="object"||result.dryRun===true||result.mutationExecuted===false)throw new Error("Instantly did not confirm live "+action+".");return result;}
 persist(progress){fs.mkdirSync(this.outputRoot,{recursive:true});const tmp=this.progressPath+".tmp";fs.writeFileSync(tmp,JSON.stringify(progress,null,2),"utf8");fs.renameSync(tmp,this.progressPath);}
 sequence(steps){return[{steps:steps.map(item=>({type:"email",delay:Number(item.delayDays),variants:[{subject:item.subject,body:item.body}]}))}];}
 async apply(input={}){
  if(input.apply!==true)return this.plan(input);
  if(input.live!==true)throw new Error("Explicit --live remediation authorization is required.");
  if(input.authorization!==AUTHORIZATION)throw new Error("Exact CEO Gate 21 authorization is required.");
  const plan=this.loadJson(this.planPath),routing=this.loadJson(this.proposedRoutingPath);
  if(plan.ok!==true||plan.status!=="OUTBOUND_REMEDIATION_PLANNED"||plan.remediationFingerprint!==PLAN_FINGERPRINT||Number(plan.summary?.campaignsToRemediate)!==9||Number(plan.summary?.readyCampaignsPreserved)!==1)throw new Error("Gate 20 remediation plan changed.");
  if(sha256(fs.readFileSync(this.proposedRoutingPath))!==ROUTING_SHA||routing.ok!==true)throw new Error("Gate 20 reply routing integrity check failed.");
  if(plan.providerWritesAuthorized!==false||plan.emailsSent!==false||plan.campaignsLaunched!==false)throw new Error("Gate 20 authority boundary is invalid.");
  fs.mkdirSync(this.backupRoot,{recursive:true});
  const progress=fs.existsSync(this.progressPath)?this.loadJson(this.progressPath):{authorization:AUTHORIZATION,sourceRemediationFingerprint:plan.remediationFingerprint,routes:{}};
  if(progress.authorization!==AUTHORIZATION||progress.sourceRemediationFingerprint!==plan.remediationFingerprint)throw new Error("Existing Gate 21 progress does not match this authorization.");
  let updatedThisRun=0,pausedThisRun=0;
  for(const route of plan.routes){
   const state=progress.routes[route.route]||{};
   if(!state.backupSaved){
    const current=await this.readProvider(route.campaignId);
    const backupPath=path.join(this.backupRoot,route.route.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"")+".json");
    fs.writeFileSync(backupPath,JSON.stringify(current,null,2),"utf8");
    state.backupSaved=true;state.backupPath=backupPath;state.backupSha256=sha256(fs.readFileSync(backupPath));progress.routes[route.route]=state;this.persist(progress);
   }
   if(route.action==="PRESERVE_READY_CAMPAIGN"){state.preserved=true;progress.routes[route.route]=state;this.persist(progress);continue;}
   if(!state.updated){
    if(!Array.isArray(route.proposedSequence)||route.proposedSequence.length!==4)throw new Error("Four-step sequence is missing for "+route.route+".");
    const payload={sequences:this.sequence(route.proposedSequence),stop_on_reply:route.proposedControls.stopOnReply===true?true:undefined,stop_on_auto_reply:route.proposedControls.stopOnAutoReply===true?true:undefined,allow_risky_contacts:false,disable_bounce_protect:false};
    Object.keys(payload).forEach(key=>payload[key]===undefined&&delete payload[key]);
    this.confirmed(await this.updateProvider(route.campaignId,payload),"campaign remediation");
    state.updated=true;state.updatedAt=this.generatedAt();state.payloadSha256=sha256(Buffer.from(JSON.stringify(payload)));updatedThisRun++;progress.routes[route.route]=state;this.persist(progress);
   }
   if(!state.paused){
    this.confirmed(await this.pauseProvider(route.campaignId),"campaign pause");
    state.paused=true;state.pausedAt=this.generatedAt();pausedThisRun++;progress.routes[route.route]=state;this.persist(progress);
   }
  }
  const states=Object.values(progress.routes),updated=states.filter(x=>x.updated).length,paused=states.filter(x=>x.paused).length,preserved=states.filter(x=>x.preserved).length;
  if(updated!==9||paused!==9||preserved!==1)throw new Error("Gate 21 remediation conservation failed.");
  fs.mkdirSync(path.dirname(this.replyRoutingPath),{recursive:true});const tmp=this.replyRoutingPath+".tmp";fs.writeFileSync(tmp,JSON.stringify(routing,null,2),"utf8");fs.renameSync(tmp,this.replyRoutingPath);
  const report={ok:true,service:this.service,mode:"APPLY_LIVE_AUTHORIZED",status:"OUTBOUND_REMEDIATION_COMPLETED",generatedAt:this.generatedAt(),authorization:AUTHORIZATION,sourceRemediationFingerprint:plan.remediationFingerprint,summary:{campaignsUpdated:updated,campaignsPaused:paused,readyCampaignsPreserved:preserved,updatedThisRun,pausedThisRun,replyRoutingPersisted:true},providerWritesAuthorized:true,providerWriteScope:"UPDATE_9_PAUSED_CAMPAIGNS_AND_PERSIST_REPLY_ROUTING",leadsUploaded:0,emailsSent:false,campaignsLaunched:false,allCampaignsMustRemainPaused:true};
  const identity={...report};delete identity.generatedAt;report.applyFingerprint=sha256(Buffer.from(JSON.stringify(identity)));
  fs.writeFileSync(this.outputPath,JSON.stringify(report,null,2),"utf8");report.artifact={filePath:this.outputPath,sha256:sha256(fs.readFileSync(this.outputPath))};return report;
 }
}
module.exports=RevenueOutboundRemediationApplyService;
