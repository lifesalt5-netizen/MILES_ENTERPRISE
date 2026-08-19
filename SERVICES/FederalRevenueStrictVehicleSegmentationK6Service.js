'use strict';
/* P1.5K6 — strict vehicle/certification four-tier segmentation. READ/WRITE LOCAL ARTIFACTS ONLY; NO INSTANTLY MUTATION. */
const fs=require('fs'),path=require('path');
const ROOT=process.cwd();
const MASTER_CANDIDATES=[
'D:\\P2GC_Intelligence\\ARCHIVE_2026_REVIEW\\Good Files to use\\Good To Use and segmented\\MASTER_DEDUPED_ALL_SEGMENTS.csv',
'D:\\P2GC_Intelligence\\Good Files to use\\Good To Use and segmented\\MASTER_DEDUPED_ALL_SEGMENTS.csv'
];
const OUTDIR=path.join(ROOT,'DATA','OUTBOUND','FEDERAL_STRICT_SEGMENTS_V4');
const FAMS=['GSA','VA_FSS','SDVOSB','VOSB','WOSB','HUBZONE','8A','SBS_SAM'];
const TIERS=['NO_SALES','ONE_TO_LT_3M','THREE_TO_LT_10M','TEN_M_PLUS','UNKNOWN'];
function s(v){return String(v??'').trim()} function low(v){return s(v).toLowerCase()} function key(v){return low(v).replace(/[^a-z0-9]/g,'')}
function parseCsv(t){let a=[],r=[],f='',q=false;for(let i=0;i<t.length;i++){let c=t[i];if(q){if(c==='"'&&t[i+1]==='"'){f+='"';i++}else if(c==='"')q=false;else f+=c}else if(c==='"')q=true;else if(c===','){r.push(f);f=''}else if(c==='\n'){r.push(f);a.push(r);r=[];f=''}else if(c!=='\r')f+=c}if(f||r.length){r.push(f);a.push(r)}if(!a.length)return[];let h=a[0].map((x,i)=>s(x)||`col_${i}`);return a.slice(1).filter(x=>x.some(s)).map(x=>Object.fromEntries(h.map((z,i)=>[z,x[i]??''])))}
function fmap(o){let m={};for(let[k,v]of Object.entries(o||{}))m[key(k)]=v;return m} function first(m,n){for(let x of n){let v=m[key(x)];if(s(v)!=='')return v}return null}
function truthy(v){return /^(1|true|yes|y|active|certified|current)$/i.test(s(v))} function money(v){if(v==null||s(v)==='')return null;let n=Number(String(v).replace(/[$,]/g,''));return Number.isFinite(n)?n:null} function tier(n){return n==null?'UNKNOWN':n===0?'NO_SALES':n<3e6?'ONE_TO_LT_3M':n<1e7?'THREE_TO_LT_10M':'TEN_M_PLUS'}
function identity(r){let m=fmap(r);return low(first(m,['uei','norm_uei','UEI (Unique Entity Identifier)','company_id','legal_name','Business name']))||null}
function strictFamilies(r){let m=fmap(r),out=new Set();
 const vehicle=[first(m,['vehicle']),first(m,['FED_VEHICLE']),first(m,['vehicle_hint'])].map(s).join(' ').toUpperCase();
 const masConfirmed=truthy(first(m,['MAS_Confirmed_Flag','MAS Confirmed Flag']));
 if(masConfirmed||/\bGSA\b|\bMAS\b|MULTIPLE AWARD SCHEDULE/.test(vehicle))out.add('GSA');
 if(/\bVA\b|\bFSS\b|VETERANS AFFAIRS|FEDERAL SUPPLY SCHEDULE/.test(vehicle))out.add('VA_FSS');
 const cert=[first(m,['Active SBA certifications']),first(m,['Business type and self-certifications']),first(m,['setaside_raw'])].map(s).join(' ').toUpperCase();
 if(truthy(first(m,['is_sdvosb']))||/SDVOSB|SERVICE[- ]DISABLED VETERAN/.test(cert))out.add('SDVOSB');
 if(truthy(first(m,['is_vosb','Veteran-Owned Small Business (VOSB) certification status']))||/(^|[^D])VOSB|VETERAN[- ]OWNED/.test(cert))out.add('VOSB');
 if(truthy(first(m,['is_wosb','Women-Owned Small Business (WOSB) certification status']))||/WOSB|WOMEN[- ]OWNED/.test(cert))out.add('WOSB');
 if(truthy(first(m,['is_hubzone','HUBZone certification status']))||/HUB ?ZONE/.test(cert))out.add('HUBZONE');
 if(truthy(first(m,['is_8a','8(a) certification status']))||/8\(A\)|\b8A\b/.test(cert))out.add('8A');
 const small=truthy(first(m,['is_federal','Small_Business_Flag']))||/SMALL BUSINESS/.test(cert);
 if(small)out.add('SBS_SAM');
 return [...out];}
