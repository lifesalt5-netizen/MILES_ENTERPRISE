'use strict';

/*
 P1.5K2 — Authoritative Federal Revenue Segmentation + Real Mailbox Reconciliation
 READ ONLY. No provider, Google Workspace, DNS, campaign, lead, or send mutations.
*/

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const masterInstantly = require('./MasterInstantlyRevenueReconciliationService');

const ROOT = process.cwd();
const OUT = path.join(ROOT,'DATA','OUTBOUND','INSTANTLY_MASTER_RECONCILIATION','FEDERAL_REVENUE_SEGMENTATION_AND_MAILBOX_AUDIT_K2_LATEST.json');
const TARGET_DOMAINS = ['pathways2gc.co','pathwaysfederal.com','pathwaysgov.com','pathwaysgovcon.com','pathwaysgsa.com','pathwaystogc.com'];
const PRIMARY = 'pathways2gc.com';
const FAMILIES = ['GSA','VA_FSS','SDVOSB','VOSB','WOSB','HUBZONE','8A','SBS_SAM'];
const TIERS = ['NO_SALES','ONE_TO_LT_3M','THREE_TO_LT_10M','TEN_M_PLUS','UNKNOWN'];

const REVENUE_FIELDS = [
  'federal_revenue','federal_sales','federal_award_revenue','award_revenue','total_federal_revenue',
  'prime_award_revenue','prime_revenue','usaspending_revenue','total_obligated_amount','federal_obligated_amount',
  'total_award_amount','award_amount','contract_value','sales'
];
const ID_FIELDS = ['uei','unique_entity_id','uei_sam','company_id','legal_name','company','company_name','business_name','entity_name'];

function s(v){return String(v==null?'':v).trim();}
function low(v){return s(v).toLowerCase();}
function money(v){ if(v==null||v==='')return null; const n=Number(String(v).replace(/[$,]/g,'').trim()); return Number.isFinite(n)?n:null; }
function tier(v){ const n=money(v); if(n==null||n<0)return 'UNKNOWN'; if(n===0)return 'NO_SALES'; if(n<3000000)return 'ONE_TO_LT_3M'; if(n<10000000)return 'THREE_TO_LT_10M'; return 'TEN_M_PLUS'; }
function fmap(o){ const m={}; for(const [k,v] of Object.entries(o||{}))m[low(k).replace(/[^a-z0-9]/g,'')]=v; return m; }
function first(m,names){ for(const n of names){const k=low(n).replace(/[^a-z0-9]/g,''); if(Object.prototype.hasOwnProperty.call(m,k)&&s(m[k])!=='')return m[k];} return null; }

function parseCsv(txt){
 const rows=[]; let row=[],f='',q=false;
 for(let i=0;i<txt.length;i++){const c=txt[i]; if(q){ if(c==='"'&&txt[i+1]==='"'){f+='"';i++;} else if(c==='"')q=false; else f+=c; }
 else { if(c==='"')q=true; else if(c===','){row.push(f);f='';} else if(c==='\n'){row.push(f);rows.push(row);row=[];f='';} else if(c!=='\r')f+=c; }}
 if(f.length||row.length){row.push(f);rows.push(row);} if(!rows.length)return[];
 const h=rows[0].map((x,i)=>s(x)||`col_${i}`);
 return rows.slice(1).filter(r=>r.some(x=>s(x))).map(r=>{const o={};h.forEach((k,i)=>{if(!(k in o))o[k]=r[i]??'';});return o;});
}

function walk(dir,depth=0,out=[]){
 if(depth>7||!fs.existsSync(dir))return out;
 let es=[]; try{es=fs.readdirSync(dir,{withFileTypes:true});}catch{return out;}
 for(const e of es){
  if(['node_modules','.git','ARCHIVE','BACKUPS','recovery','STATE_SLED','INSTANTLY_MASTER_RECONCILIATION','workforce_results'].includes(e.name))continue;
  const p=path.join(dir,e.name); if(e.isDirectory())walk(p,depth+1,out); else out.push(p);
 }
 return out;
}

function authoritativeLeadMasters(){
 const roots=[ROOT,path.join(ROOT,'DATA'),path.join(ROOT,'GOOD_FILES'),path.join(ROOT,'DATASETS')].filter(fs.existsSync);
 const files=[...new Set(roots.flatMap(r=>walk(r)))];
 const preferred=files.filter(p=>/MASTER_DEDUPED_ALL_SEGMENTS\.csv$/i.test(p));
 if(preferred.length)return preferred;
 return files.filter(p=>/\.(csv|json)$/i.test(p) && /(master.*segment|segment.*master|contractor.*master|federal.*master)/i.test(path.basename(p)) && !/(inbox|sender|campaign|state|sled|reconciliation|workforce|runtime)/i.test(p));
}

