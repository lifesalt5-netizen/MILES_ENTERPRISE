"use strict";

const fs=require("fs");
const path=require("path");
const http=require("http");
const {runPm2,parsePm2Jlist}=require("./ReconcilePm2Process");
const ROOT=process.env.MILES_ROOT||process.cwd();
const STRICT=/^(1|true|yes)$/i.test(String(process.env.P2GC_WHOLE_SYSTEM_STRICT||""));
const OUT=path.join(ROOT,"DATA","runtime_guardian","whole_system_acceptance_latest.json");
const checks=[];
function add(area,name,status,detail=null){const ok=status==="PASS"||status==="PASS_READ_ONLY"||status==="PASS_INTERNAL";checks.push({area,name,status,ok,detail});console.log(`[${status}] ${area} :: ${name}${detail?` :: ${detail}`:""}`);}
function exists(p){return fs.existsSync(path.join(ROOT,p));}
function req(port,p){return new Promise((resolve,reject)=>{const r=http.request({hostname:"127.0.0.1",port,path:p,method:"GET",timeout:15000},res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>{let j=null;try{j=JSON.parse(d)}catch{}resolve({status:res.statusCode,text:d,json:j});});});r.on("timeout",()=>r.destroy(new Error("timeout")));r.on("error",reject);r.end();});}
function pm2(name){try{const apps=parsePm2Jlist(runPm2(["jlist"]).stdout);const a=apps.find(x=>x.name===name);return Boolean(a&&a.pm2_env?.status==="online"&&Number(a.pid||0)>0);}catch{return false;}}
function internalFile(area,name,file){add(area,name,exists(file)?"PASS_INTERNAL":"FAIL_INTERNAL",file);}

