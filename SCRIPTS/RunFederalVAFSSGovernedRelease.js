"use strict";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const LIVE = argv.includes("--live");
const authArg = argv.find(v => v.startsWith("--authorization="));
const AUTH = authArg ? authArg.slice("--authorization=".length) : null;
const AUTHORIZATION = "AUTHORIZE_P2GC_VAFSS_GOVERNED_RELEASE";

if (APPLY && LIVE) {
  process.env.MILES_DRY_RUN = "false";
  process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = "true";
}

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const instantly = require("../CONNECTORS/INSTANTLY/instantly");

const ROOT = process.env.MILES_ROOT || process.cwd();
const PLAN = path.join(ROOT,"DATA","OUTBOUND","FEDERAL_VA_FSS_GOVERNED","FEDERAL_VA_FSS_CAMPAIGN_ASSIGNMENT_PLAN.csv");
const READINESS = path.join(ROOT,"DATA","OUTBOUND","FEDERAL_VA_FSS_GOVERNED","FEDERAL_VA_FSS_READINESS_GATE_LATEST.json");
const OUT_DIR = path.join(ROOT,"DATA","OUTBOUND","FEDERAL_VA_FSS_GOVERNED","LIVE_RELEASE");
const MANIFEST = path.join(OUT_DIR,"FEDERAL_VA_FSS_GOVERNED_RELEASE_LATEST.json");
const PROGRESS = path.join(OUT_DIR,"FEDERAL_VA_FSS_GOVERNED_RELEASE_PROGRESS.jsonl");

const ROUTES = [
  { bucket:"VA_NO_SALES", campaignName:"VA No Sales", campaignId:"c9495996-ba29-4611-919e-c083fcd07ee7", activate:false },
  { bucket:"VA_0_TO_500K", campaignName:"VA 0-500k", campaignId:"40576bbf-d5bf-4a25-863d-f9bd246612e8", activate:true },
  { bucket:"VA_501K_TO_LT3M", campaignName:"VA 501k-3m", campaignId:"b8eb01f1-a5d7-4218-b309-2225e2a3035f", activate:true },
  { bucket:"VA_3_TO_LT5M", campaignName:"VA 3-5m", campaignId:"c7adf755-9035-478a-9efc-f69064e927c2", activate:true },
  { bucket:"VA_5M_PLUS", campaignName:"VA 5m+", campaignId:"980f57b2-1836-4b55-8bc1-91cfaeb1fde5", activate:true }
];

function norm(v){ return String(v || "").trim(); }
function lower(v){ return norm(v).toLowerCase(); }
function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function readJson(file){ return JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"")); }
function parseCsv(text){
  const rows=[]; let row=[], field="", quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"' && text[i+1]==='"'){ field+='"'; i++; }
      else if(c==='"') quoted=false;
      else field+=c;
    } else if(c==='"') quoted=true;
    else if(c===','){ row.push(field); field=""; }
    else if(c==='\n'){ row.push(field.replace(/\r$/, "")); rows.push(row); row=[]; field=""; }
    else field+=c;
  }
  if(field || row.length){ row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers=(rows.shift()||[]).map(norm);
  return rows.filter(r=>r.some(v=>norm(v))).map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??""])));
}
function extract(response){
  if(Array.isArray(response)) return {items:response,next:null};
  for(const key of ["items","leads","data","results"]){
    if(Array.isArray(response?.[key])) return {items:response[key],next:response.next_starting_after||response.nextStartingAfter||null};
  }
  throw new Error("Instantly lead response does not contain an array.");
}
async function readCampaignLeads(campaignId){
  const records=[]; const cursors=new Set(); let startingAfter=null;
  for(let page=0;page<1000;page++){
    const response=await instantly.listLeads({campaign:campaignId,limit:100,...(startingAfter?{starting_after:startingAfter}:{})});
    const x=extract(response); records.push(...x.items);
    if(!x.next) return records;
    const cursor=norm(x.next);
    if(cursors.has(cursor)) throw new Error("Repeated Instantly cursor for "+campaignId);
    cursors.add(cursor); startingAfter=cursor;
  }
  throw new Error("Instantly pagination safety limit exceeded for "+campaignId);
}
function liveEmail(record){ return lower(record?.email || record?.lead || record?.contact || record?.email_address); }
function campaignReady(c){
  const senders=Array.isArray(c?.email_list)?c.email_list.length:0;
  const steps=Array.isArray(c?.sequences)?c.sequences.reduce((n,s)=>n+(Array.isArray(s?.steps)?s.steps.length:0),0):0;
  const schedule=Boolean(c?.campaign_schedule && Object.keys(c.campaign_schedule).length);
  const daily=Number(c?.daily_limit || c?.daily_max_leads || 0);
  return {ok:senders>0&&steps>0&&schedule&&daily>0,senders,steps,schedule,daily};
}
function loadProgress(){
  const set=new Set();
  if(!fs.existsSync(PROGRESS)) return set;
  for(const line of fs.readFileSync(PROGRESS,"utf8").split(/\r?\n/).filter(Boolean)){
    const x=JSON.parse(line); if(x.email && x.campaignId) set.add(lower(x.email)+"|"+x.campaignId);
  }
  return set;
}
function appendProgress(x){ fs.mkdirSync(OUT_DIR,{recursive:true}); fs.appendFileSync(PROGRESS,JSON.stringify(x)+"\n","utf8"); }