function revenue(row){ const m=fmap(row); return money(first(m,REVENUE_FIELDS)); }
function identity(row){ const m=fmap(row); const u=low(first(m,['uei','unique_entity_id','uei_sam'])); if(u)return `UEI:${u}`; const id=low(first(m,['company_id'])); if(id)return `CID:${id}`; const n=low(first(m,['legal_name','company','company_name','business_name','entity_name'])); return n?`NAME:${n}`:null; }
function blob(row,file){ return `${Object.values(row||{}).join(' | ')} | ${file}`.toUpperCase(); }
function families(row,file){
 const b=blob(row,file), out=new Set(), m=fmap(row);
 const seg=String(first(m,['segment','segments','primary_segment','source_segments','vehicle','contract_vehicle','certification','certifications','business_types','socioeconomic'])||'').toUpperCase();
 const x=`${seg} ${b}`;
 if(/\bGSA\b|MULTIPLE AWARD SCHEDULE|\bMAS\b/.test(x))out.add('GSA');
 if(/\bVA\b|\bFSS\b|VETERANS AFFAIRS|FEDERAL SUPPLY SCHEDULE/.test(x))out.add('VA_FSS');
 if(/SDVOSB|SERVICE[- ]DISABLED VETERAN/.test(x))out.add('SDVOSB');
 if(/(^|[^D])VOSB|VETERAN[- ]OWNED/.test(x))out.add('VOSB');
 if(/WOSB|WOMEN[- ]OWNED/.test(x))out.add('WOSB');
 if(/HUB ?ZONE/.test(x))out.add('HUBZONE');
 if(/\b8\(?A\)?\b|8\(A\)|8A FIRM/.test(x))out.add('8A');
 if(/\bSBS\b|\bSAM\b|SAM\.GOV|SMALL BUSINESS/.test(x))out.add('SBS_SAM');
 return [...out];
}

function loadAuthoritativeProspects(){
 const files=authoritativeLeadMasters(), rows=[];
 for(const file of files){
  try{
   if(!/\.csv$/i.test(file))continue;
   const parsed=parseCsv(fs.readFileSync(file,'utf8'));
   for(const r of parsed){ const id=identity(r), fam=families(r,path.basename(file)); if(!id||!fam.length)continue; rows.push({id,families:fam,revenue:revenue(r),source:file}); }
  }catch{}
 }
 return {files,rows};
}

function segment(rows){
 const by=new Map();
 for(const r of rows){ if(!by.has(r.id))by.set(r.id,{families:new Set(),revenues:[],sources:new Set()}); const x=by.get(r.id); r.families.forEach(f=>x.families.add(f)); if(r.revenue!=null)x.revenues.push(r.revenue); x.sources.add(r.source); }
 const cells={}; FAMILIES.forEach(f=>cells[f]=Object.fromEntries(TIERS.map(t=>[t,0])));
 let unknown=0,conflict=0; const unknownExamples=[],conflictExamples=[];
 for(const [id,x] of by){ const vals=[...new Set(x.revenues.map(Number))]; if(vals.length>1){conflict++; if(conflictExamples.length<25)conflictExamples.push({id,revenueValues:vals});} const v=vals.length?Math.max(...vals):null; const t=tier(v); if(t==='UNKNOWN'){unknown++; if(unknownExamples.length<25)unknownExamples.push({id,families:[...x.families]});} for(const f of x.families)if(cells[f])cells[f][t]++; }
 return {uniqueCompanies:by.size,cells,unknownRevenueCompanies:unknown,conflictingRevenueCompanies:conflict,unknownExamples,conflictExamples};
}

function mailboxRows(){
 const p=path.join(ROOT,'DATA','OUTBOUND','INBOX_STATUS_MASTER.csv'); if(!fs.existsSync(p))return {file:p,rows:[]};
 try{return {file:p,rows:parseCsv(fs.readFileSync(p,'utf8'))};}catch{return {file:p,rows:[]};}
}
function rowEmail(r){ const m=fmap(r); return low(first(m,['email','email_address','sender_email','account','mailbox','inbox'])); }
function rowStatus(r){ const m=fmap(r); return s(first(m,['status','account_status','health','state'])||'UNKNOWN'); }
function usableStatus(st){ return !/(disabled|failed|error|disconnected|inactive|suspended)/i.test(st); }

