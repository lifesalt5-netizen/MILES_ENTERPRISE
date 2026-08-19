'use strict';
/*
 P1.5K7 — Source-truth reconstruction for federal segmentation.
 READ ONLY with respect to live systems. Writes local audit artifacts only.
 Goal: reconstruct vehicle truth, certification truth, and award/revenue truth by UEI
 from underlying source datasets instead of reclassifying the contaminated master.
*/
const fs=require('fs');
const path=require('path');
const readline=require('readline');
const ROOT=process.cwd();
const OUTDIR=path.join(ROOT,'DATA','OUTBOUND','FEDERAL_SOURCE_TRUTH_K7');
const SUMMARY=path.join(OUTDIR,'FEDERAL_SOURCE_TRUTH_K7_SUMMARY.json');
const FAMS=['GSA','VA_FSS','SDVOSB','VOSB','WOSB','HUBZONE','8A','SBS_SAM'];
const TIERS=['NO_SALES','ONE_TO_LT_3M','THREE_TO_LT_10M','TEN_M_PLUS','UNKNOWN'];
const SOURCE_CANDIDATES={
 vehicle:[
  'D:\\P2GC_Intelligence\\ORION_CORE\\P2GC_FINAL_SEGMENTED.csv',
  'D:\\P2GC_Intelligence\\CONSOLIDATION OF LEADS\\P2GC_FINAL_SEGMENTED.csv',
  'D:\\P2GC_Intelligence\\ARCHIVE_2026_REVIEW\\_ARCHIVE_2026\\.csv\'s\\P2GC_FINAL_SEGMENTED.csv'
 ],
 revenue:[
  'D:\\P2GC_Intelligence\\SAM_Registry\\SAM_PUBLIC_MONTHLY_V2_20260301\\OUT_FILTERED\\P2GC_EVAN_SEGMENTED_MASTER_V2.csv',
  'D:\\P2GC_Intelligence\\ORION_CORE\\SAM_Registry\\SAM_PUBLIC_MONTHLY_V2_20260301\\OUT_FILTERED\\P2GC_EVAN_SEGMENTED_MASTER_V2.csv',
  'D:\\P2GC_Intelligence\\ORION_CORE\\From B12 042926\\USA_SEGMENTED_COMPANIES.csv'
 ],
 certification:[
  'D:\\P2GC_Intelligence\\CONSOLIDATION OF LEADS\\MASTER\\SBS_SEGMENTED_TARGETS.csv',
  'D:\\P2GC_Intelligence\\ORION_CORE\\CONSOLIDATION OF LEADS\\MASTER\\SBS_SEGMENTED_TARGETS.csv',
  'D:\\P2GC_Intelligence\\ARCHIVE_2026_REVIEW\\Good Files to use\\Good To Use and segmented\\CANONICAL_OPERATIONAL_REGISTRY_USED_FOR_MISSING_SEGMENTS.csv'
 ],
 sam:[
  'D:\\P2GC_Intelligence\\SAM_Registry\\SAM_PUBLIC_MONTHLY_V2_20260301\\OUT_FILTERED\\P2GC_MASTER_WITH_SEGMENTS.csv',
  'D:\\P2GC_Intelligence\\ORION_CORE\\SAM_Registry\\SAM_PUBLIC_MONTHLY_V2_20260301\\OUT_FILTERED\\P2GC_MASTER_WITH_SEGMENTS.csv'
 ]
};
function s(v){return String(v??'').trim()}
function low(v){return s(v).toLowerCase()}
function k(v){return low(v).replace(/[^a-z0-9]/g,'')}
function money(v){if(v==null||s(v)==='')return null;const n=Number(String(v).replace(/[$,]/g,''));return Number.isFinite(n)?n:null}
function tier(n){return n==null?'UNKNOWN':n===0?'NO_SALES':n<3000000?'ONE_TO_LT_3M':n<10000000?'THREE_TO_LT_10M':'TEN_M_PLUS'}
function truthy(v){return /^(1|true|yes|y|active|certified|current|eligible)$/i.test(s(v))}
function parseLine(line){const out=[];let f='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(q){if(c==='"'&&line[i+1]==='"'){f+='"';i++}else if(c==='"')q=false;else f+=c}else{if(c==='"')q=true;else if(c===','){out.push(f);f=''}else f+=c}}out.push(f);return out}
function mapRow(headers,vals){const o={};for(let i=0;i<headers.length;i++)o[headers[i]]=vals[i]??'';return o}
function fm(o){const m={};for(const [a,b] of Object.entries(o||{}))m[k(a)]=b;return m}
function first(m,names){for(const n of names){const v=m[k(n)];if(s(v)!=='')return v}return null}
function ueiFrom(m){return low(first(m,['uei','uei_sam','recipient uei','UEI (Unique Entity Identifier)','norm_uei','uei_clean']))||null}
function nameFrom(m){return low(first(m,['legal_name','recipient name','business name','company','company_name','company_clean','name_clean']))||null}
function identity(m){const u=ueiFrom(m);return u?'UEI:'+u:null}
function pickExisting(list){return list.find(p=>fs.existsSync(p))||null}
async function streamCsv(file,onRow,maxRows=Infinity){const rs=fs.createReadStream(file,{encoding:'utf8'});const rl=readline.createInterface({input:rs,crlfDelay:Infinity});let headers=null,count=0;for await(const line of rl){if(!headers){headers=parseLine(line).map(s);continue}if(!line.trim())continue;const row=mapRow(headers,parseLine(line));await onRow(row);count++;if(count>=maxRows){rl.close();rs.destroy();break}}return{headers,count}}
function ensure(rec,id){if(!rec.has(id))rec.set(id,{id,families:new Set(),revenues:[],sources:new Set(),names:new Set(),evidence:[]});return rec.get(id)}
async function loadVehicle(rec,file){if(!file)return{file:null,rows:0,rowsWithoutUei:0};let rows=0,rowsWithoutUei=0;const meta=await streamCsv(file,row=>{const m=fm(row),id=identity(m);if(!id){rowsWithoutUei++;return}const vehicle=s(first(m,['vehicle','fed_vehicle','contract_vehicle'])).toUpperCase();const r=ensure(rec,id);const nm=nameFrom(m);if(nm)r.names.add(nm);r.sources.add(file);if(/\bGSA\b|\bMAS\b|MULTIPLE AWARD SCHEDULE/.test(vehicle)){r.families.add('GSA');r.evidence.push('VEHICLE:GSA')}if(/\bVA\b|\bFSS\b|VETERANS AFFAIRS|FEDERAL SUPPLY SCHEDULE/.test(vehicle)){r.families.add('VA_FSS');r.evidence.push('VEHICLE:VA_FSS')}rows++});return{file,rows,rowsWithoutUei,headers:meta.headers}}
async function loadRevenue(rec,file){if(!file)return{file:null,rows:0,rowsWithoutUei:0};let rows=0,rowsWithoutUei=0;const meta=await streamCsv(file,row=>{const m=fm(row),id=identity(m);if(!id){rowsWithoutUei++;return}const r=ensure(rec,id);const nm=nameFrom(m);if(nm)r.names.add(nm);r.sources.add(file);const rv=money(first(m,['Federal_Total_Revenue','NORMALIZED_REVENUE','federal_total_revenue','total_revenue','federal_revenue']));if(rv!=null)r.revenues.push(rv);rows++});return{file,rows,rowsWithoutUei,headers:meta.headers}}
async function loadCert(rec,file){if(!file)return{file:null,rows:0,rowsWithoutUei:0};let rows=0,rowsWithoutUei=0;const meta=await streamCsv(file,row=>{const m=fm(row),id=identity(m);if(!id){rowsWithoutUei++;return}const r=ensure(rec,id);const nm=nameFrom(m);if(nm)r.names.add(nm);r.sources.add(file);const blob=[first(m,['Active SBA certifications']),first(m,['Business type and self-certifications'])].map(s).join(' ').toUpperCase();const tests=[['SDVOSB',/SDVOSB|SERVICE[- ]DISABLED VETERAN/,['is_sdvosb']],['VOSB',/(^|\W)VOSB(\W|$)|VETERAN[- ]OWNED/,['is_vosb','Veteran-Owned Small Business (VOSB) certification status']],['WOSB',/WOSB|WOMEN[- ]OWNED/,['is_wosb','Women-Owned Small Business (WOSB) certification status']],['HUBZONE',/HUB ?ZONE/,['is_hubzone','HUBZone certification status']],['8A',/8\(A\)|(^|\W)8A(\W|$)/,['is_8a','8(a) certification status']]];for(const [fam,re,fields] of tests){if(re.test(blob)||fields.some(f=>truthy(first(m,[f])))){r.families.add(fam);r.evidence.push('CERT:'+fam)}}rows++});return{file,rows,rowsWithoutUei,headers:meta.headers}}
async function loadSam(rec,file){if(!file)return{file:null,rows:0,rowsWithoutUei:0};let rows=0,rowsWithoutUei=0;const meta=await streamCsv(file,row=>{const m=fm(row),id=identity(m);if(!id){rowsWithoutUei++;return}const r=ensure(rec,id);const nm=nameFrom(m);if(nm)r.names.add(nm);r.sources.add(file);if(truthy(first(m,['Small_Business_Flag']))||/SMALL BUSINESS/i.test(s(first(m,['Segment','Industry_Segment'])))){r.families.add('SBS_SAM');r.evidence.push('SAM:SMALL_BUSINESS')}rows++});return{file,rows,rowsWithoutUei,headers:meta.headers}}
function summarize(rec){const counts={};for(const f of FAMS)counts[f]=Object.fromEntries(TIERS.map(t=>[t,0]));let noFamily=0,unknownRev=0,conflict=0;const examples={noFamily:[],unknownRevenue:[],revenueConflict:[]};for(const r of rec.values()){if(!r.families.size){noFamily++;if(examples.noFamily.length<20)examples.noFamily.push({id:r.id,names:[...r.names]});continue}const vals=[...new Set(r.revenues.filter(v=>Number.isFinite(v)).map(Number))];if(vals.length>1){conflict++;if(examples.revenueConflict.length<20)examples.revenueConflict.push({id:r.id,values:vals.slice(0,10),families:[...r.families]})}const revenue=vals.length?Math.max(...vals):null;const t=tier(revenue);if(t==='UNKNOWN'){unknownRev++;if(examples.unknownRevenue.length<20)examples.unknownRevenue.push({id:r.id,families:[...r.families]})}for(const f of r.families)counts[f][t]++}return{uniqueEntities:rec.size,counts,noFamilyEntities:noFamily,unknownRevenueEntities:unknownRev,conflictingRevenueEntities:conflict,examples}}
async function run(){fs.mkdirSync(OUTDIR,{recursive:true});const rec=new Map();const selected={vehicle:pickExisting(SOURCE_CANDIDATES.vehicle),revenue:pickExisting(SOURCE_CANDIDATES.revenue),certification:pickExisting(SOURCE_CANDIDATES.certification),sam:pickExisting(SOURCE_CANDIDATES.sam)};const sourceStats={};sourceStats.vehicle=await loadVehicle(rec,selected.vehicle);sourceStats.revenue=await loadRevenue(rec,selected.revenue);sourceStats.certification=await loadCert(rec,selected.certification);sourceStats.sam=await loadSam(rec,selected.sam);const summary=summarize(rec);const sanity={gsaNoSalesExpectedUserRange:'~12k at best',vaFssNoSalesExpectedUserRange:'~3k-4k',gsaNoSalesObserved:summary.counts.GSA.NO_SALES,vaFssNoSalesObserved:summary.counts.VA_FSS.NO_SALES,gsaWithinExpectedRange:summary.counts.GSA.NO_SALES<=13000,vaWithinExpectedRange:summary.counts.VA_FSS.NO_SALES>=2500&&summary.counts.VA_FSS.NO_SALES<=5000};const missingSources=Object.entries(selected).filter(([,v])=>!v).map(([k])=>k);const result={ok:true,gate:'P1.5K7_FEDERAL_SOURCE_TRUTH_RECONSTRUCTION',version:'1.1-read-only-strict-uei-source-separated',generatedAt:new Date().toISOString(),selectedSources:selected,missingSources,sourceStats,joinPolicy:'STRICT_UEI_ONLY_NO_NAME_FALLBACK',sourceSeparation:{vehicle:'vehicle family truth only',revenue:'award/revenue truth only',certification:'certification truth only',sam:'SAM/small-business truth only'},revenueTierPolicy:{NO_SALES:'$0',ONE_TO_LT_3M:'$1 to <$3M',THREE_TO_LT_10M:'$3M to <$10M',TEN_M_PLUS:'$10M+',UNKNOWN:'no trustworthy revenue found in selected revenue source'},reconstruction:summary,sanity,authoritativeEnoughToResegment:missingSources.length===0&&summary.uniqueEntities>0&&summary.conflictingRevenueEntities===0&&sanity.gsaWithinExpectedRange&&sanity.vaWithinExpectedRange,liveCampaignsMutated:false,nextAction:'IF_ALL_SOURCES_PRESENT_AND_SANITY_PASSES_BUILD_GOVERNED_SEGMENT_ARTIFACTS; OTHERWISE INSPECT SOURCE EVIDENCE BEFORE ANY LIVE MUTATION',outputFile:SUMMARY};fs.writeFileSync(SUMMARY,JSON.stringify(result,null,2));return result}
module.exports={run};if(require.main===module)run().then(r=>console.dir(r,{depth:10})).catch(e=>{console.error(e);process.exit(1)});
