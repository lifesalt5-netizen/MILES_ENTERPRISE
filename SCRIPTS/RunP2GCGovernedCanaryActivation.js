"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

const AUTHORIZATION = "AUTHORIZE_P2GC_EDWOSB_CANARY_10";
const CAMPAIGN_ID = "39286fa1-1da5-46d6-9e85-83bb8b1ffabb";
const CAMPAIGN_NAME = "EDWOSB";
const LIMIT = 10;
const EXACT_SEGMENT = "SETASIDE_EDWOSB";

const governedMaster = path.join(ROOT,"DATA","OUTBOUND","GOVERNED_LEAD_REPOSITORY","MASTER_GOVERNED_VERIFIED_ROUTING.csv");
const finalGate = path.join(ROOT,"DATA","OUTBOUND","PRODUCTION_FINISH","P2GC_AUTONOMOUS_COO_FINAL_GATE.json");
const outDir = path.join(ROOT,"DATA","OUTBOUND","PRODUCTION_FINISH","CANARY");
const progressFile = path.join(outDir,"EDWOSB_CANARY_PROGRESS.jsonl");
const manifestFile = path.join(outDir,"EDWOSB_CANARY_MANIFEST.json");

function parseArgs(argv){
  const auth = argv.find(v=>v.startsWith("--authorization="));
  return { apply: argv.includes("--apply"), live: argv.includes("--live"), authorization: auth ? auth.slice("--authorization=".length) : null };
}
function readJson(file){ return JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"")); }
function norm(v){ return String(v||"").trim(); }
function email(v){ return norm(v).toLowerCase(); }
function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
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
  const headers=(rows.shift()||[]).map(h=>norm(h));
  return rows.filter(r=>r.some(v=>norm(v))).map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??""])));
}
function rowHasExactSegment(row){
  return Object.values(row).some(value => norm(value).toUpperCase() === EXACT_SEGMENT);
}
function emailFromRow(row){
  const preferred = ["email","Email","verified_email","Verified_Email","contact_email","Contact_Email","email_address","Email_Address"];
  for(const key of preferred){
    if(Object.prototype.hasOwnProperty.call(row,key)){
      const candidate=email(row[key]);
      if(validEmail(candidate)) return candidate;
    }
  }
  for(const value of Object.values(row)){
    const candidate=email(value);
    if(validEmail(candidate)) return candidate;
  }
  return "";
}
function campaignReady(c){
  const senders=Array.isArray(c?.email_list)?c.email_list.length:0;
  const steps=Array.isArray(c?.sequences)?c.sequences.reduce((n,s)=>n+(Array.isArray(s?.steps)?s.steps.length:0),0):0;
  const schedule=Boolean(c?.campaign_schedule && Object.keys(c.campaign_schedule).length);
  const daily=Number(c?.daily_limit||c?.daily_max_leads||0);
  return { ok: senders>0 && steps>0 && schedule && daily>0, senders, steps, schedule, daily };
}
function loadProgress(){
  if(!fs.existsSync(progressFile)) return new Map();
  const map=new Map();
  for(const line of fs.readFileSync(progressFile,"utf8").split(/\r?\n/).filter(Boolean)){
    const x=JSON.parse(line); map.set(email(x.email),x);
  }
  return map;
}
function appendProgress(x){ fs.mkdirSync(outDir,{recursive:true}); fs.appendFileSync(progressFile,JSON.stringify(x)+"\n","utf8"); }

