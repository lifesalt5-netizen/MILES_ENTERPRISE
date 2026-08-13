"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const ROOT = process.env.MILES_ROOT || process.cwd();
const PLAN = path.join(
  ROOT,
  "DATA","OUTBOUND","CAPACITY_RECLAMATION",
  "SBS_RECLAIM_PLAN_1000.csv"
);
const OUTDIR = path.join(
  ROOT,
  "DATA","OUTBOUND","CAPACITY_RECLAMATION"
);
const REPORT = path.join(
  OUTDIR,
  "SBS_RECLAIM_DELETE_GATE_LATEST.json"
);

const CAMPAIGN_ID = "d032b6e9-57fa-46f7-b603-b9015e0e8d55";
const CAMPAIGN_NAME = "SBS Verified Email Targets";
const REQUIRED_COUNT = 1000;
const REQUIRED_AUTH = "AUTHORIZE_P2GC_SBS_RECLAIM_1000";
const BASE_URL = process.env.INSTANTLY_BASE_URL || "https://api.instantly.ai/api/v2";
const API_KEY = process.env.INSTANTLY_API_KEY || "";

function norm(v){ return String(v || "").trim(); }
function lower(v){ return norm(v).toLowerCase(); }
function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

function parseCsv(text){
  const rows=[]; let row=[],field="",quoted=false;
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
  return rows.filter(r=>r.some(v=>norm(v))).map(values=>
    Object.fromEntries(headers.map((h,i)=>[h,values[i]??""]))
  );
}

function authHeaders(){
  if(!API_KEY) throw new Error("INSTANTLY_API_KEY is not configured.");
  return {
    Authorization:`Bearer ${API_KEY}`,
    Accept:"application/json",
    "Content-Type":"application/json"
  };
}

async function getLead(id){
  const r = await axios.get(
    `${BASE_URL}/leads/${encodeURIComponent(id)}`,
    { headers:authHeaders(), timeout:15000, validateStatus:s=>s>=200&&s<300 }
  );
  return r.data;
}

async function deleteLead(id){
  const r = await axios.delete(
    `${BASE_URL}/leads/${encodeURIComponent(id)}`,
    { headers:authHeaders(), timeout:15000, validateStatus:s=>s>=200&&s<300 }
  );
  return r.data;
}

function engaged(l){
  const replied =
    Number(l?.email_reply_count || 0) > 0 ||
    Boolean(l?.timestamp_last_reply) ||
    (l?.email_replied_step !== null && l?.email_replied_step !== undefined);

  const classified =
    l?.lt_interest_status !== null &&
    l?.lt_interest_status !== undefined &&
    l?.lt_interest_status !== "";

  const unsubscribed = Number(l?.status) === -2;

  return replied || classified || unsubscribed;
}

async function main(){
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const live = args.includes("--live");
  const authArg = args.find(x=>x.startsWith("--authorization="));
  const authorization = authArg ? authArg.split("=").slice(1).join("=") : "";

  if(!fs.existsSync(PLAN)) throw new Error(`Missing reclaim plan: ${PLAN}`);

  const rows = parseCsv(fs.readFileSync(PLAN,"utf8").replace(/^\uFEFF/,""));
  if(rows.length !== REQUIRED_COUNT) throw new Error(`Plan must contain exactly ${REQUIRED_COUNT} rows; found ${rows.length}.`);

  const ids = new Set();
  const emails = new Set();
  for(const r of rows){
    const id = norm(r.id);
    const email = lower(r.email);
    if(!id) throw new Error("Plan contains a row with no lead ID.");
    if(!validEmail(email)) throw new Error(`Plan contains invalid email for lead ${id}.`);
    if(norm(r.campaignId) !== CAMPAIGN_ID) throw new Error(`Plan contains non-SBS campaign ID for ${email}.`);
    if(ids.has(id)) throw new Error(`Duplicate lead ID in plan: ${id}`);
    if(emails.has(email)) throw new Error(`Duplicate email in plan: ${email}`);
    ids.add(id); emails.add(email);
  }

  const baseReport = {
    ok:true,
    gate:"SBS_CAPACITY_RECLAIM_DELETE_GATE",
    generatedAt:new Date().toISOString(),
    campaign:{id:CAMPAIGN_ID,name:CAMPAIGN_NAME},
    planned:rows.length,
    requiredAuthorization:REQUIRED_AUTH,
    mode:apply&&live?"LIVE":"PLAN_ONLY",
    deletesExecuted:false,
    deleted:0,
    blocked:0,
    safety:{
      exactPlanOnly:true,
      exactCountRequired:REQUIRED_COUNT,
      campaignLockedToSbs:true,
      liveLeadRevalidationRequired:true,
      repliedLeadsBlocked:true,
      classifiedLeadsBlocked:true,
      unsubscribedLeadsBlocked:true,
      otherCampaignsUntouched:true,
      expirationCampaignsUntouched:true,
      vaFssCampaignsUntouched:true,
      stateSledUntouched:true
    }
  };

  if(!apply || !live){
    fs.mkdirSync(OUTDIR,{recursive:true});
    fs.writeFileSync(REPORT,JSON.stringify(baseReport,null,2),"utf8");
    console.log(JSON.stringify(baseReport,null,2));
    return;
  }

  if(authorization !== REQUIRED_AUTH){
    throw new Error("Exact SBS reclaim authorization is required.");
  }

  const validated=[];
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    const current=await getLead(norm(r.id));
    const currentEmail=lower(current?.email || current?.contact);
    if(norm(current?.campaign) !== CAMPAIGN_ID) throw new Error(`Lead moved to another campaign: ${r.id}`);
    if(currentEmail !== lower(r.email)) throw new Error(`Lead/email mismatch for ${r.id}`);
    if(engaged(current)) throw new Error(`Protected lead became engaged after plan creation: ${currentEmail}`);
    validated.push({id:norm(r.id),email:currentEmail});
    if((i+1)%100===0) console.log(`Validated ${i+1}/${rows.length}`);
  }

  let deleted=0;
  const failures=[];
  for(let i=0;i<validated.length;i++){
    const r=validated[i];
    try{
      await deleteLead(r.id);
      deleted++;
    }catch(err){
      failures.push({id:r.id,email:r.email,error:err?.response?.data||err.message});
      break;
    }
    if((i+1)%100===0) console.log(`Deleted ${i+1}/${validated.length}`);
  }

  const report={
    ...baseReport,
    ok:deleted===REQUIRED_COUNT && failures.length===0,
    mode:"LIVE",
    deletesExecuted:deleted>0,
    deleted,
    blocked:failures.length,
    failures,
    nextAction:deleted===REQUIRED_COUNT && failures.length===0
      ? "VERIFY_INSTANTLY_CAPACITY_THEN_RESUME_VA_FSS_RELEASE"
      : "STOP_AND_RECONCILE_PARTIAL_RECLAIM_BEFORE_ANY_RETRY"
  };

  fs.mkdirSync(OUTDIR,{recursive:true});
  fs.writeFileSync(REPORT,JSON.stringify(report,null,2),"utf8");
  console.log(JSON.stringify(report,null,2));

  if(!report.ok) process.exitCode=1;
}

main().catch(err=>{
  console.error(err.stack||err);
  process.exitCode=1;
});
