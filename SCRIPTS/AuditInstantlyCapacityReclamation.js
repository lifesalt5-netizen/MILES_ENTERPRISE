"use strict";

process.env.MILES_DRY_RUN = "true";
process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = "false";
process.env.MILES_CONTROLLED_WRITE_ENABLED = "false";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const instantly = require("../CONNECTORS/INSTANTLY/instantly");

const ROOT = process.env.MILES_ROOT || process.cwd();
const OUT_DIR = path.join(ROOT,"DATA","OUTBOUND","CAPACITY_RECLAMATION");
const MASTER = path.join(ROOT,"DATA","OUTBOUND","GOVERNED_LEAD_REPOSITORY","MASTER_GOVERNED_VERIFIED_ROUTING.csv");
const VA_PLAN = path.join(ROOT,"DATA","OUTBOUND","FEDERAL_VA_FSS_GOVERNED","FEDERAL_VA_FSS_CAMPAIGN_ASSIGNMENT_PLAN.csv");
const RECON = path.join(ROOT,"DATA","OUTBOUND","INSTANTLY_MASTER_RECONCILIATION","MASTER_INSTANTLY_RECONCILIATION_LATEST.json");
const JSON_OUT = path.join(OUT_DIR,"INSTANTLY_CAPACITY_RECLAMATION_AUDIT_LATEST.json");
const CSV_OUT = path.join(OUT_DIR,"INSTANTLY_CAPACITY_RECLAMATION_CANDIDATES_LATEST.csv");

const PROTECTED_FAMILIES = new Set([
  "SUPPRESSION",
  "NURTURE",
  "PIPELINE",
  "MEETING_PIPELINE",
  "STATE_SLED"
]);

