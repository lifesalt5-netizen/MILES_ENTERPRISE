'use strict';
/* P1.5K5 — canonical four-tier federal segmentation builder. Writes local segment artifacts only; no Instantly mutations. */
const fs=require('fs'), path=require('path');
const ROOT=process.cwd();
const OUTDIR=path.join(ROOT,'DATA','OUTBOUND','FEDERAL_CANONICAL_SEGMENTS_V4');
const SUMMARY=path.join(OUTDIR,'FEDERAL_CANONICAL_SEGMENTATION_SUMMARY.json');
const MASTER_CANDIDATES=[
 'D:\\P2GC_Intelligence\\ARCHIVE_2026_REVIEW\\Good Files to use\\Good To Use and segmented\\MASTER_DEDUPED_ALL_SEGMENTS.csv',
 'D:\\P2GC_Intelligence\\Good Files to use\\Good To Use and segmented\\MASTER_DEDUPED_ALL_SEGMENTS.csv'
];
const FAMS=['GSA','VA_FSS','SDVOSB','VOSB','WOSB','HUBZONE','8A','SBS_SAM'];
const TIERS=['NO_SALES','ONE_TO_LT_3M','THREE_TO_LT_10M','TEN_M_PLUS','UNKNOWN'];
function s(v){return String(v??'').trim()} function low(v){return s(v).toLowerCase()} function key(v){return low(v).replace(/[^a-z0-9]/g,'')}
function money(v){if(v==null||s(v)==='')return null;const n=Number(String(v).replace(/[$,]/g,''));return Number.isFinite(n)?n:null}
function tier(n){return n==null?'UNKNOWN':n===0?'NO_SALES':n<3000000?'ONE_TO_LT_3M':n<10000000?'THREE_TO_LT_10M':'TEN_M_PLUS'}
function parseCsv(t){let a=[],r=[],f='',q=false;for(let i=0;i<t.length;i++){let c=t[i];if(q){if(c==='"'&&t[i+1]==='"'){f+='"';i++}else if(c==='"')q=false;else f+=c}else if(c==='"')q=true;else if(c===','){r.push(f);f=''}else if(c==='\n'){r.push(f);a.push(r);r=[];f=''}else if(c!=='\r')f+=c}if(f||r.length){r.push(f);a.push(r)}if(!a.length)return[];const h=a[0].map((x,i)=>s(x)||`col_${i}`);return a.slice(1).filter(x=>x.some(s)).map(x=>Object.fromEntries(h.map((z,i)=>[z,x[i]??''])))}
function esc(v){const x=s(v);return /[",\n\r]/.test(x)?'"'+x.replace(/"/g,'""')+'"':x}
function fmap(o){const m={};for(const [k,v] of Object.entries(o||{}))m[key(k)]=v;return m}
function first(m,n){for(const x of n){const v=m[key(x)];if(s(v)!=='')return v}return null}
function truthy(v){return /^(1|true|yes|y|active|certified)$/i.test(s(v))}
function identity(r){const m=fmap(r);return low(first(m,['uei','norm_uei','UEI (Unique Entity Identifier)','company_id','legal_name','Business name','company']))||null}
function families(r){const m=fmap(r), out=new Set();const blob=[first(m,['vehicle']),first(m,['vehicle_hint']),first(m,['segment']),first(m,['source_file']),first(m,['source_files']),first(m,['Active SBA certifications']),first(m,['Business type and self-certifications'])].map(s).join(' ').toUpperCase();
 if(/\bGSA\b|\bMAS\b|MULTIPLE AWARD SCHEDULE/.test(blob))out.add('GSA');
 if(/\bVA\b|\bFSS\b|VETERANS AFFAIRS|FEDERAL SUPPLY SCHEDULE/.test(blob))out.add('VA_FSS');
 if(/SDVOSB|SERVICE[- ]DISABLED VETERAN/.test(blob)||truthy(first(m,['is_sdvosb','SDVOSB','Service Disabled Veteran Owned Small Business'])))out.add('SDVOSB');
 if(/VOSB|VETERAN[- ]OWNED/.test(blob)||truthy(first(m,['is_vosb','VOSB','Veteran-Owned Small Business (VOSB) certification status'])))out.add('VOSB');
 if(/WOSB|WOMEN[- ]OWNED/.test(blob)||truthy(first(m,['is_wosb','WOSB','Women-Owned Small Business (WOSB) certification status'])))out.add('WOSB');
 if(/HUB ?ZONE/.test(blob)||truthy(first(m,['is_hubzone','HUBZone certification status'])))out.add('HUBZONE');
 if(/8\(A\)|\b8A\b/.test(blob)||truthy(first(m,['is_8a','8(a) certification status'])))out.add('8A');
 if(/\bSBS\b|\bSAM\b|SMALL BUSINESS/.test(blob)||truthy(first(m,['is_federal','Small_Business_Flag'])))out.add('SBS_SAM');
 return [...out];}
function findMaster(){for(const p of MASTER_CANDIDATES)if(fs.existsSync(p))return p;throw new Error('MASTER_DEDUPED_ALL_SEGMENTS.csv not found at approved paths');}
async function run(){const master=findMaster();const rows=parseCsv(fs.readFileSync(master,'utf8'));fs.mkdirSync(OUTDIR,{recursive:true});const buckets={};for(const f of FAMS){buckets[f]={};for(const t of TIERS)buckets[f][t]=[]}
 const seen=new Set();let skippedNoId=0;for(const r of rows){const id=identity(r);if(!id){skippedNoId++;continue}const m=fmap(r),rev=money(first(m,['federal_revenue'])),t=tier(rev),fsx=families(r);for(const fam of fsx){const dedupe=fam+'|'+t+'|'+id;if(seen.has(dedupe))continue;seen.add(dedupe);buckets[fam][t].push(r)}}
 const counts={};const files=[];for(const fam of FAMS){counts[fam]={};for(const t of TIERS){const arr=buckets[fam][t];counts[fam][t]=arr.length;const fp=path.join(OUTDIR,`${fam}__${t}.csv`);const headers=arr.length?Object.keys(arr[0]):Object.keys(rows[0]||{});const body=[headers.map(esc).join(','),...arr.map(r=>headers.map(h=>esc(r[h])).join(','))].join('\n');fs.writeFileSync(fp,body);files.push({family:fam,tier:t,file:fp,count:arr.length})}}
 const result={ok:true,gate:'P1.5K5_CANONICAL_FOUR_TIER_FEDERAL_SEGMENTATION_BUILD',generatedAt:new Date().toISOString(),sourceMaster:master,sourceRows:rows.length,skippedNoId,revenueTierPolicy:{NO_SALES:'$0',ONE_TO_LT_3M:'$1 to <$3M',THREE_TO_LT_10M:'$3M to <$10M',TEN_M_PLUS:'$10M+',UNKNOWN:'missing federal_revenue'},counts,files,liveCampaignsMutated:false,nextAction:'REVIEW_COUNTS_THEN_GOVERNED_INSTANTLY_RESEGMENTATION'};fs.writeFileSync(SUMMARY,JSON.stringify(result,null,2));return result}
module.exports={run};if(require.main===module)run().then(r=>console.dir(r,{depth:8})).catch(e=>{console.error(e);process.exit(1)});