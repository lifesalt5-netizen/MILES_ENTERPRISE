'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

process.env.MILES_DRY_RUN = 'true';
process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'false';
process.env.MILES_CONTROLLED_WRITE_ENABLED = 'false';

const ROOT = process.env.MILES_ROOT || process.cwd();
const PLAN = path.join(ROOT,'DATA','OUTBOUND','FEDERAL_VA_FSS_GOVERNED','FEDERAL_VA_FSS_CAMPAIGN_ASSIGNMENT_PLAN.csv');
const MASTER_RECON = path.join(ROOT,'DATA','OUTBOUND','INSTANTLY_MASTER_RECONCILIATION','MASTER_INSTANTLY_RECONCILIATION_LATEST.json');
const OUTPUT = path.join(ROOT,'DATA','OUTBOUND','FEDERAL_VA_FSS_GOVERNED','FEDERAL_VA_FSS_READINESS_GATE_LATEST.json');

function parseCsvLine(line){const out=[];let cur='';let q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===','&&!q){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out;}
function readCsv(file){const lines=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());if(lines.length<2)return[];const h=parseCsvLine(lines[0]);return lines.slice(1).map(line=>{const v=parseCsvLine(line);const r={};h.forEach((x,i)=>r[x]=v[i]??'');return r;});}
function norm(v){return String(v??'').trim();}
function lower(v){return norm(v).toLowerCase();}
function uniq(arr){return [...new Set(arr.filter(Boolean))];}

function isAcquisitionFamily(f){return ['EXPIRATION','GSA','VA','SAM','CERTIFICATION','SBS','STATE_SLED'].includes(String(f||'').toUpperCase());}
function higherPriorityFamily(f){const p={EXPIRATION:1,GSA:2,VA:3,SAM:4,CERTIFICATION:5,SBS:6,STATE_SLED:7};return p[String(f||'').toUpperCase()]||99;}

async function run(){
  if(!fs.existsSync(PLAN)) throw new Error(`Missing plan: ${PLAN}`);
  if(!fs.existsSync(MASTER_RECON)) throw new Error(`Missing master reconciliation: ${MASTER_RECON}`);

  const planRows=readCsv(PLAN);
  const recon=JSON.parse(fs.readFileSync(MASTER_RECON,'utf8'));
  const campaigns=Array.isArray(recon.campaigns)?recon.campaigns:[];

  const targetNames=['VA No Sales','VA 0-500k','VA 501k-3m','VA 3-5m','VA 5m+'];
  const targetCampaigns=targetNames.map(name=>campaigns.find(c=>c.campaignName===name)).filter(Boolean);

  const activeAcquisition=campaigns.filter(c=>c.statusLabel==='ACTIVE'&&isAcquisitionFamily(c.family));
  const activeMembershipByEmail=new Map();
  for(const c of activeAcquisition){
    for(const e of (c.leadEmails||[])){
      const key=lower(e); if(!key) continue;
      if(!activeMembershipByEmail.has(key)) activeMembershipByEmail.set(key,[]);
      activeMembershipByEmail.get(key).push({campaignName:c.campaignName,family:c.family,priority:higherPriorityFamily(c.family)});
    }
  }

  const suppressionNames=new Set(['NO - SUPPRESSED','TECHNICAL SUPPRESSION']);
  const suppressionEmails=new Set();
  for(const c of campaigns.filter(c=>suppressionNames.has(c.campaignName))){
    for(const e of (c.leadEmails||[])){const key=lower(e);if(key)suppressionEmails.add(key);}
  }

  const byCampaign={};
  for(const name of targetNames){
    const c=campaigns.find(x=>x.campaignName===name)||null;
    const rows=planRows.filter(r=>r.proposed_campaign===name || r.campaign_name===name || r.campaignName===name);
    let suppressed=0, higherPriorityOverlap=0, anyActiveOverlap=0;
    const overlapCampaigns={};
    for(const r of rows){
      const email=lower(r.email||r.Email||r.contact_email||r.schedule_email);
      if(email&&suppressionEmails.has(email)) suppressed++;
      const memberships=email?activeMembershipByEmail.get(email)||[]:[];
      if(memberships.length){
        anyActiveOverlap++;
        for(const m of memberships){overlapCampaigns[m.campaignName]=(overlapCampaigns[m.campaignName]||0)+1;}
        if(memberships.some(m=>m.priority<3)) higherPriorityOverlap++;
      }
    }
    const senderEmails=uniq(c?.senderEmails||[]);
    const sequenceStepCount=Number(c?.sequenceStepCount||0);
    const schedulePresent=Boolean(c?.schedulePresent);
    const dailyLimit=Number(c?.dailyLimit||0);
    const blockers=[];
    if(!c) blockers.push('CAMPAIGN_MISSING');
    if(rows.length===0) blockers.push('NO_MAPPED_CONTACTS');
    if(senderEmails.length===0) blockers.push('NO_SENDERS_ASSIGNED');
    if(sequenceStepCount===0) blockers.push('NO_SEQUENCE_STEPS');
    if(!schedulePresent) blockers.push('NO_SCHEDULE');
    if(dailyLimit<=0) blockers.push('NO_DAILY_LIMIT');
    if(suppressed>0) blockers.push('SUPPRESSED_CONTACTS_PRESENT');
    if(higherPriorityOverlap>0) blockers.push('HIGHER_PRIORITY_ACTIVE_OVERLAP');

    byCampaign[name]={
      campaignId:c?.campaignId||null,
      statusLabel:c?.statusLabel||null,
      mappedContacts:rows.length,
      senderEmails,
      senderCount:senderEmails.length,
      sequenceStepCount,
      schedulePresent,
      dailyLimit,
      suppressedContacts:suppressed,
      activeAcquisitionOverlapContacts:anyActiveOverlap,
      higherPriorityOverlapContacts:higherPriorityOverlap,
      overlapCampaigns,
      readyForWriteGate:blockers.length===0,
      blockers
    };
  }

  const summary={
    campaignsReviewed:targetNames.length,
    campaignsReady:Object.values(byCampaign).filter(x=>x.readyForWriteGate).length,
    campaignsBlocked:Object.values(byCampaign).filter(x=>!x.readyForWriteGate).length,
    mappedContacts:planRows.length,
    blockedUnknownRevenue:planRows.filter(r=>String(r.mapping_status||'').includes('UNKNOWN')||String(r.va_fss_campaign_bucket||'')==='VA_REVENUE_UNKNOWN').length
  };

  const result={
    ok:true,
    gate:'FEDERAL_VA_FSS_READINESS_GATE_READ_ONLY',
    generatedAt:new Date().toISOString(),
    namespace:'FEDERAL_VA_FSS',
    stateVirginiaSledExcluded:true,
    summary,
    campaigns:byCampaign,
    safety:{readOnly:true,writesToInstantly:false,campaignMutations:false,uploads:false,activations:false,deletes:false},
    nextAction: summary.campaignsBlocked===0 ? 'BUILD_CONTROLLED_WRITE_GATE' : 'FIX_CAMPAIGN_READINESS_BLOCKERS_THEN_RERUN'
  };

  fs.writeFileSync(OUTPUT,JSON.stringify(result,null,2),'utf8');
  result.outputFile=OUTPUT;
  console.log(JSON.stringify(result,null,2));
}

run().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
