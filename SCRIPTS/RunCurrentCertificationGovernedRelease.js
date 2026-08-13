"use strict";

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const LIVE = argv.includes("--live");
const AUTH = (argv.find(v => v.startsWith("--authorization=")) || "").slice("--authorization=".length);
const REQUIRED_AUTH = "AUTHORIZE_P2GC_CERTIFICATION_DELTA_RELEASE_372";

if (APPLY && LIVE) {
  process.env.MILES_DRY_RUN = "false";
  process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = "true";
}

require("dotenv").config();
const instantly = require("../CONNECTORS/INSTANTLY/instantly");

const ROOT = process.env.MILES_ROOT || process.cwd();
const MASTER = path.join(ROOT,"DATA","OUTBOUND","GOVERNED_LEAD_REPOSITORY","MASTER_GOVERNED_VERIFIED_ROUTING.csv");
const FINAL_GATE = path.join(ROOT,"DATA","OUTBOUND","PRODUCTION_FINISH","P2GC_AUTONOMOUS_COO_FINAL_GATE.json");
const OUT_DIR = path.join(ROOT,"DATA","OUTBOUND","PRODUCTION_FINISH","CERTIFICATION_RELEASE");
const PROGRESS = path.join(OUT_DIR,"CERTIFICATION_DELTA_PROGRESS.jsonl");
const MANIFEST = path.join(OUT_DIR,"CERTIFICATION_DELTA_MANIFEST.json");

const ROUTES = [
  ["SETASIDE_8A","671bc274-ecc7-48eb-a693-f3a771af010e","8a firms"],
  ["SETASIDE_HUBZONE","f33f2df4-6235-4daa-9945-2832afedbb49","HubZone"],
  ["SETASIDE_SDVOSB","3f32c0c7-83dc-4726-800a-900c5bb15b8e","SDVOSB"],
  ["SETASIDE_VOSB","a9b11a37-62f4-4854-843a-a09fda27eb06","VOSB"],
  ["SETASIDE_WOSB","c3922868-37da-4e99-838a-9d0289ff475f","WOSB"]
];

function norm(v){ return String(v||"").trim(); }
function email(v){ return norm(v).toLowerCase(); }
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

function hasSegment(row, segment){ return Object.values(row).some(v=>norm(v).toUpperCase()===segment); }
function rowEmail(row){
  for(const value of Object.values(row)){
    const e=email(value); if(validEmail(e)) return e;
  }
  return "";
}
function extract(response){
  if(Array.isArray(response)) return {items:response,next:null};
  for(const key of ["items","leads","data","results"]){
    if(Array.isArray(response?.[key])) return {items:response[key],next:response.next_starting_after||response.nextStartingAfter||null};
  }
  throw new Error("Instantly lead response does not contain an array.");
}
async function readCampaign(campaignId){
  const records=[]; const cursors=new Set(); let startingAfter=null;
  for(let page=0;page<1000;page++){
    const response=await instantly.listLeads({campaign:campaignId,limit:100,...(startingAfter?{starting_after:startingAfter}:{})});
    const x=extract(response); records.push(...x.items);
    if(!x.next) return records;
    const cursor=norm(x.next);
    if(cursors.has(cursor)) throw new Error("Repeated Instantly cursor.");
    cursors.add(cursor); startingAfter=cursor;
  }
  throw new Error("Pagination safety limit exceeded.");
}
function loadProgress(){
  if(!fs.existsSync(PROGRESS)) return new Set();
  const set=new Set();
  for(const line of fs.readFileSync(PROGRESS,"utf8").split(/\r?\n/).filter(Boolean)){
    const x=JSON.parse(line); if(x.email) set.add(email(x.email));
  }
  return set;
}
function appendProgress(item){ fs.mkdirSync(OUT_DIR,{recursive:true}); fs.appendFileSync(PROGRESS,JSON.stringify(item)+"\n","utf8"); }