async function reconcileMailboxes(){
 const master=mailboxRows(); const observed=new Map();
 for(const r of master.rows){ const email=rowEmail(r); if(!email.includes('@'))continue; observed.set(email,{email,status:rowStatus(r),source:'INBOX_STATUS_MASTER',usable:usableStatus(rowStatus(r))}); }
 let campaigns=[]; try{ const live=await masterInstantly.run(); campaigns=Array.isArray(live?.campaigns)?live.campaigns:[]; }catch{}
 for(const c of campaigns){
  const senders=[...(Array.isArray(c.senderEmails)?c.senderEmails:[]),...(Array.isArray(c.senders)?c.senders:[])];
  for(const raw of senders){ const email=low(typeof raw==='string'?raw:(raw?.email||raw?.email_address)); if(!email.includes('@'))continue; const prev=observed.get(email)||{}; observed.set(email,{email,status:prev.status||'OBSERVED_ON_LIVE_CAMPAIGN',source:prev.source?'MASTER+LIVE_CAMPAIGN':'LIVE_CAMPAIGN',usable:prev.usable!==false}); }
 }
 const protectedObserved=[],domains=[];
 for(const domain of TARGET_DOMAINS){ const all=[...observed.values()].filter(x=>x.email.endsWith('@'+domain)); const usable=[...new Set(all.filter(x=>x.usable).map(x=>x.email))]; domains.push({domain,targetMailboxes:5,observedAccounts:all.length,usableMailboxes:usable.length,missingToTarget:Math.max(0,5-usable.length),usableEmails:usable,observed:all}); }
 for(const x of observed.values())if(x.email.endsWith('@'+PRIMARY))protectedObserved.push(x);
 const totalUsable=domains.reduce((n,d)=>n+d.usableMailboxes,0);
 return {masterFile:master.file,campaignsObserved:campaigns.length,uniqueSendersObserved:observed.size,protectedPrimaryDomain:PRIMARY,protectedPrimaryDomainObserved:protectedObserved,targetDomains:domains,totals:{targetDomains:6,targetMailboxes:30,usableTargetDomainMailboxes:totalUsable,missingMailboxes:Math.max(0,30-totalUsable),capacityAt25PerMailboxIfTargetMet:750,currentCapacityAt25PerUsableMailbox:totalUsable*25}};
}

async function run(){
 const src=loadAuthoritativeProspects(); const seg=segment(src.rows); const mb=await reconcileMailboxes();
 const result={ok:true,gate:'P1.5K2_AUTHORITATIVE_FEDERAL_REVENUE_SEGMENTATION_AND_REAL_MAILBOX_RECONCILIATION',version:'1.0-read-only',generatedAt:new Date().toISOString(),revenueTierPolicy:{NO_SALES:'$0',ONE_TO_LT_3M:'$1 to <$3,000,000',THREE_TO_LT_10M:'$3,000,000 to <$10,000,000',TEN_M_PLUS:'$10,000,000+',UNKNOWN:'No trustworthy revenue value in authoritative prospect master'},federalSegmentation:{sourceFilesUsed:src.files,candidateRowsUsed:src.rows.length,...seg,authoritativeEnoughToMutateCampaigns:seg.uniqueCompanies>0&&seg.unknownRevenueCompanies===0&&seg.conflictingRevenueCompanies===0},mailboxReconciliation:mb,decisions:{federalSegmentationNext:seg.unknownRevenueCompanies||seg.conflictingRevenueCompanies?'ENRICH_UNKNOWN_REVENUE_FROM_AUTHORITATIVE_AWARD_HISTORY_BEFORE_RESEGMENTATION':'READY_FOR_GOVERNED_RESEGMENTATION',mailboxNext:mb.totals.missingMailboxes?'CREATE_OR_CONNECT_ONLY_CONFIRMED_MISSING_MAILBOXES':'MAILBOX_TARGET_MET'},safety:{readOnly:true,createGoogleWorkspaceUsers:false,changeDns:false,connectInstantlyAccounts:false,mutateCampaigns:false,moveLeads:false,uploadLeads:false,activateCampaigns:false,sendEmails:false,protectedPrimaryDomainExcludedFromOutboundTarget:true},outputFile:OUT};
 fs.mkdirSync(path.dirname(OUT),{recursive:true}); fs.writeFileSync(OUT,JSON.stringify(result,null,2)); return result;
}

module.exports={run};
if(require.main===module)run().then(r=>console.dir(r,{depth:10})).catch(e=>{console.error(e);process.exit(1);});