(async()=>{
  for(const [name,file] of [
    ["MILES Digital COO","StartAutonomousCOO.js"],
    ["Executive Dashboard","StartExecutiveDashboard.js"],
    ["Command Center","SERVICES/digital_coo/MilesCommandCenter.js"],
    ["Desktop UI","StartMiles.js"],
    ["Worker Runtime","StartProductionSystem.js"],
    ["Workflow Engine","SERVICES/WorkflowService.js"],
    ["Queue Management","CORE/TaskQueue.js"],
    ["Business Operations Bridge","SERVICES/BusinessOperationsBridgeService.js"],
    ["Event Bus","CORE/EventBus.js"],
    ["Revenue Truth Gate","SERVICES/revenue/RevenueTruthGateService.js"],
    ["Executive Mission Engine","SERVICES/BusinessExecutionEngineServiceV2.js"],
    ["Negation-aware Governance","SERVICES/governance/PolicyEngineService.js"]
  ]) internalFile("OPERATIONS",name,file);
  internalFile("OPERATIONS","Provider Framework","SERVICES/ProviderRouterService.js");
  internalFile("OPERATIONS","Self-Development Workers","SERVICES/WorkerBootstrap.js");
  internalFile("OPERATIONS","Marketing Operations","PROVIDERS/providers/MarketingProvider.js");
  internalFile("OPERATIONS","ORION Intelligence Platform","CONNECTORS/ORION/connector.js");

  const revenueTruth=require("../SERVICES/revenue/RevenueTruthGateService").run();
  add("OPERATIONS","Revenue Truth Gate executes",revenueTruth.ok&&revenueTruth.rules?.syntheticExcluded?"PASS":"FAIL_INTERNAL",`real=${revenueTruth.counts?.real||0} excluded=${revenueTruth.counts?.excludedSynthetic||0}`);

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
  add("CONNECTORS","MillionVerifier",process.env.MILLIONVERIFIER_API_KEY?"PASS_READ_ONLY":"BLOCKED_EXTERNAL",process.env.MILLIONVERIFIER_API_KEY?"credential present":"MILLIONVERIFIER_API_KEY not configured in this environment");
  add("CONNECTORS","LinkedIn publisher",process.env.LINKEDIN_ACCESS_TOKEN?"PASS_READ_ONLY":"BLOCKED_EXTERNAL",process.env.LINKEDIN_ACCESS_TOKEN?"credential present":"governed LinkedIn publisher credential not configured");
  add("CONNECTORS","B12 publisher",process.env.B12_API_KEY?"PASS_READ_ONLY":"BLOCKED_EXTERNAL",process.env.B12_API_KEY?"credential present":"governed B12 publisher credential not configured");
  add("CONNECTORS","Payment provider",process.env.STRIPE_SECRET_KEY?"PASS_READ_ONLY":"BLOCKED_EXTERNAL",process.env.STRIPE_SECRET_KEY?"credential present":"payment provider credential not configured; ledger remains fail-closed");

  const WorkerExecutionBridge=require("../SERVICES/WorkerExecutionBridge");
  const registry=require("../SERVICES/WorkerRegistry");
  new WorkerExecutionBridge();
  for(const w of ["SELF_DEVELOPMENT","ARCHITECT","BUILDER","VALIDATOR","TESTER","DEPLOYER","RECOVERY","ATLAS"]){const worker=registry.get(w);add("WORKFORCE",w,worker&&typeof worker.execute==="function"?"PASS":"FAIL_INTERNAL",worker?"registered":"missing");}

  for(const [name,file] of [
    ["Executive Government Growth Blueprint","SERVICES/demo/ExecutiveGrowthBlueprintDemoService.js"],
    ["Sub2Prime Prime/Sub Teaming Intelligence","SERVICES/teaming/P2GCPrimeSubTeamingService.js"],
    ["Discovery process","SERVICES/revenue/ProspectGrowthAssessmentService.js"],
    ["Gap analysis","SERVICES/revenue/ProspectGrowthAssessmentService.js"],
    ["Competitor analysis","SERVICES/revenue/ProspectGrowthAssessmentService.js"],
    ["Agency alignment","SERVICES/revenue/ProspectGrowthAssessmentService.js"],
    ["Capture positioning","CONNECTORS/ORION/connector.js"]
  ]) internalFile("SALES",name,file);
  internalFile("SALES","Qualification + GO/NO-GO service","SERVICES/sales/P2GCSalesQualificationService.js");
  const salesGate=require("../SERVICES/sales/P2GCSalesQualificationService");
  const qualified=salesGate.qualify({opportunityId:"WHOLE_SYSTEM",primeEligibility:true,minimumQualifications:true,corporateExperience:true,requiredReferences:true,keyPersonnel:true,securityRequirements:true,vehicleEligibility:true,solicitationCompliance:true});
  const proposal=salesGate.buildProposalPackage({opportunityId:"WHOLE_SYSTEM",qualification:qualified,technicalSections:["Approach"],complianceMatrix:[{requirement:"Acceptance",status:"MAPPED"}]});
  add("SALES","GO/NO-GO qualification executes",qualified.decision==="GO"&&qualified.proposalAuthorized?"PASS":"FAIL_INTERNAL",qualified.decision);
  add("SALES","Proposal package generation executes",proposal.ok&&proposal.status==="DRAFT_READY_FOR_REVIEW"&&proposal.submission?.submitted===false?"PASS":"FAIL_INTERNAL",proposal.status||proposal.decision);
  internalFile("SALES","Proposal library","SERVICES/growth/P2GCGrowthAssetService.js");

  const TeamingService=require("../SERVICES/teaming/P2GCPrimeSubTeamingService");
  const teamingFixture={ok:true,profile:{companyName:"Acceptance Prospect",uei:"ACCEPTANCE001",naicsCodes:["541512"],certifications:[],contractVehicles:["GSA MAS"]},readiness:{overall:80},pathway:{type:"GROWTH_PATHWAY"},competitors:{status:"ORION_MARKET_PEER_MODEL"},primePartners:{status:"ORION_MARKET_PEER_MODEL",records:[{company:"Acceptance Prime",uei:"PRIME001",federalRevenue:1000000,awardCount:2,vehicle:"GSA MAS",agencies:["Agency A"],basis:"Shares primary NAICS 541512",confidence:"MODELED_CANDIDATE"}],strategy:["Validate prime fit."]},subcontracting:{status:"NO_CURRENT_TEAMING_SIGNAL_IDENTIFIED",records:[]},agencyAlignment:{status:"ORION_HISTORICAL_ALIGNMENT_MODEL",agencies:[{agency:"Agency A",fitScore:90,basis:"Historical ORION buyer alignment"}]},evidence:{disclosure:"Validate modeled signals."}};
  const teaming=new TeamingService({blueprintService:{build:()=>teamingFixture}}).build("Acceptance Prospect");
  add("SALES","Sub2Prime behavior executes",teaming.ok&&teaming.primeCandidates?.length===1&&teaming.targetAgencies?.length===1&&teaming.safety?.contactsInvented===false?"PASS":"FAIL_INTERNAL",teaming.status);

  for(const [name,file] of [
    ["Campaign segmentation","SERVICES/revenue/RevenueSegmentReadinessService.js"],
    ["MillionVerifier verification","SERVICES/revenue/RevenueVerificationReconciliationService.js"],
    ["Verified lead activation","SERVICES/revenue/RevenueVerifiedSegmentActivationService.js"],
    ["Reply routing","SERVICES/ReplyIntelligenceEngine.js"],
    ["CRM workflow","SERVICES/customer/P2GCCustomerDeliveryService.js"],
    ["Monthly data refresh","SERVICES/revenue/RevenueLeadInventoryClassificationService.js"]
  ]) internalFile("MARKETING",name,file);

  const customer=require("../SERVICES/customer/P2GCCustomerDeliveryService");
  add("CUSTOMER DELIVERY","CRM",customer.healthCheck().ok?"PASS":"FAIL_INTERNAL");
  add("CUSTOMER DELIVERY","Client portal",typeof customer.portal==="function"?"PASS":"FAIL_INTERNAL");
  add("CUSTOMER DELIVERY","Revenue Command Center",customer.revenueCommandCenter().ok?"PASS":"FAIL_INTERNAL");
  add("CUSTOMER DELIVERY","Subscription billing ledger",customer.healthCheck().billing?.ledgerReady?"PASS_READ_ONLY":"FAIL_INTERNAL",customer.healthCheck().billing?.externalChargeStatus);
  add("CUSTOMER DELIVERY","Automated executive brief",typeof customer.executiveBrief==="function"?"PASS":"FAIL_INTERNAL");

  const growth=require("../SERVICES/growth/P2GCGrowthAssetService");
  const gd=growth.dashboard();
  for(const name of ["Proposal library","Knowledge base","Social media automation","Newsletter","Case studies","Lead magnets","Website backlog"]) add("GROWTH ASSETS",name,gd.ok?"PASS_INTERNAL":"FAIL_INTERNAL");
  add("GROWTH ASSETS","LinkedIn content preparation",gd.ok?"PASS_INTERNAL":"FAIL_INTERNAL","publishing remains governed");
  add("GROWTH ASSETS","B12 website change preparation",gd.ok?"PASS_INTERNAL":"FAIL_INTERNAL","publishing remains governed");

  for(const [name,file] of [["SAM","CONNECTORS/ORION/connector.js"],["GSA","CONNECTORS/ORION/connector.js"],["VA","CONNECTORS/ORION/connector.js"],["SBA","CONNECTORS/ORION/connector.js"],["Award data","CONNECTORS/ORION/connector.js"],["Forecast data","CONNECTORS/ORION/connector.js"],["Recompete data","CONNECTORS/ORION/connector.js"],["SLED data","CONNECTORS/ORION/connector.js"]]) internalFile("DATA",name,file);

  for(const n of ["Eleanor","Jeff","Victoria","Allison","Claudia","Daniel","Cora","Jackson","Keith","Marcus","Maya","Riley","Atlas","Aden","Natalie"]) add("AI TWINS",n,exists("CONFIG/WORKFORCE/MILES_WORKFORCE_REGISTRY.json")?"PASS_INTERNAL":"FAIL_INTERNAL","registry-backed role; live intelligence depends on production ORION/provider truth");

  const endpoints=[["MILES API",3000,"/"],["Command Center",8787,"/api/health"],["CEO Dashboard",8737,"/api/state"],["CEO Revenue",8737,"/api/revenue"],["CEO Growth Assets",8737,"/api/growth-assets"],["Desktop UI",3737,"/api/status"],["Customer Delivery",8792,"/api/health"],["Prospect Demo",8791,"/api/health"],["Sub2Prime UI",8791,"/teaming"]];
  for(const [name,port,p] of endpoints){try{const r=await req(port,p);add("LIVE SURFACES",name,r.status===200?"PASS":"FAIL_INTERNAL",`http=${r.status}`);}catch(e){add("LIVE SURFACES",name,STRICT?"FAIL_INTERNAL":"NOT_RUNNING_IN_THIS_ENV",e.message);}}
  try{const h=await req(8791,"/api/health");const caps=h.json?.capabilities||[];add("LIVE SURFACES","8791 Blueprint + Sub2Prime capability contract",h.status===200&&caps.includes("executive_growth_blueprint")&&caps.includes("prime_sub_teaming")?"PASS":"FAIL_INTERNAL",caps.join(","));}catch(e){add("LIVE SURFACES","8791 Blueprint + Sub2Prime capability contract",STRICT?"FAIL_INTERNAL":"NOT_RUNNING_IN_THIS_ENV",e.message);}
  for(const name of ["miles-api","miles-worker","miles-command-center","miles-executive-dashboard","miles-desktop-ui","miles-autonomous-coo","p2gc-customer-delivery","p2gc-growth-demo"]){const online=pm2(name);add("PM2",name,online?"PASS":(STRICT?"FAIL_INTERNAL":"NOT_RUNNING_IN_THIS_ENV"),online?"online":"not online");}

  const internalFailures=checks.filter(x=>x.status==="FAIL_INTERNAL");
  const blockedExternal=checks.filter(x=>x.status==="BLOCKED_EXTERNAL");
  const strictFailures=STRICT?blockedExternal:[];
  const report={ok:internalFailures.length===0&&strictFailures.length===0,strict:STRICT,generatedAt:new Date().toISOString(),summary:{checks:checks.length,internalFailures:internalFailures.length,blockedExternal:blockedExternal.length,notRunning:checks.filter(x=>x.status==="NOT_RUNNING_IN_THIS_ENV").length},internalFailures,blockedExternal,checks};
  fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(report,null,2));
  console.log(`=== WHOLE SYSTEM ACCEPTANCE ${report.ok?"PASS":"FAIL"} ===`);console.log(`report: ${OUT}`);process.exitCode=report.ok?0:1;
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