async function main(){
  const input=parseArgs(process.argv.slice(2));

  if(input.apply && input.live){
    process.env.MILES_DRY_RUN="false";
    process.env.MILES_ALLOW_INSTANTLY_MUTATIONS="true";
  }

  // Load Instantly only after live flags are set so connector configuration is evaluated correctly.
  const instantly = require("../CONNECTORS/INSTANTLY/instantly");

  if(!fs.existsSync(finalGate)) throw new Error("Final readiness gate evidence is missing.");
  const gate=readJson(finalGate);
  if(gate.ok!==true || gate.decision!=="READY_FOR_CONTROLLED_WRITE_ENABLEMENT" || (gate.failedChecks||[]).length!==0) throw new Error("Final readiness gate is not green.");
  if(!fs.existsSync(governedMaster)) throw new Error("Governed master is missing.");

  const rows=parseCsv(fs.readFileSync(governedMaster,"utf8").replace(/^\uFEFF/,""));
  const candidates=[]; const seen=new Set();
  let exactSegmentRows=0;
  for(const row of rows){
    if(!rowHasExactSegment(row)) continue;
    exactSegmentRows++;
    const e=emailFromRow(row);
    if(!e || seen.has(e)) continue;
    seen.add(e); candidates.push({email:e});
  }
  if(candidates.length < LIMIT) throw new Error(`Need at least ${LIMIT} governed ${EXACT_SEGMENT} emails; exactSegmentRows=${exactSegmentRows}, validUniqueEmails=${candidates.length}.`);
  const selected=candidates.slice(0,LIMIT);

  const campaign=await instantly.getCampaign(CAMPAIGN_ID);
  const readiness=campaignReady(campaign);
  if(!readiness.ok) throw new Error("EDWOSB campaign is not ready: "+JSON.stringify(readiness));

  if(!input.apply){
    console.log(JSON.stringify({ok:true,mode:"PLAN_ONLY",gate:"P2GC_EDWOSB_CANARY",segment:EXACT_SEGMENT,campaignId:CAMPAIGN_ID,campaignName:CAMPAIGN_NAME,exactSegmentRows,governedCandidates:candidates.length,selected:LIMIT,readiness,providerWritesAuthorized:false,emailsSent:false,campaignActivated:false},null,2));
    return;
  }
  if(!input.live) throw new Error("--live is required.");
  if(input.authorization!==AUTHORIZATION) throw new Error("Exact canary authorization is required.");
  const cfg=instantly.getConfiguration();
  if(cfg.liveMutationsEnabled!==true) throw new Error("Instantly live mutations are not enabled for this process.");

  const progress=loadProgress(); let uploadedThisRun=0;
  for(const row of selected){
    if(progress.has(row.email)) continue;
    const result=await instantly.createLead({email:row.email,campaign:CAMPAIGN_ID});
    if(!result || result.dryRun===true || result.mutationExecuted===false) throw new Error("Lead creation not confirmed for "+row.email);
    const item={email:row.email,segment:EXACT_SEGMENT,campaignId:CAMPAIGN_ID,campaignName:CAMPAIGN_NAME,uploadedAt:new Date().toISOString(),providerLeadId:result.id||result.lead_id||result.uuid||null};
    appendProgress(item); progress.set(row.email,item); uploadedThisRun++;
  }
  const completed=selected.filter(r=>progress.has(r.email)).length;
  if(completed!==LIMIT) throw new Error(`Canary upload incomplete: ${completed}/${LIMIT}.`);

  const activated=await instantly.activateCampaign(CAMPAIGN_ID);
  if(!activated || activated.dryRun===true || activated.mutationExecuted===false) throw new Error("Campaign activation was not confirmed.");

  const report={
    ok:true,
    gate:"P2GC_EDWOSB_CANARY_LIVE",
    generatedAt:new Date().toISOString(),
    authorization:AUTHORIZATION,
    segment:EXACT_SEGMENT,
    campaign:{id:CAMPAIGN_ID,name:CAMPAIGN_NAME},
    summary:{exactSegmentRows,governedCandidates:candidates.length,selected:LIMIT,uploaded:completed,uploadedThisRun},
    readiness,
    providerWritesAuthorized:true,
    providerWriteScope:"CREATE_10_GOVERNED_EDWOSB_LEADS_AND_ACTIVATE_EDWOSB_ONLY",
    campaignActivated:true,
    campaignsDeleted:false,
    VirginiaSledTouched:false,
    protectedPathways2gcInboxTouched:false,
    nextAction:"VERIFY_CANARY_THEN_RELEASE_GOVERNED_BATCHES"
  };
  fs.mkdirSync(outDir,{recursive:true}); fs.writeFileSync(manifestFile,JSON.stringify(report,null,2),"utf8");
  console.log(JSON.stringify(report,null,2));
}

if(require.main===module){
  main().catch(err=>{ console.error(err.stack||err); process.exitCode=1; });
}
