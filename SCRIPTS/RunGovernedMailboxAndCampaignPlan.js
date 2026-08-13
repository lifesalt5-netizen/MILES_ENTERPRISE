'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

process.env.MILES_DRY_RUN = 'true';
process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'false';
process.env.MILES_CONTROLLED_WRITE_ENABLED = 'false';

const connector = require('../CONNECTORS/INSTANTLY/connector');
const master = require('../SERVICES/MasterInstantlyRevenueReconciliationService');

const ROOT = process.env.MILES_ROOT || process.cwd();
const ROUTING_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'GOVERNED_LEAD_REPOSITORY', 'MASTER_GOVERNED_VERIFIED_ROUTING.csv');
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'OUTBOUND', 'GOVERNED_REVENUE_PLAN');
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'GOVERNED_MAILBOX_CAMPAIGN_PLAN_LATEST.json');
const OUTPUT_CSV = path.join(OUTPUT_DIR, 'GOVERNED_CONTACT_ASSIGNMENT_PLAN_LATEST.csv');
const TARGET_MAILBOXES = 30;

function unwrapItems(v) {
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.items)) return v.items;
  if (Array.isArray(v?.data)) return v.data;
  return [];
}
function norm(v) { return String(v ?? '').trim(); }
function lower(v) { return norm(v).toLowerCase(); }
function parseCsvLine(line) {
  const out=[]; let cur=''; let q=false;
  for (let i=0;i<line.length;i+=1) {
    const ch=line[i];
    if (ch==='"') {
      if (q && line[i+1]==='"') { cur+='"'; i+=1; }
      else q=!q;
    } else if (ch===',' && !q) { out.push(cur); cur=''; }
    else cur+=ch;
  }
  out.push(cur); return out;
}
function readCsv(file) {
  const lines=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());
  if (lines.length<2) return [];
  const h=parseCsvLine(lines[0]);
  return lines.slice(1).map(line=>{const v=parseCsvLine(line); const r={}; h.forEach((x,i)=>r[x]=v[i]??''); return r;});
}
function esc(v) { const s=String(v??''); return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
function isProtected(email) {
  const e=lower(email);
  if (!e) return true;
  if (e==='kevin@pathways2gc.com' || e==='info@pathways2gc.com') return true;
  return e.endsWith('@pathways2gc.com');
}
function senderReady(a) {
  return Number(a?.status)===1 && Number(a?.warmup_status)===1 && Number(a?.daily_limit||0)>0 && !a?.setup_pending;
}
function exactCampaignForSegment(segment, campaigns) {
  const rules = {
    'SETASIDE_8A': ['8a firms'],
    'SETASIDE_HUBZONE': ['HubZone'],
    'SETASIDE_SDVOSB': ['SDVOSB'],
    'SETASIDE_VOSB': ['VOSB'],
    'SETASIDE_WOSB': ['WOSB']
  };
  const names=rules[segment]||[];
  for (const wanted of names) {
    const c=campaigns.find(x=>lower(x.campaignName)===lower(wanted));
    if (c) return {campaign:c, mappingStatus:'EXACT_EXISTING_CAMPAIGN'};
  }
  if (segment==='SETASIDE_EDWOSB') return {campaign:null,mappingStatus:'MISSING_CAMPAIGN_EDWOSB'};
  if (segment==='VA_LOW_SALES') {
    const candidates=campaigns.filter(x=>['VA No Sales','VA 0-500k','VA 501k-3m','VA 3-5m','VA 5m+'].includes(x.campaignName));
    return {campaign:null,mappingStatus:'AMBIGUOUS_VA_LOW_SALES_REQUIRES_SUBSEGMENT',candidateCampaigns:candidates.map(x=>x.campaignName)};
  }
  return {campaign:null,mappingStatus:'NO_EXACT_CAMPAIGN'};
}

async function readAllAccounts() {
  const rows=[]; const seen=new Set(); let startingAfter;
  for (let page=0;page<100;page+=1) {
    const payload={limit:100}; if (startingAfter) payload.starting_after=startingAfter;
    const r=await connector.execute({action:'listAccounts',payload});
    const env=r?.accounts||r?.result||{}; const items=unwrapItems(env);
    for (const a of items) { const key=lower(a?.email); if (key && !seen.has(key)) { seen.add(key); rows.push(a); } }
    const next=env?.next_starting_after||env?.nextStartingAfter||null;
    if (!next || !items.length || next===startingAfter) break;
    startingAfter=next;
  }
  return rows;
}

async function run() {
  if (!fs.existsSync(ROUTING_FILE)) throw new Error(`Missing governed routing file: ${ROUTING_FILE}`);
  const contacts=readCsv(ROUTING_FILE);
  const snapshot=await master.run();
  const campaigns=snapshot.campaigns;
  const accounts=await readAllAccounts();

  const mailboxRows=accounts.map(a=>({
    email:lower(a.email),
    protected:isProtected(a.email),
    status:Number(a.status),
    warmupStatus:Number(a.warmup_status),
    dailyLimit:Number(a.daily_limit||0),
    setupPending:Boolean(a.setup_pending),
    ready:!isProtected(a.email) && senderReady(a)
  }));
  const safe=mailboxRows.filter(x=>x.ready);
  const protectedRows=mailboxRows.filter(x=>x.protected);

  const segments=[...new Set(contacts.map(x=>norm(x.assigned_segment)).filter(Boolean))].sort();
  const segmentPlans=segments.map(segment=>{
    const rows=contacts.filter(x=>norm(x.assigned_segment)===segment);
    const mapping=exactCampaignForSegment(segment,campaigns);
    return {
      segment,
      governedContacts:rows.length,
      uniqueCompanies:new Set(rows.map(x=>x.company_key)).size,
      mappingStatus:mapping.mappingStatus,
      campaignId:mapping.campaign?.campaignId||null,
      campaignName:mapping.campaign?.campaignName||null,
      campaignStatus:mapping.campaign?.statusLabel||null,
      existingCampaignMemberships:mapping.campaign?.leadCount??null,
      senderEmails:mapping.campaign?.senderEmails||[],
      candidateCampaigns:mapping.candidateCampaigns||[]
    };
  });

  const assignmentRows=contacts.map(r=>{
    const p=segmentPlans.find(x=>x.segment===norm(r.assigned_segment));
    return {
      company_key:r.company_key,
      company_name:r.company_name,
      contact_name:r.contact_name,
      email:lower(r.email),
      assigned_segment:r.assigned_segment,
      segment_priority:r.segment_priority,
      proposed_campaign:p?.campaignName||'',
      proposed_campaign_id:p?.campaignId||'',
      mapping_status:p?.mappingStatus||'NO_PLAN',
      assigned_mailbox:'',
      write_status:'READ_ONLY_PLAN_ONLY'
    };
  });

  const result={
    ok:true,
    gate:'GOVERNED_MAILBOX_CAMPAIGN_ASSIGNMENT_PLAN',
    generatedAt:new Date().toISOString(),
    totals:{
      governedContacts:contacts.length,
      governedCompanies:new Set(contacts.map(x=>x.company_key)).size,
      governedSegments:segments.length,
      liveCampaigns:campaigns.length,
      accountsObserved:accounts.length,
      protectedMailboxes:protectedRows.length,
      campaignSafeReadyMailboxes:safe.length,
      targetCampaignSafeMailboxes:TARGET_MAILBOXES,
      mailboxGap:Math.max(0,TARGET_MAILBOXES-safe.length),
      currentSafeDailyCapacity:safe.reduce((n,x)=>n+x.dailyLimit,0),
      exactMappedContacts:assignmentRows.filter(x=>x.mapping_status==='EXACT_EXISTING_CAMPAIGN').length,
      blockedOrAmbiguousContacts:assignmentRows.filter(x=>x.mapping_status!=='EXACT_EXISTING_CAMPAIGN').length
    },
    protectedMailboxes:protectedRows,
    campaignSafeReadyMailboxes:safe,
    allMailboxes:mailboxRows,
    segmentPlans,
    safety:{readOnly:true,liveCampaignsMutated:false,uploads:false,activations:false,updates:false,deletes:false,replies:false}
  };

  fs.mkdirSync(OUTPUT_DIR,{recursive:true});
  fs.writeFileSync(OUTPUT_JSON,JSON.stringify(result,null,2),'utf8');
  const headers=Object.keys(assignmentRows[0]||{});
  const lines=[headers.join(',')];
  for (const row of assignmentRows) lines.push(headers.map(h=>esc(row[h])).join(','));
  fs.writeFileSync(OUTPUT_CSV,lines.join('\n'),'utf8');
  result.outputJson=OUTPUT_JSON; result.outputCsv=OUTPUT_CSV;
  return result;
}

run().then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.stack||e);process.exitCode=1;});