async function buildPlan(){
  if(!fs.existsSync(PLAN)) throw new Error("VA/FSS assignment plan missing.");
  if(!fs.existsSync(READINESS)) throw new Error("VA/FSS readiness gate missing.");
  const gate=readJson(READINESS);
  if(gate.ok!==true || gate.summary?.campaignsReady!==5 || gate.summary?.campaignsBlocked!==0 || gate.summary?.blockedUnknownRevenue!==262) {
    throw new Error("VA/FSS readiness gate is not in the approved green state.");
  }
  const rows=parseCsv(fs.readFileSync(PLAN,"utf8").replace(/^\uFEFF/,""));
  const byBucket=new Map(ROUTES.map(r=>[r.bucket,r]));
  const source=new Map(ROUTES.map(r=>[r.bucket,new Set()]));
  let blockedUnknownRevenue=0;
  let mappedRows=0;
  let mappedRowsWithoutValidEmail=0;
  for(const row of rows){
    const bucket=norm(row.va_fss_campaign_bucket);
    if(!byBucket.has(bucket)) { if(norm(row.mapping_status)==="BLOCKED_UNKNOWN_REVENUE") blockedUnknownRevenue++; continue; }
    if(norm(row.mapping_status)!=="EXACT_EXISTING_CAMPAIGN") continue;
    mappedRows++;
    const e=lower(row.email);
    if(!validEmail(e)){ mappedRowsWithoutValidEmail++; continue; }
    source.get(bucket).add(e);
  }
  const routes=[];
  for(const route of ROUTES){
    const campaign=await instantly.getCampaign(route.campaignId);
    const readiness=campaignReady(campaign);
    if(!readiness.ok) throw new Error(route.campaignName+" failed live readiness: "+JSON.stringify(readiness));
    const liveRows=await readCampaignLeads(route.campaignId);
    const liveEmails=new Set(liveRows.map(liveEmail).filter(Boolean));
    const governed=[...source.get(route.bucket)];
    const alreadyPresent=governed.filter(e=>liveEmails.has(e));
    const uploadDelta=governed.filter(e=>!liveEmails.has(e));
    routes.push({
      bucket:route.bucket,
      campaignId:route.campaignId,
      campaignName:route.campaignName,
      activateAfterUpload:route.activate,
      currentStatus:campaign.status ?? null,
      governedUniqueEmails:governed.length,
      liveMemberships:liveRows.length,
      alreadyPresent:alreadyPresent.length,
      uploadDelta:uploadDelta.length,
      uploadEmails:uploadDelta,
      readiness
    });
  }
  return {
    blockedUnknownRevenue,
    mappedRows,
    mappedRowsWithoutValidEmail,
    governedUniqueEmails:routes.reduce((n,r)=>n+r.governedUniqueEmails,0),
    totalAlreadyPresent:routes.reduce((n,r)=>n+r.alreadyPresent,0),
    totalUploadDelta:routes.reduce((n,r)=>n+r.uploadDelta,0),
    routes
  };
}