function norm(v){ return String(v || "").trim(); }
function lower(v){ return norm(v).toLowerCase(); }
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
function leadId(record){ return norm(record?.id || record?.lead_id || record?.uuid || record?._id); }
async function readCampaignLeads(campaignId){
  const records=[]; const cursors=new Set(); let startingAfter=null;
  for(let page=0;page<1000;page++){
    const response=await instantly.listLeads({campaign:campaignId,limit:100,...(startingAfter?{starting_after:startingAfter}:{})});
    const x=extract(response); records.push(...x.items);
    if(!x.next) return records;
    let cursor=norm(x.next);
    // Instantly v2 requires starting_after to be a lead ID when distinct_contacts=false.
    // Some responses return a non-ID cursor token; in that case use the last lead ID from the page.
    const lastId=leadId(x.items[x.items.length-1]);
    if(lastId) cursor=lastId;
    if(!cursor) return records;
    if(cursors.has(cursor)) throw new Error("Repeated Instantly cursor for "+campaignId);
    cursors.add(cursor); startingAfter=cursor;
  }
  throw new Error("Instantly pagination safety limit exceeded for "+campaignId);
}
function liveEmail(r){ return lower(r?.email || r?.lead || r?.contact || r?.email_address); }
function collectEmailsFromRows(rows){
  const out=new Set();
  for(const row of rows){
    for(const value of Object.values(row)){
      const e=lower(value);
      if(validEmail(e)) out.add(e);
    }
  }
  return out;
}
function esc(v){ const s=String(v??""); return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
function writeCsv(file,rows,headers){
  const lines=[headers.join(',')];
  for(const r of rows) lines.push(headers.map(h=>esc(r[h])).join(','));
  fs.writeFileSync(file,lines.join('\n'),'utf8');
}

async function main(){
  for(const f of [MASTER,VA_PLAN,RECON]) if(!fs.existsSync(f)) throw new Error("Missing required file: "+f);

  const governedRows=parseCsv(fs.readFileSync(MASTER,"utf8").replace(/^\uFEFF/,""));
  const vaRows=parseCsv(fs.readFileSync(VA_PLAN,"utf8").replace(/^\uFEFF/,""));
  const recon=JSON.parse(fs.readFileSync(RECON,"utf8").replace(/^\uFEFF/,""));
  const governedEmails=collectEmailsFromRows(governedRows);
  const vaEmails=new Set(vaRows.filter(r=>norm(r.mapping_status)==="EXACT_EXISTING_CAMPAIGN").map(r=>lower(r.email)).filter(validEmail));
  const protectedEmails=new Set([...governedEmails,...vaEmails]);

  const campaigns=Array.isArray(recon.campaigns)?recon.campaigns:[];
  const details=[];
  const candidates=[];

  for(const c of campaigns){
    const campaignId=c.campaignId||c.id;
    const family=norm(c.family).toUpperCase();
    const campaignName=norm(c.campaignName);
    const replies=Number(c.replies||0);
    const familyProtected=PROTECTED_FAMILIES.has(family);
    const campaignReplyProtected=replies>0;
    const liveRows=await readCampaignLeads(campaignId);
    const liveEmails=[...new Set(liveRows.map(liveEmail).filter(validEmail))];
    let protectedCount=0, reclaimableCount=0;

    for(const e of liveEmails){
      const isProtectedEmail=protectedEmails.has(e);
      const protectedByPolicy=isProtectedEmail || familyProtected || campaignReplyProtected;
      if(protectedByPolicy){ protectedCount++; continue; }
      reclaimableCount++;
      candidates.push({
        email:e,
        campaignId,
        campaignName,
        family,
        campaignStatus:c.statusLabel||c.status||"",
        campaignReplies:replies,
        reason:"NOT_IN_GOVERNED_MASTER_OR_VA_PLAN_AND_NO_CAMPAIGN_REPLY_PROTECTION",
        action:"RECLAIM_CANDIDATE_AFTER_EXPORT_AND_MANUAL_APPROVAL"
      });
    }

    details.push({
      campaignId,
      campaignName,
      family,
      statusLabel:c.statusLabel||c.status||"",
      liveMemberships:liveRows.length,
      uniqueLiveEmails:liveEmails.length,
      protectedCount,
      reclaimableCount,
      familyProtected,
      campaignReplyProtected,
      replies
    });
  }

  details.sort((a,b)=>b.reclaimableCount-a.reclaimableCount);
  const report={
    ok:true,
    gate:"INSTANTLY_CAPACITY_RECLAMATION_AUDIT_READ_ONLY",
    generatedAt:new Date().toISOString(),
    currentPlanContactLimit:25000,
    remainingVaFssUploadNeed:837,
    governedEmailProtectionCount:governedEmails.size,
    vaPlanEmailProtectionCount:vaEmails.size,
    protectedFamilies:[...PROTECTED_FAMILIES],
    totals:{
      campaignsReviewed:details.length,
      campaignMembershipsObserved:details.reduce((n,x)=>n+x.liveMemberships,0),
      reclaimableMembershipCandidates:candidates.length,
      campaignsWithReclaimableCandidates:details.filter(x=>x.reclaimableCount>0).length
    },
    topReclamationCampaigns:details.filter(x=>x.reclaimableCount>0).slice(0,20),
    safety:{
      readOnly:true,
      deletes:false,
      campaignMutations:false,
      uploads:false,
      activations:false,
      governedEmailsProtected:true,
      vaFssPlannedEmailsProtected:true,
      replyBearingCampaignsProtected:true,
      stateSledProtected:true,
      suppressionProtected:true,
      nurtureProtected:true,
      pipelineProtected:true
    },
    decision:candidates.length>=1500?"ENOUGH_CANDIDATES_TO_RECLAIM_1500_AFTER_REVIEW":candidates.length>=837?"ENOUGH_CANDIDATES_TO_FINISH_VA_FSS_AFTER_REVIEW":"NOT_ENOUGH_SAFE_CANDIDATES_IDENTIFIED",
    nextAction:"REVIEW_TOP_RECLAMATION_CAMPAIGNS_THEN_BUILD_EXPLICIT_DELETE_GATE",
    outputCsv:CSV_OUT
  };

  fs.mkdirSync(OUT_DIR,{recursive:true});
  writeCsv(CSV_OUT,candidates,["email","campaignId","campaignName","family","campaignStatus","campaignReplies","reason","action"]);
  fs.writeFileSync(JSON_OUT,JSON.stringify(report,null,2),"utf8");
  console.log(JSON.stringify(report,null,2));
}

main().catch(err=>{ console.error(err.stack||err); process.exitCode=1; });
