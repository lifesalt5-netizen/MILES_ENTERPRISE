'use strict';
const fs=require('fs');
const path=require('path');

const OUT=path.join(process.cwd(),'DATA','OUTBOUND','FEDERAL_ORION_BASELINE_K7J');
const VALIDATED_REVENUE='D:\\P2GC_Intelligence\\ORION_CORE\\Opportunity_Engine\\Input\\contract_award_summary.csv';
const GSA_CANDIDATES=[
  'D:\\P2GC_Intelligence\\MILES_ENTERPRISE\\DATA\\staging\\government_data\\gsa_holder_snapshot\\GSA-HOLDERS-2026-07-2026-07-28T02-41-25-700Z\\gsa_elibrary_schedule_MAS.csv',
  path.join(process.cwd(),'DATA','staging','government_data','gsa_holder_snapshot','GSA-HOLDERS-2026-07-2026-07-28T02-41-25-700Z','gsa_elibrary_schedule_MAS.csv')
];
const VA_CP=path.join(process.cwd(),'DATA','staging','government_data','K7F_VA_FSS_BULK_AWARD_REFRESH','VA_FSS_UEI_RESOLUTION_CHECKPOINT_V15.json');

function parseCsvLine(s){let a=[],x='',q=false;for(let i=0;i<s.length;i++){let c=s[i];if(c==='"'){if(q&&s[i+1]==='"'){x+='"';i++;}else q=!q;}else if(c===','&&!q){a.push(x);x='';}else x+=c;}a.push(x);return a;}
function normHeader(s){return String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');}
function number(v){const n=Number(String(v??'').replace(/[$,]/g,'').trim());return Number.isFinite(n)?n:null;}
function tier(rev){if(rev===null||rev===undefined)return 'UNKNOWN';if(rev<=0)return 'NO_SALES';if(rev<3000000)return '1_TO_LT3M';if(rev<10000000)return '3_TO_LT10M';return '10M_PLUS';}
function firstExisting(list){for(const p of list)if(fs.existsSync(p))return p;return null;}
function loadRevenue(){
  const p=VALIDATED_REVENUE;
  if(!fs.existsSync(p))throw new Error(`VALIDATED_ORION_REVENUE_FILE_NOT_FOUND: ${p}`);
  const lines=fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean);
  const h=parseCsvLine(lines[0]).map(normHeader);
  const ui=h.indexOf('recipient_uei');
  const ri=h.indexOf('federal_total_revenue');
  const ai=h.indexOf('federal_award_count');
  if(ui<0||ri<0)throw new Error(`VALIDATED_ORION_REQUIRED_COLUMNS_MISSING uei=${ui} revenue=${ri}`);
  const m=new Map(); let zero=0,positive=0,blank=0,sum=0;
  for(let i=1;i<lines.length;i++){
    const r=parseCsvLine(lines[i]);
    const u=String(r[ui]||'').trim().toUpperCase(); if(!u)continue;
    const n=number(r[ri]);
    if(n===null){blank++;continue;}
    if(n<=0)zero++; else {positive++;sum+=n;}
    const awards=ai>=0?number(r[ai]):null;
    m.set(u,{revenue:n,awardCount:awards});
  }
  const positiveRate=(positive+zero)>0?positive/(positive+zero):0;
  if(m.size<50000||positive<40000||positiveRate<0.75)throw new Error(`VALIDATED_ORION_REVENUE_QUALITY_GATE_FAILED unique=${m.size} positive=${positive} positiveRate=${positiveRate}`);
  return {path:p,map:m,rows:lines.length-1,uniqueUei:m.size,zero,positive,blank,positiveRate,positiveSum:sum,revenueColumn:h[ri],awardCountColumn:ai>=0?h[ai]:null};
}
function loadGsa(){const p=firstExisting(GSA_CANDIDATES);if(!p)throw new Error('CONFIRMED_GSA_SNAPSHOT_NOT_FOUND');const lines=fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean);const h=parseCsvLine(lines[0]).map(normHeader);let ui=h.indexOf('sam_uei');if(ui<0)ui=h.indexOf('uei');const s=new Set();for(let i=1;i<lines.length;i++){const u=String(parseCsvLine(lines[i])[ui]||'').trim().toUpperCase();if(u)s.add(u);}return {path:p,ueis:s};}
function loadVa(){if(!fs.existsSync(VA_CP))throw new Error('VALIDATED_VA_UEI_CHECKPOINT_NOT_FOUND');const j=JSON.parse(fs.readFileSync(VA_CP,'utf8'));const s=new Set(Object.values(j.rows||{}).map(x=>String(x.uei||'').trim().toUpperCase()).filter(Boolean));return {path:VA_CP,ueis:s};}
function summarize(label,ueis,revenue){const c={NO_SALES:0,'1_TO_LT3M':0,'3_TO_LT10M':0,'10M_PLUS':0,UNKNOWN:0,total:ueis.size,matchedRevenueTruth:0};for(const u of ueis){const rec=revenue.get(u);if(rec)c.matchedRevenueTruth++;const t=tier(rec?rec.revenue:null);c[t]++;}c.matchRate=ueis.size?c.matchedRevenueTruth/ueis.size:0;return {family:label,...c};}
function writeSegmentFiles(label,ueis,revenue){const buckets={NO_SALES:[], '1_TO_LT3M':[], '3_TO_LT10M':[], '10M_PLUS':[], UNKNOWN:[]};for(const u of ueis){const rec=revenue.get(u);const rev=rec?rec.revenue:null;const t=tier(rev);buckets[t].push({uei:u,revenue:rev,awardCount:rec?rec.awardCount:null});}for(const [t,rows] of Object.entries(buckets)){const p=path.join(OUT,`${label}_${t}.csv`);fs.writeFileSync(p,['uei,orion_baseline_revenue,award_count,revenue_tier,source_status',...rows.map(r=>`${r.uei},${r.revenue??''},${r.awardCount??''},${t},ORION_CONTRACT_AWARD_SUMMARY_BASELINE`).join('\n')].join('\n'));}return Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,v.length]));}
async function run(){
  fs.mkdirSync(OUT,{recursive:true});
  const rev=loadRevenue(); const gsa=loadGsa(); const va=loadVa();
  const gsaSummary=summarize('GSA',gsa.ueis,rev.map); const vaSummary=summarize('VA_FSS',va.ueis,rev.map);
  writeSegmentFiles('GSA',gsa.ueis,rev.map); writeSegmentFiles('VA_FSS',va.ueis,rev.map);
  const sanity={gsaNoSalesExpectedApprox:'~12K or less (sanity only, not forced)',vaFssNoSalesExpectedApprox:'~3K-4K for full roster (sanity only; current UEI resolution is partial)'};
  const result={ok:true,gate:'P1.5K7J_ORION_BASELINE_FEDERAL_SEGMENTATION',version:'1.1-validated-contract-award-summary',generatedAt:new Date().toISOString(),dataPolicy:'TEMPORARY_BASELINE_USE_VALIDATED_ORION_CONTRACT_AWARD_SUMMARY; FEB_2026_FORWARD_CATCHUP_DEFERRED',sourceTruth:{revenue:{path:rev.path,rows:rev.rows,uniqueUei:rev.uniqueUei,revenueColumn:rev.revenueColumn,awardCountColumn:rev.awardCountColumn,zero:rev.zero,positive:rev.positive,blank:rev.blank,positiveRate:rev.positiveRate,positiveSum:rev.positiveSum,status:'VALIDATED_ORION_BASELINE_NOT_FULLY_CURRENT'},gsa:{path:gsa.path,uniqueUei:gsa.ueis.size,status:'FRESH_ROSTER'},vaFss:{path:va.path,uniqueUei:va.ueis.size,status:'AUTHORITATIVE_ROSTER_PARTIAL_UEI_RESOLUTION'}},segments:{GSA:gsaSummary,VA_FSS:vaSummary},sanityChecks:sanity,outputDir:OUT,liveCampaignsMutated:false,authoritativeEnoughToResegment:false,nextAction:'VALIDATE_GSA_VA_COUNTS_AND_MATCH_RATES; THEN EXTEND SAME REVENUE BASELINE TO CERTIFICATIONS_AND_SAM_SBS BEFORE ANY LIVE INSTANTLY RESEGMENTATION'};
  fs.writeFileSync(path.join(OUT,'K7J_SUMMARY.json'),JSON.stringify(result,null,2)); return result;
}
module.exports={run};