async function main(){
  const plan=await buildPlan();
  const publicRoutes=plan.routes.map(({uploadEmails,...r})=>r);
  if(!APPLY){
    console.log(JSON.stringify({
      ok:true,
      mode:"PLAN_ONLY",
      gate:"FEDERAL_VA_FSS_GOVERNED_RELEASE",
      namespace:"FEDERAL_VA_FSS",
      stateVirginiaSledExcluded:true,
      blockedUnknownRevenue:plan.blockedUnknownRevenue,
      mappedRows:plan.mappedRows,
      mappedRowsWithoutValidEmail:plan.mappedRowsWithoutValidEmail,
      governedUniqueEmails:plan.governedUniqueEmails,
      totalAlreadyPresent:plan.totalAlreadyPresent,
      totalUploadDelta:plan.totalUploadDelta,
      routes:publicRoutes,
      providerWritesAuthorized:false,
      campaignsActivated:false
    },null,2));
    return;
  }
  if(!LIVE) throw new Error("--live is required.");
  if(AUTH!==AUTHORIZATION) throw new Error("Exact VA/FSS release authorization is required.");
  const cfg=instantly.getConfiguration();
  if(cfg.liveMutationsEnabled!==true) throw new Error("Instantly live mutations are not enabled for this process.");

  const progress=loadProgress();
  let uploadedThisRun=0;
  const byRoute={};
  for(const route of plan.routes){
    let uploaded=0;
    for(const e of route.uploadEmails){
      const key=e+"|"+route.campaignId;
      if(progress.has(key)) continue;
      const result=await instantly.createLead({email:e,campaign:route.campaignId});
      if(!result || result.dryRun===true || result.mutationExecuted===false) throw new Error("Lead creation not confirmed for "+e+" -> "+route.campaignName);
      appendProgress({email:e,bucket:route.bucket,campaignId:route.campaignId,campaignName:route.campaignName,uploadedAt:new Date().toISOString(),providerLeadId:result.id||result.lead_id||result.uuid||null});
      progress.add(key); uploaded++; uploadedThisRun++;
    }
    byRoute[route.bucket]={plannedDelta:route.uploadDelta,uploadedThisRun:uploaded};
  }

  const activated=[];
  for(const route of plan.routes.filter(r=>r.activateAfterUpload)){
    const afterRows=await readCampaignLeads(route.campaignId);
    const afterEmails=new Set(afterRows.map(liveEmail).filter(Boolean));
    const governed=route.uploadEmails.length + route.alreadyPresent;
    const sourceRows=parseCsv(fs.readFileSync(PLAN,"utf8").replace(/^\uFEFF/,""));
    const expected=new Set(sourceRows.filter(row=>norm(row.va_fss_campaign_bucket)===route.bucket && norm(row.mapping_status)==="EXACT_EXISTING_CAMPAIGN").map(row=>lower(row.email)).filter(validEmail));
    const missing=[...expected].filter(e=>!afterEmails.has(e));
    if(missing.length) throw new Error(route.campaignName+" still missing "+missing.length+" governed emails after upload; refusing activation.");
    const result=await instantly.activateCampaign(route.campaignId);
    if(!result || result.dryRun===true || result.mutationExecuted===false) throw new Error("Activation not confirmed for "+route.campaignName);
    activated.push(route.campaignName);
  }

  const report={
    ok:true,
    gate:"FEDERAL_VA_FSS_GOVERNED_RELEASE_LIVE",
    generatedAt:new Date().toISOString(),
    authorization:AUTHORIZATION,
    namespace:"FEDERAL_VA_FSS",
    stateVirginiaSledExcluded:true,
    summary:{
      blockedUnknownRevenue:plan.blockedUnknownRevenue,
      mappedRows:plan.mappedRows,
      mappedRowsWithoutValidEmail:plan.mappedRowsWithoutValidEmail,
      governedUniqueEmails:plan.governedUniqueEmails,
      plannedDelta:plan.totalUploadDelta,
      uploadedThisRun,
      byRoute,
      activatedCampaigns:activated
    },
    providerWritesAuthorized:true,
    providerWriteScope:"CREATE_ONLY_MISSING_GOVERNED_VA_FSS_LEADS_AND_ACTIVATE_FOUR_READY_DRAFT_VA_CAMPAIGNS",
    campaignsDeleted:false,
    VirginiaSledTouched:false,
    unresolvedRevenueActivated:false,
    nextAction:"RUN_VA_FSS_READINESS_AND_READ_ONLY_RECONCILIATION"
  };
  fs.mkdirSync(OUT_DIR,{recursive:true});
  fs.writeFileSync(MANIFEST,JSON.stringify(report,null,2),"utf8");
  console.log(JSON.stringify(report,null,2));
}

main().catch(err=>{ console.error(err.stack||err); process.exitCode=1; });
