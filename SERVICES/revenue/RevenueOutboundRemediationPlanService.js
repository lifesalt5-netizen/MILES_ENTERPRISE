"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
function sha256(value){return crypto.createHash("sha256").update(value).digest("hex").toUpperCase();}

class RevenueOutboundRemediationPlanService {
  constructor(options={}){
    this.service="REVENUE_OUTBOUND_REMEDIATION_PLAN";
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,"..",".."));
    this.auditPath=options.auditPath||path.join(this.rootDir,"DATA","runtime","revenue","outbound_readiness","manifest.json");
    this.outputRoot=options.outputRoot||path.join(this.rootDir,"DATA","runtime","revenue","outbound_remediation");
    this.outputPath=options.outputPath||path.join(this.outputRoot,"plan.json");
    this.replyRoutingPath=options.replyRoutingPath||path.join(this.outputRoot,"reply_routing_proposed.json");
    this.generatedAt=options.generatedAt||(()=>new Date().toISOString());
  }
  preview(){return{ok:true,service:this.service,mode:"PLAN_ONLY",status:"PLANNED",providerWritesAuthorized:false,emailsSent:false,campaignsChanged:false,campaignsLaunched:false};}
  load(){if(!fs.existsSync(this.auditPath))throw new Error("Gate 19 readiness audit is missing.");return JSON.parse(fs.readFileSync(this.auditPath,"utf8").replace(/^\uFEFF/,""));}
  theme(route){
    if(/^Expiring GSA/.test(route))return{subject:"Protect {{company_name}}'s GSA position",problem:"your GSA contract is approaching a renewal window",outcome:"protect the vehicle, correct compliance gaps, and build a realistic sales plan before the deadline"};
    if(/^Expiring VA/.test(route))return{subject:"Protect {{company_name}}'s VA/FSS position",problem:"your VA/FSS contract is approaching a renewal window",outcome:"protect the vehicle, correct compliance gaps, and create a usable federal sales pathway"};
    if(route==="GSA")return{subject:"Turn {{company_name}}'s GSA Schedule into pipeline",problem:"many Schedule holders have the vehicle but little measurable federal revenue",outcome:"identify the right buyers, opportunities, partners, and capture actions"};
    if(route==="VA")return{subject:"Build revenue from {{company_name}}'s VA/FSS access",problem:"VA/FSS access does not automatically create qualified pipeline",outcome:"align the vehicle to buyers, recompetes, teaming partners, and executable pursuits"};
    if(["8(a)","HUBZone","SDVOSB","VOSB","WOSB"].includes(route))return{subject:"Convert {{company_name}}'s "+route+" status into opportunities",problem:"certification alone rarely creates consistent qualified pipeline",outcome:"target agencies and primes that can use the designation while building direct-award and competitive pursuits"};
    return{subject:"A practical government growth path for {{company_name}}",problem:"government growth often stalls without a connected vehicle, buyer, opportunity, and capture plan",outcome:"build a prioritized pathway from readiness through meetings and pursuits"};
  }
  sequence(route){
    const t=this.theme(route);
    return[
      {step:1,delayDays:0,subject:t.subject,body:"Hi {{first_name}},\n\nI am reaching out because "+t.problem+". P2GC helps government contractors "+t.outcome+".\n\nWould a 15-minute review of {{company_name}}'s current position be useful?\n\nKevin\nPathways 2 Government Contracting"},
      {step:2,delayDays:2,subject:"Re: "+t.subject,body:"Hi {{first_name}},\n\nA quick follow-up: we can show where {{company_name}} is positioned today, the highest-probability gaps, and the next actions most likely to create qualified government conversations.\n\nWorth comparing notes for 15 minutes?\n\nKevin"},
      {step:3,delayDays:4,subject:"What we would review for {{company_name}}",body:"Hi {{first_name}},\n\nThe review covers vehicle and certification use, buyer alignment, active and future opportunities, teaming targets, and the operational steps needed to move from eligibility to awards.\n\nIf someone else owns government growth, who is the right person?\n\nKevin"},
      {step:4,delayDays:7,subject:"Close the loop?",body:"Hi {{first_name}},\n\nI will close the loop for now. If improving {{company_name}}'s government pipeline is a priority this quarter, I am happy to provide a concise readiness and growth review.\n\nShould I send available times?\n\nKevin"}
    ];
  }
  build(input={}){
    if(input.apply!==true)return this.preview();
    const audit=this.load();
    if(audit.ok!==true||audit.status!=="OUTBOUND_READINESS_AUDITED"||audit.readinessFingerprint!=="278C79A52A620522295BB9848E11A223FFA3B3BACFBC67079CBBB4EFAAE2F1A6"||Number(audit.summary?.campaignsAudited)!==10)throw new Error("Gate 19 readiness evidence changed.");
    const routes=audit.routes.map(route=>{
      const needsSequence=route.blockers.includes("FOUR_STEP_SEQUENCE_REQUIRED");
      const needsReply=route.blockers.includes("STOP_ON_REPLY_REQUIRED");
      const needsAuto=route.blockers.includes("STOP_ON_AUTO_REPLY_REQUIRED");
      return{
        route:route.route,campaignId:route.campaignId,currentSteps:route.messageSteps,
        action:route.ready?"PRESERVE_READY_CAMPAIGN":"REMEDIATE_PAUSED_CAMPAIGN",
        proposedSequence:needsSequence?this.sequence(route.route):null,
        proposedControls:{stopOnReply:needsReply?true:null,stopOnAutoReply:needsAuto?true:null,allowRiskyContacts:false,disableBounceProtect:false},
        mustRemainPaused:true,launchAuthorized:false
      };
    });
    const replyRouting={ok:true,positive:"BOOKING_AND_HUMAN_FOLLOW_UP",negative:"DO_NOT_CONTACT",neutral:"NURTURE",technical:"TECHNICAL_REVIEW",outOfOffice:"OUT_OF_OFFICE_RETRY_AFTER_RETURN",unsubscribe:"GLOBAL_SUPPRESSION",unknown:"MANUAL_REVIEW",autoReplyDoesNotCountAsPositive:true};
    const report={ok:true,service:this.service,mode:"APPLY_INTERNAL_PLAN",status:"OUTBOUND_REMEDIATION_PLANNED",generatedAt:this.generatedAt(),sourceReadinessFingerprint:audit.readinessFingerprint,summary:{campaigns:10,campaignsToRemediate:routes.filter(x=>x.action==="REMEDIATE_PAUSED_CAMPAIGN").length,sequencesToInstall:routes.filter(x=>x.proposedSequence).length,stopOnReplyUpdates:routes.filter(x=>x.proposedControls.stopOnReply===true).length,stopOnAutoReplyUpdates:routes.filter(x=>x.proposedControls.stopOnAutoReply===true).length,readyCampaignsPreserved:routes.filter(x=>x.action==="PRESERVE_READY_CAMPAIGN").length},routes,replyRouting,providerWritesAuthorized:false,emailsSent:false,campaignsChanged:false,campaignsLaunched:false,authorizationRequired:"AUTHORIZE_GATE_21_OUTBOUND_REMEDIATION_NO_LAUNCH"};
    const identity={...report};delete identity.generatedAt;report.remediationFingerprint=sha256(Buffer.from(JSON.stringify(identity)));
    fs.mkdirSync(this.outputRoot,{recursive:true});
    fs.writeFileSync(this.replyRoutingPath,JSON.stringify(replyRouting,null,2),"utf8");
    fs.writeFileSync(this.outputPath,JSON.stringify(report,null,2),"utf8");
    report.artifacts={plan:{filePath:this.outputPath,sha256:sha256(fs.readFileSync(this.outputPath))},replyRouting:{filePath:this.replyRoutingPath,sha256:sha256(fs.readFileSync(this.replyRoutingPath))}};
    return report;
  }
}
module.exports=RevenueOutboundRemediationPlanService;