function findMaster(){for(let p of MASTER_CANDIDATES)if(fs.existsSync(p))return p;throw new Error('canonical master not found')}
function esc(v){let x=s(v);return /[",\n\r]/.test(x)?'"'+x.replace(/"/g,'""')+'"':x}
async function run(){let master=findMaster(),rows=parseCsv(fs.readFileSync(master,'utf8'));fs.mkdirSync(OUTDIR,{recursive:true});let buckets={};for(let f of FAMS){buckets[f]={};for(let t of TIERS)buckets[f][t]=[]}
 let seen=new Set(),diag={gsaByMasConfirmed:0,gsaByExplicitVehicle:0,vaByExplicitVehicle:0,rowsWithRevenue:0,rowsWithPositiveRevenue:0};
 for(let r of rows){let id=identity(r);if(!id)continue;let m=fmap(r),rev=money(first(m,['federal_revenue']));if(rev!=null){diag.rowsWithRevenue++;if(rev>0)diag.rowsWithPositiveRevenue++}let fams=strictFamilies(r),t=tier(rev);let vehicle=[first(m,['vehicle']),first(m,['FED_VEHICLE']),first(m,['vehicle_hint'])].map(s).join(' ').toUpperCase();if(truthy(first(m,['MAS_Confirmed_Flag'])))diag.gsaByMasConfirmed++;if(/\bGSA\b|\bMAS\b|MULTIPLE AWARD SCHEDULE/.test(vehicle))diag.gsaByExplicitVehicle++;if(/\bVA\b|\bFSS\b|VETERANS AFFAIRS|FEDERAL SUPPLY SCHEDULE/.test(vehicle))diag.vaByExplicitVehicle++;
 for(let fam of fams){let dk=fam+'|'+t+'|'+id;if(seen.has(dk))continue;seen.add(dk);buckets[fam][t].push(r)}}
 let counts={},files=[];for(let fam of FAMS){counts[fam]={};for(let t of TIERS){let arr=buckets[fam][t];counts[fam][t]=arr.length;let fp=path.join(OUTDIR,`${fam}__${t}.csv`),headers=arr.length?Object.keys(arr[0]):Object.keys(rows[0]||{});fs.writeFileSync(fp,[headers.map(esc).join(','),...arr.map(r=>headers.map(h=>esc(r[h])).join(','))].join('\n'));files.push({family:fam,tier:t,count:arr.length,file:fp})}}
 let result={ok:true,gate:'P1.5K6_STRICT_VEHICLE_CERTIFICATION_FOUR_TIER_SEGMENTATION',version:'1.0',generatedAt:new Date().toISOString(),sourceMaster:master,sourceRows:rows.length,classificationRule:'STRICT: vehicle/FED_VEHICLE/vehicle_hint + MAS_Confirmed_Flag only; source_file/source_files/segment text are NOT used to infer GSA or VA/FSS. Certifications use dedicated certification fields.',revenueTierPolicy:{NO_SALES:'$0',ONE_TO_LT_3M:'$1 to <$3M',THREE_TO_LT_10M:'$3M to <$10M',TEN_M_PLUS:'$10M+',UNKNOWN:'missing federal_revenue'},diagnostics:diag,counts,files,liveCampaignsMutated:false,nextAction:'COMPARE_COUNTS_TO_EXPECTED_RANGE_AND_ONLY_THEN_RESEGMENT_LIVE_CAMPAIGNS'};fs.writeFileSync(path.join(OUTDIR,'FEDERAL_STRICT_SEGMENTATION_SUMMARY.json'),JSON.stringify(result,null,2));return result}
module.exports={run};if(require.main===module)run().then(r=>console.dir(r,{depth:10})).catch(e=>{console.error(e);process.exit(1)});