async function main(){
  if(!fs.existsSync(FINAL_GATE)) throw new Error("Final readiness gate evidence missing.");
  const gate=readJson(FINAL_GATE);
  if(gate.ok!==true || gate.decision!=="READY_FOR_CONTROLLED_WRITE_ENABLEMENT" || (gate.failedChecks||[]).length) throw new Error("Final readiness gate is not green.");
  if(!fs.existsSync(MASTER)) throw new Error("Governed master missing.");

  const rows=parseCsv(fs.readFileSync(MASTER,"utf8").replace(/^\uFEFF/,""));
  const plan=[];
  let totalDelta=0;

  for(const [segment,campaignId,campaignName] of ROUTES){
    const governed=new Set();
    for(const row of rows){ if(hasSegment(row,segment)){ const e=rowEmail(row); if(e) governed.add(e); } }
    const liveRows=await readCampaign(campaignId);
    const liveEmails=new Set(liveRows.map(r=>email(r.email||r.lead||r.contact||r.email_address)).filter(Boolean));
    const delta=[...governed].filter(e=>!liveEmails.has(e));
    totalDelta+=delta.length;
    plan.push({segment,campaignId,campaignName,governed:governed.size,liveMemberships:liveRows.length,alreadyPresent:governed.size-delta.length,uploadDelta:delta.length,emails:delta});
  }

  if(!APPLY){
    console.log(JSON.stringify({ok:true,mode:"PLAN_ONLY",gate:"CURRENT_CERTIFICATION_GOVERNED_RELEASE",totalUploadDelta:totalDelta,routes:plan.map(x=>({...x,emails:undefined})),providerWritesAuthorized:false,campaignsChanged:false,campaignsActivated:false},null,2));
    return;
  }

  if(!LIVE) throw new Error("--live is required.");
  if(AUTH!==REQUIRED_AUTH) throw new Error("Exact certification release authorization is required.");
  const cfg=instantly.getConfiguration();
  if(cfg.liveMutationsEnabled!==true) throw new Error("Instantly live mutations are not enabled for this process.");

  const progress=loadProgress();
  let uploadedThisRun=0;
  const byRoute={};

  for(const route of plan){
    let uploadedRoute=0;
    for(const e of route.emails){
      if(progress.has(e)) continue;
      const result=await instantly.createLead({email:e,campaign:route.campaignId});
      if(!result || result.dryRun===true || result.mutationExecuted===false) throw new Error("Lead creation not confirmed for "+e);
      appendProgress({email:e,segment:route.segment,campaignId:route.campaignId,campaignName:route.campaignName,uploadedAt:new Date().toISOString(),providerLeadId:result.id||result.lead_id||result.uuid||null});
      progress.add(e); uploadedThisRun++; uploadedRoute++;
    }
    byRoute[route.segment]={plannedDelta:route.uploadDelta,uploadedThisRun:uploadedRoute};
  }

  const report={
    ok:true,
    gate:"CURRENT_CERTIFICATION_GOVERNED_RELEASE_LIVE",
    generatedAt:new Date().toISOString(),
    authorization:REQUIRED_AUTH,
    summary:{plannedDelta:totalDelta,uploadedThisRun,byRoute},
    providerWritesAuthorized:true,
    providerWriteScope:"CREATE_ONLY_MISSING_GOVERNED_CERTIFICATION_LEADS",
    campaignsChanged:false,
    campaignsActivated:false,
    campaignsDeleted:false,
    VirginiaSledTouched:false,
    protectedPathways2gcInboxTouched:false,
    note:"Target campaigns are already ACTIVE; newly created leads may send under their existing schedules.",
    nextAction:"RUN_READ_ONLY_RECONCILIATION_AND_CURRENT_DUPLICATE_AUDIT"
  };
  fs.mkdirSync(OUT_DIR,{recursive:true});
  fs.writeFileSync(MANIFEST,JSON.stringify(report,null,2),"utf8");
  console.log(JSON.stringify(report,null,2));
}

main().catch(err=>{ console.error(err.stack||err); process.exitCode=1; });
