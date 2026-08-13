'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || process.cwd();
const INPUT = path.join(ROOT,'DATA','OUTBOUND','FEDERAL_VA_FSS_GOVERNED','FEDERAL_VA_FSS_MASTER_CLEAN.csv');
const OUT_DIR = path.join(ROOT,'DATA','OUTBOUND','FEDERAL_VA_FSS_GOVERNED');
const OUTPUT = path.join(OUT_DIR,'FEDERAL_VA_FSS_REVENUE_ENRICHED.csv');
const SUMMARY = path.join(OUT_DIR,'FEDERAL_VA_FSS_REVENUE_ENRICHMENT_SUMMARY.json');

function norm(v){return String(v??'').trim();}
function upper(v){return norm(v).toUpperCase();}
function normName(v){return upper(v).replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function parseCsvLine(line){const out=[];let cur='';let q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===','&&!q){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out;}
function readCsv(file){const lines=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());if(lines.length<2)return[];const h=parseCsvLine(lines[0]);return lines.slice(1).map(line=>{const v=parseCsvLine(line);const r={};h.forEach((x,i)=>r[x]=v[i]??'');return r;});}
function esc(v){const s=String(v??'');return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function writeCsv(file,rows,headers){const lines=[headers.join(',')];for(const r of rows)lines.push(headers.map(h=>esc(r[h])).join(','));fs.writeFileSync(file,lines.join('\n'),'utf8');}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function bucket(revenue, matched){if(!matched||revenue===null)return 'VA_REVENUE_UNKNOWN';if(revenue===0)return 'VA_NO_SALES';if(revenue>0&&revenue<=500000)return 'VA_0_TO_500K';if(revenue>500000&&revenue<3000000)return 'VA_501K_TO_LT3M';if(revenue>=3000000&&revenue<5000000)return 'VA_3_TO_LT5M';if(revenue>=5000000)return 'VA_5M_PLUS';return 'VA_REVENUE_UNKNOWN';}

async function run(){
  if(!fs.existsSync(INPUT)) throw new Error(`Missing input: ${INPUT}`);
  const orion=require('../CONNECTORS/ORION/connector');
  const init=orion.initialize();
  if(!init?.ok) throw new Error(init?.message||'ORION initialization failed');
  const rows=readCsv(INPUT);
  const out=[];
  const stats={inputRows:rows.length,matchedByUei:0,matchedByExactName:0,unmatched:0,ambiguousName:0,buckets:{}};

  for(const row of rows){
    const uei=upper(row.sam_uei||row.uei||row.SAM_UEI||row['SAM UEI']);
    const vendor=norm(row.vendor||row.Vendor||row.vendor_name);
    let candidates=[]; let match=null; let method='UNMATCHED';
    if(uei){
      candidates=orion.searchContractors(uei,10)||[];
      const exact=candidates.filter(x=>upper(x?.uei)===uei);
      if(exact.length===1){match=exact[0];method='EXACT_UEI';stats.matchedByUei++;}
    }
    if(!match&&vendor){
      candidates=orion.searchContractors(vendor,25)||[];
      const target=normName(vendor);
      const exact=candidates.filter(x=>normName(x?.company)===target||normName(x?.company_norm)===target);
      if(exact.length===1){match=exact[0];method='EXACT_NAME';stats.matchedByExactName++;}
      else if(exact.length>1){method='AMBIGUOUS_EXACT_NAME';stats.ambiguousName++;}
    }
    if(!match&&method!=='AMBIGUOUS_EXACT_NAME')stats.unmatched++;
    const revenue=match?num(match.federal_revenue):null;
    const awardCount=match?num(match.award_count):null;
    const b=bucket(revenue,Boolean(match));
    stats.buckets[b]=(stats.buckets[b]||0)+1;
    out.push({...row,orion_match_method:method,orion_contractor_id:match?.id||'',orion_uei:match?.uei||'',federal_revenue:revenue??'',award_count:awardCount??'',va_fss_campaign_bucket:b,revenue_source:match?'ORION_CONTRACTOR_RECORD':'UNRESOLVED'});
  }

  fs.mkdirSync(OUT_DIR,{recursive:true});
  const headers=[...new Set(out.flatMap(r=>Object.keys(r)))];
  writeCsv(OUTPUT,out,headers);
  const summary={ok:true,gate:'FEDERAL_VA_FSS_REVENUE_ENRICHMENT_READ_ONLY',generatedAt:new Date().toISOString(),namespace:'FEDERAL_VA_FSS',stateVirginiaSledExcluded:true,...stats,outputCsv:OUTPUT,safety:{readOnly:true,writesToInstantly:false,campaignMutations:false,fuzzyMatching:false},nextAction:'REVIEW_MATCH_RATE_THEN_BUILD_GOVERNED_VA_FSS_CAMPAIGN_ASSIGNMENTS'};
  fs.writeFileSync(SUMMARY,JSON.stringify(summary,null,2),'utf8');
  console.log(JSON.stringify(summary,null,2));
}

run().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
