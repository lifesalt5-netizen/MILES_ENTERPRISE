"use strict";

process.env.MILES_DRY_RUN="true";
process.env.MILES_ALLOW_INSTANTLY_MUTATIONS="false";

require("dotenv").config();

const fs=require("fs");
const path=require("path");
const instantly=require("../CONNECTORS/INSTANTLY/instantly");

const ROOT=process.cwd();

const MASTER=path.join(
  ROOT,"DATA","OUTBOUND","GOVERNED_LEAD_REPOSITORY",
  "MASTER_GOVERNED_VERIFIED_ROUTING.csv"
);

const VA=path.join(
  ROOT,"DATA","OUTBOUND","FEDERAL_VA_FSS_GOVERNED",
  "FEDERAL_VA_FSS_CAMPAIGN_ASSIGNMENT_PLAN.csv"
);

const TARGETS=[
  ["d032b6e9-57fa-46f7-b603-b9015e0e8d55","SBS Verified Email Targets"],
  ["4238bbff-6571-4a54-91f4-f7574eeb96ec","GSA No Sales"],
  ["3b178b26-4449-4217-9369-946ad9542ac2","P2GC - HIGH VALUE (copy) (copy)"]
];

function norm(v){return String(v||"").trim();}
function lower(v){return norm(v).toLowerCase();}
function valid(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}

function parseCsv(text){
  const rows=[]; let row=[],field="",q=false;

  for(let i=0;i<text.length;i++){
    const c=text[i];

    if(q){
      if(c=='"'&&text[i+1]=='"'){field+='"';i++;}
      else if(c=='"')q=false;
      else field+=c;
    }else if(c=='"')q=true;
    else if(c==','){row.push(field);field="";}
    else if(c=='\n'){
      row.push(field.replace(/\r$/,""));
      rows.push(row);row=[];field="";
    }else field+=c;
  }

  if(field||row.length)rows.push([...row,field]);

  const h=(rows.shift()||[]).map(norm);

  return rows
    .filter(r=>r.some(x=>norm(x)))
    .map(r=>Object.fromEntries(
      h.map((x,i)=>[x,r[i]||""])
    ));
}

function emailsFrom(rows){
  const s=new Set();

  for(const r of rows){
    for(const v of Object.values(r)){
      const e=lower(v);
      if(valid(e))s.add(e);
    }
  }

  return s;
}

async function getLeads(campaign){
  let after=null;
  const all=[];
  const seen=new Set();

  for(let page=0;page<1000;page++){

    const r=await instantly.listLeads({
      campaign,
      limit:100,
      distinct_contacts:true,
      ...(after?{starting_after:after}:{})
    });

    const items=r.items||r.data||r.leads||[];

    all.push(...items);

    const next=r.next_starting_after||r.nextStartingAfter;

    if(!next)break;

    const last=lower(
      items[items.length-1]?.email ||
      items[items.length-1]?.contact
    );

    after=last||next;

    if(seen.has(after))break;
    seen.add(after);
  }

  return all;
}

(async()=>{

  const governed=emailsFrom(
    parseCsv(fs.readFileSync(MASTER,"utf8").replace(/^\uFEFF/,""))
  );

  const vaRows=parseCsv(
    fs.readFileSync(VA,"utf8").replace(/^\uFEFF/,"")
  );

  for(const r of vaRows){
    const e=lower(r.email);
    if(valid(e))governed.add(e);
  }

  let total=0;
  const results=[];

  for(const [id,name] of TARGETS){

    const leads=await getLeads(id);

    let reclaimable=0;
    let protectedGoverned=0;
    let protectedEngaged=0;

    for(const l of leads){

      const email=lower(l.email||l.contact);

      if(!valid(email))continue;

      if(governed.has(email)){
        protectedGoverned++;
        continue;
      }

      const replied=
        Number(l.email_reply_count||0)>0 ||
        Boolean(l.timestamp_last_reply) ||
        (l.email_replied_step!==null &&
         l.email_replied_step!==undefined);

      const classified=
        l.lt_interest_status!==null &&
        l.lt_interest_status!==undefined &&
        l.lt_interest_status!=="";

      const unsubscribed=Number(l.status)===-2;

      if(replied||classified||unsubscribed){
        protectedEngaged++;
        continue;
      }

      reclaimable++;
    }

    total+=reclaimable;

    results.push({
      campaignName:name,
      memberships:leads.length,
      protectedGoverned,
      protectedEngaged,
      reclaimable
    });
  }

  console.log(JSON.stringify({
    ok:true,
    gate:"FINE_GRAINED_CAPACITY_AUDIT_READ_ONLY",
    results,
    totalReclaimable:total,
    requiredForRemainingVaFss:837,
    enoughToFinishVaFss:total>=837,
    deletes:false
  },null,2));

})().catch(e=>{
  console.error(e.stack||e);
  process.exitCode=1;
});
