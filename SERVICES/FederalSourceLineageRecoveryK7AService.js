'use strict';
/*
 P1.5K7A — Federal Source Lineage Recovery
 READ ONLY. No Instantly mutation. No canonical-data mutation.
 Purpose: locate the freshest GSA/VA/FSS/certification/award datasets already on disk,
 inspect field distributions, UEI coverage, recency and source lineage, and identify
 why refreshed source truth was not promoted into the K7-selected canonical files.
*/
const fs=require('fs');
const path=require('path');
const readline=require('readline');
const ROOT=process.cwd();
const OUTDIR=path.join(ROOT,'DATA','OUTBOUND','FEDERAL_SOURCE_TRUTH_K7A');
const SUMMARY=path.join(OUTDIR,'FEDERAL_SOURCE_LINEAGE_K7A_SUMMARY.json');
const ROOTS=[
 'D:\\P2GC_Intelligence',
 'D:\\P2GC_Intelligence\\ORION_CORE',
 'D:\\P2GC_Intelligence\\SAM_Registry',
 'D:\\P2GC_Intelligence\\CONSOLIDATION OF LEADS',
 'D:\\P2GC_Intelligence\\ARCHIVE_2026_REVIEW'
];
const NAME_RE=/(gsa|mas|fss|va_|va-|veteran|schedule|sam|sbs|award|usaspending|fpds|subcontract|recipient|prime|federal|segment|contractor)/i;
const MAX_FILES=5000, MAX_BYTES=4*1024*1024*1024, SAMPLE_ROWS=25000, TOP_VALUES=25;
function s(v){return String(v??'').trim()}
function k(v){return s(v).toLowerCase().replace(/[^a-z0-9]/g,'')}
function money(v){if(v==null||s(v)==='')return null;const n=Number(String(v).replace(/[$,]/g,''));return Number.isFinite(n)?n:null}
function parseLine(line){const out=[];let f='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(q){if(c==='"'&&line[i+1]==='"'){f+='"';i++}else if(c==='"')q=false;else f+=c}else{if(c==='"')q=true;else if(c===','){out.push(f);f=''}else f+=c}}out.push(f);return out}
function mapHeaders(h){const m={};h.forEach((x,i)=>m[k(x)]=i);return m}
function firstIdx(m,names){for(const n of names){const i=m[k(n)];if(i!==undefined)return i}return -1}
function addTop(map,v){v=s(v);if(!v)return;map.set(v,(map.get(v)||0)+1)}
function tops(map){return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,TOP_VALUES).map(([value,count])=>({value,count}))}
function walk(dir,out,seen){if(out.length>=MAX_FILES||seen.has(dir)||!fs.existsSync(dir))return;seen.add(dir);let ents;try{ents=fs.readdirSync(dir,{withFileTypes:true})}catch{return}for(const e of ents){if(out.length>=MAX_FILES)break;const p=path.join(dir,e.name);if(e.isDirectory()){if(!/node_modules|\.git|BACKUP|backup/i.test(e.name))walk(p,out,seen)}else if(e.isFile()&&/\.(csv|json|jsonl|txt)$/i.test(e.name)&&NAME_RE.test(p)){try{const st=fs.statSync(p);if(st.size<=MAX_BYTES)out.push({path:p,size:st.size,mtime:st.mtime.toISOString()})}catch{}}}}
async function inspectCsv(meta){const rs=fs.createReadStream(meta.path,{encoding:'utf8'});const rl=readline.createInterface({input:rs,crlfDelay:Infinity});let headers=null,hm=null,rows=0,ueiNonBlank=0,ueiUnique=new Set(),revSeen=0,revZero=0,revPos=0;const topVehicle=new Map(),topSegment=new Map(),topRevenueBand=new Map(),topSmallBusiness=new Map();let ueiI=-1,vehI=-1,segI=-1,revI=-1,bandI=-1,sbI=-1;try{for await(const line of rl){if(!headers){headers=parseLine(line).map(s);hm=mapHeaders(headers);ueiI=firstIdx(hm,['uei','uei_sam','recipient uei','UEI (Unique Entity Identifier)','norm_uei','uei_clean']);vehI=firstIdx(hm,['vehicle','fed_vehicle','contract_vehicle','schedule','contract vehicle']);segI=firstIdx(hm,['segment','govcon_performance_segment','evan_segment','industry_segment']);revI=firstIdx(hm,['Federal_Total_Revenue','NORMALIZED_REVENUE','federal_total_revenue','total_revenue','federal_revenue','award_amount','obligated_amount']);bandI=firstIdx(hm,['Revenue_Band','revenue band']);sbI=firstIdx(hm,['Small_Business_Flag','small business flag']);continue}if(!line.trim())continue;const v=parseLine(line);rows++;if(ueiI>=0&&s(v[ueiI])){ueiNonBlank++;if(ueiUnique.size<2000000)ueiUnique.add(s(v[ueiI]).toLowerCase())}if(vehI>=0)addTop(topVehicle,v[vehI]);if(segI>=0)addTop(topSegment,v[segI]);if(bandI>=0)addTop(topRevenueBand,v[bandI]);if(sbI>=0)addTop(topSmallBusiness,v[sbI]);if(revI>=0){const n=money(v[revI]);if(n!=null){revSeen++;if(n===0)revZero++;else if(n>0)revPos++}}if(rows>=SAMPLE_ROWS){rl.close();rs.destroy();break}}
}catch(e){return{...meta,error:e.message}}
const lowerHeaders=(headers||[]).map(x=>x.toLowerCase());const signals={hasUei:ueiI>=0,hasVehicle:vehI>=0,hasSegment:segI>=0,hasRevenue:revI>=0,hasRevenueBand:bandI>=0,hasSmallBusiness:sbI>=0,hasGsaHeader:lowerHeaders.some(x=>/gsa|mas|schedule/.test(x)),hasVaFssHeader:lowerHeaders.some(x=>/va|fss|veteran/.test(x)),hasAwardHeader:lowerHeaders.some(x=>/award|obligat|revenue|fpds|usaspending/.test(x)),hasCertHeader:lowerHeaders.some(x=>/sdvosb|vosb|wosb|hubzone|8\(a\)|certif/.test(x))};
let score=0;score+=signals.hasUei?15:0;score+=signals.hasVehicle?12:0;score+=signals.hasRevenue?12:0;score+=signals.hasAwardHeader?12:0;score+=signals.hasGsaHeader?8:0;score+=signals.hasVaFssHeader?8:0;score+=signals.hasCertHeader?8:0;score+=NAME_RE.test(meta.path)?5:0;score+=Math.max(0,10-Math.floor((Date.now()-Date.parse(meta.mtime))/(86400000*30)));
return{...meta,score,headers,rowsSampled:rows,uei:{nonBlank:ueiNonBlank,uniqueInSample:ueiUnique.size},signals,revenueSample:{nonBlankNumeric:revSeen,zero:revZero,positive:revPos},topValues:{vehicle:tops(topVehicle),segment:tops(topSegment),revenueBand:tops(topRevenueBand),smallBusiness:tops(topSmallBusiness)}}}
async function run(){fs.mkdirSync(OUTDIR,{recursive:true});const files=[],seen=new Set();for(const r of ROOTS)walk(r,files,seen);const csv=files.filter(f=>/\.csv$/i.test(f.path)).sort((a,b)=>Date.parse(b.mtime)-Date.parse(a.mtime));const inspected=[];for(const f of csv)inspected.push(await inspectCsv(f));inspected.sort((a,b)=>(b.score||0)-(a.score||0)||Date.parse(b.mtime)-Date.parse(a.mtime));const classify=x=>({
 gsa:/gsa|\bmas\b|schedule/i.test(x.path)||x.signals?.hasGsaHeader,
 va:/fss|veteran|\\va[_\\-]/i.test(x.path)||x.signals?.hasVaFssHeader,
 award:/award|usaspending|fpds|subcontract|prime|recipient/i.test(x.path)||x.signals?.hasAwardHeader,
 cert:/sbs|cert|sdvosb|vosb|wosb|hubzone|8a/i.test(x.path)||x.signals?.hasCertHeader
});
const ranked={gsa:[],vaFss:[],awardRevenue:[],certification:[]};for(const x of inspected){const c=classify(x);if(c.gsa&&ranked.gsa.length<25)ranked.gsa.push(x);if(c.va&&ranked.vaFss.length<25)ranked.vaFss.push(x);if(c.award&&ranked.awardRevenue.length<25)ranked.awardRevenue.push(x);if(c.cert&&ranked.certification.length<25)ranked.certification.push(x)}
const k7Selected=['D:\\P2GC_Intelligence\\ORION_CORE\\P2GC_FINAL_SEGMENTED.csv','D:\\P2GC_Intelligence\\SAM_Registry\\SAM_PUBLIC_MONTHLY_V2_20260301\\OUT_FILTERED\\P2GC_EVAN_SEGMENTED_MASTER_V2.csv','D:\\P2GC_Intelligence\\CONSOLIDATION OF LEADS\\MASTER\\SBS_SEGMENTED_TARGETS.csv','D:\\P2GC_Intelligence\\SAM_Registry\\SAM_PUBLIC_MONTHLY_V2_20260301\\OUT_FILTERED\\P2GC_MASTER_WITH_SEGMENTS.csv'];
const selectedInspection=inspected.filter(x=>k7Selected.some(p=>p.toLowerCase()===x.path.toLowerCase()));
const result={ok:true,gate:'P1.5K7A_FEDERAL_SOURCE_LINEAGE_RECOVERY',version:'1.0-read-only',generatedAt:new Date().toISOString(),rootsScanned:ROOTS.filter(fs.existsSync),candidateFilesFound:files.length,csvInspected:inspected.length,sampleRowsPerFile:SAMPLE_ROWS,k7SelectedInspection:selectedInspection,rankedCandidates:ranked,decision:'DO_NOT_RESEGMENT_UNTIL_LINEAGE_RECOVERED',liveCampaignsMutated:false,nextAction:'REVIEW_TOP_RANKED_GSA_VA_FSS_AWARD_CANDIDATES; IDENTIFY_FRESHEST_AUTHORITATIVE_FILES; THEN REGISTER_EXPLICIT_CANONICAL_SOURCES_AND REBUILD UEI MASTER'};fs.writeFileSync(SUMMARY,JSON.stringify(result,null,2));return result}
module.exports={run};if(require.main===module)run().then(r=>console.dir(r,{depth:8,maxArrayLength:30})).catch(e=>{console.error(e);process.exit(1)});
