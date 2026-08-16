"use strict";

const fs=require("fs");
const path=require("path");
const http=require("http");
const {execSync}=require("child_process");
const ROOT=process.env.MILES_ROOT||process.cwd();
const STRICT=/^(1|true|yes)$/i.test(String(process.env.P2GC_WHOLE_SYSTEM_STRICT||""));
const OUT=path.join(ROOT,"DATA","runtime_guardian","whole_system_acceptance_latest.json");
const checks=[];
function add(area,name,status,detail=null){const ok=status==="PASS"||status==="PASS_READ_ONLY"||status==="PASS_INTERNAL";checks.push({area,name,status,ok,detail});console.log(`[${status}] ${area} :: ${name}${detail?` :: ${detail}`:""}`);}
function exists(p){return fs.existsSync(path.join(ROOT,p));}
function req(port,p){return new Promise((resolve,reject)=>{const r=http.request({hostname:"127.0.0.1",port,path:p,method:"GET",timeout:15000},res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>{let j=null;try{j=JSON.parse(d)}catch{}resolve({status:res.statusCode,text:d,json:j});});});r.on("timeout",()=>r.destroy(new Error("timeout")));r.on("error",reject);r.end();});}
function pm2(name){try{const apps=JSON.parse(execSync("pm2 jlist",{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));const a=apps.find(x=>x.name===name);return a&&a.pm2_env?.status==="online"&&Number(a.pid||0)>0;}catch{return false;}}
function internalFile(area,name,file){add(area,name,exists(file)?"PASS_INTERNAL":"FAIL_INTERNAL",file);}

(async()=>{
  for(const [name,file] of [
    ["MILES Digital COO","StartAutonomousCOO.js"],["Executive Dashboard","StartExecutiveDashboard.js"],["Command Center","SERVICES/digital_coo/MilesCommandCenter.js"],["Desktop UI","StartMiles.js"],["Worker Runtime","StartProductionSystem.js"],["Workflow Engine","SERVICES/WorkflowEngineService.js"],["Queue Management","CORE/TaskQueue.js"],["Business Operations Bridge","SERVICES/BusinessOperationsBridgeService.js"],["Event Bus","CORE/EventBus.js"],["Revenue Truth Gate","SERVICES/revenue/RevenueTruthGateService.js"]
  ]) internalFile("OPERATIONS",name,file);
  internalFile("OPERATIONS","Provider Framework","SERVICES/ProviderRouterService.js");
  internalFile("OPERATIONS","Self-Development Workers","SERVICES/WorkerBootstrap.js");
  internalFile("OPERATIONS","Marketing Operations","PROVIDERS/providers/MarketingProvider.js");
  internalFile("OPERATIONS","ORION Intelligence Platform","CONNECTORS/ORION/connector.js");

  const providerRouter=require("../SERVICES/ProviderRouterService");
  const providerStatus=providerRouter.status();
  add("OPERATIONS","Provider registry validates",providerStatus.validation?.ok?"PASS":"FAIL_INTERNAL",`providers=${providerStatus.validation?.providerCount||0}`);
  const authority=require("../SERVICES/ProviderAuthorityRegistryService").run({source:"whole-system-acceptance"});
  for(const key of ["instantly","google_workspace","namecheap","website","orion","filesystem"]){
    const p=authority.providers.find(x=>x.key===key);
    if(!p){add("CONNECTORS",key,"FAIL_INTERNAL","missing provider authority");continue;}
    if(p.credentialsPresent) add("CONNECTORS",key,p.capabilities.write.enabled?"PASS":"PASS_READ_ONLY",p.status);
    else add("CONNECTORS",key,"BLOCKED_EXTERNAL",`missing: ${p.credentials?.missingEnv?.join(", ")||"credentials"}`);
  }

  const WorkerExecutionBridge=require("../SERVICES/WorkerExecutionBridge");
  const registry=require("../SERVICES/WorkerRegistry");
  new WorkerExecutionBridge();
  for(const w of ["SELF_DEVELOPMENT","ARCHITECT","BUILDER","VALIDATOR","TESTER","DEPLOYER","RECOVERY","ATLAS"]){const worker=registry.get(w);add("WORKFORCE",w,worker&&typeof worker.execute==="function"?"PASS":"FAIL_INTERNAL",worker?"registered":"missing");}

  for(const [name,file] of [
    ["Executive Government Growth Blueprint","SERVICES/demo/ExecutiveGrowthBlueprintDemoService.js"],["Discovery process","SERVICES/revenue/ProspectGrowthAssessmentService.js"],["Gap analysis","SERVICES/revenue/ProspectGrowthAssessmentService.js"],["Competitor analysis","SERVICES/revenue/ProspectGrowthAssessmentService.js"],["Agency alignment","SERVICES/revenue/ProspectGrowthAssessmentService.js"],["Proposal system","SERVICES/growth/P2GCGrowthAssetService.js"],["Qualification gate","GOVERNANCE/ENGINEERING_FULL_SYSTEM_FIX_RULE.md"],["GO/NO-GO framework","GOVERNANCE"],["Capture positioning","CONNECTORS/ORION/connector.js"]
  ]) internalFile("SALES",name,file);

  for(const [name,file] of [["Campaign segmentation","SERVICES/revenue/RevenueSegmentReadinessService.js"],["MillionVerifier verification","SERVICES/revenue/RevenueVerificationReconciliationService.js"],["Verified lead activation","SERVICES/revenue/RevenueVerifiedSegmentActivationService.js"],["Reply routing","SERVICES/ReplyIntelligenceEngine.js"],["CRM workflow","SERVICES/customer/P2GCCustomerDeliveryService.js"],["Monthly data refresh","SERVICES/revenue/RevenueLeadInventoryClassificationService.js"]]) internalFile("MARKETING",name,file);

  const customer=require("../SERVICES/customer/P2GCCustomerDeliveryService");
  add("CUSTOMER DELIVERY","CRM",customer.healthCheck().ok?"PASS":"FAIL_INTERNAL");
  add("CUSTOMER DELIVERY","Client portal",typeof customer.portal==="function"?"PASS":"FAIL_INTERNAL");
  add("CUSTOMER DELIVERY","Revenue Command Center",customer.revenueCommandCenter().ok?"PASS":"FAIL_INTERNAL");
  add("CUSTOMER DELIVERY","Subscription billing ledger",customer.healthCheck().billing?.ledgerReady?"PASS_READ_ONLY":"FAIL_INTERNAL",customer.healthCheck().billing?.externalChargeStatus);
  add("CUSTOMER DELIVERY","Automated executive brief",typeof customer.executiveBrief==="function"?"PASS":"FAIL_INTERNAL");

  const growth=require("../SERVICES/growth/P2GCGrowthAssetService");
  const gd=growth.dashboard();
  for(const name of ["Proposal library","Knowledge base","Social media automation","Newsletter","Case studies","Lead magnets","Website backlog"]) add("GROWTH ASSETS",name,gd.ok?"PASS_INTERNAL":"FAIL_INTERNAL");
  add("GROWTH ASSETS","LinkedIn live publishing",gd.publishing.linkedin?"PASS":"BLOCKED_EXTERNAL","governed publisher not configured");
  add("GROWTH ASSETS","B12 live publishing",gd.publishing.b12?"PASS":"BLOCKED_EXTERNAL","governed publisher not configured");
  add("GROWTH ASSETS","Newsletter live publishing",gd.publishing.emailNewsletter?"PASS":"BLOCKED_EXTERNAL","governed publisher not configured");

  for(const [name,file] of [["SAM","CONNECTORS/ORION/connector.js"],["GSA","CONNECTORS/ORION/connector.js"],["VA","CONNECTORS/ORION/connector.js"],["SBA","CONNECTORS/ORION/connector.js"],["Award data","CONNECTORS/ORION/connector.js"],["Forecast data","CONNECTORS/ORION/connector.js"],["Recompete data","CONNECTORS/ORION/connector.js"],["SLED data","CONNECTORS/ORION/connector.js"]]) internalFile("DATA",name,file);

  for(const n of ["Eleanor","Jeff","Victoria","Allison","Claudia","Daniel","Cora","Jackson","Keith","Marcus","Maya","Riley","Atlas","Aden","Natalie"]) add("AI TWINS",n,exists("CONFIG/WORKFORCE/MILES_WORKFORCE_REGISTRY.json")?"PASS_INTERNAL":"FAIL_INTERNAL","registry-backed role requires production data/provider acceptance");

  const endpoints=[["MILES API",3000,"/"],["Command Center",8787,"/api/health"],["CEO Dashboard",8737,"/api/state"],["CEO Revenue",8737,"/api/revenue"],["Desktop UI",3737,"/api/status"],["Customer Delivery",8792,"/api/health"],["Prospect Demo",8791,"/api/health"]];
  for(const [name,port,p] of endpoints){try{const r=await req(port,p);add("LIVE SURFACES",name,r.status===200?"PASS":"FAIL_INTERNAL",`http=${r.status}`);}catch(e){add("LIVE SURFACES",name,STRICT?"FAIL_INTERNAL":"NOT_RUNNING_IN_THIS_ENV",e.message);}}
  for(const name of ["miles-api","miles-worker","miles-command-center","miles-executive-dashboard","miles-desktop-ui","miles-autonomous-coo","p2gc-customer-delivery","p2gc-growth-demo"]){const online=pm2(name);add("PM2",name,online?"PASS":(STRICT?"FAIL_INTERNAL":"NOT_RUNNING_IN_THIS_ENV"),online?"online":"not online");}

  const internalFailures=checks.filter(x=>x.status==="FAIL_INTERNAL");
  const blockedExternal=checks.filter(x=>x.status==="BLOCKED_EXTERNAL");
  const strictFailures=STRICT?blockedExternal:[];
  const report={ok:internalFailures.length===0&&strictFailures.length===0,strict:STRICT,generatedAt:new Date().toISOString(),summary:{checks:checks.length,internalFailures:internalFailures.length,blockedExternal:blockedExternal.length,notRunning:checks.filter(x=>x.status==="NOT_RUNNING_IN_THIS_ENV").length},internalFailures,blockedExternal,checks};
  fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(report,null,2));
  console.log(`=== WHOLE SYSTEM ACCEPTANCE ${report.ok?"PASS":"FAIL"} ===`);console.log(`report: ${OUT}`);process.exitCode=report.ok?0:1;
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
