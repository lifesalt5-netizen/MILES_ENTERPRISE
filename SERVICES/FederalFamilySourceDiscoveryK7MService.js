'use strict';
const fs=require('fs');
const path=require('path');

const ROOTS=[
  'D:\\P2GC_Intelligence\\ORION\\Outbound_Segments',
  'D:\\P2GC_Intelligence\\ORION_CORE\\Good Files to use',
  'D:\\P2GC_Intelligence\\ORION_CORE',
  'D:\\P2GC_Intelligence\\ORION'
];
const FAMILIES={
  SDVOSB:['sdvosb','service_disabled_veteran','service disabled veteran'],
  VOSB:['vosb','veteran_owned','veteran owned'],
  WOSB:['wosb','women_owned','woman_owned','women owned','woman owned'],
  HUBZONE:['hubzone','hub_zone','hub zone'],
  EIGHT_A:['8a','8_a','8(a)','eight_a','eight a'],
  SAM:['sam_','sam ','sam-','sam_no_sales','sam_low_sales','sam_growth','sam_high_growth'],
  SBS:['sbs','dsbs','dynamic_small_business_search','dynamic small business search']
};

function norm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_');}
function csvLine(s){let a=[],x='',q=false;for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(q&&s[i+1]==='"'){x+='"';i++;}else q=!q;}else if(c===','&&!q){a.push(x);x='';}else x+=c;}a.push(x);return a;}
function walk(root,maxDepth=4){const out=[];if(!fs.existsSync(root))return out;function rec(dir,d){if(d>maxDepth)return;let ents=[];try{ents=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}for(const e of ents){const p=path.join(dir,e.name);if(e.isDirectory())rec(p,d+1);else if(e.isFile()&&/\.csv$/i.test(e.name))out.push(p);}}rec(root,0);return out;}
function inspect(p){let fd;try{fd=fs.openSync(p,'r');const b=Buffer.alloc(65536);const n=fs.readSync(fd,b,0,b.length,0);const text=b.toString('utf8',0,n).replace(/^\uFEFF/,'');const first=text.split(/\r?\n/)[0]||'';const headers=csvLine(first);const hn=headers.map(norm);const ueiIndex=hn.findIndex(h=>['uei','sam_uei','recipient_uei','unique_entity_id'].includes(h));const st=fs.statSync(p);return {path:p,mtime:st.mtime.toISOString(),size:st.size,headers,hasUei:ueiIndex>=0};}catch{return null;}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}}
function scoreFamily(meta,family){const np=norm(meta.path);const keys=FAMILIES[family].map(norm);let score=0;for(const k of keys){if(np.includes(k))score+=30;for(const h of meta.headers.map(norm))if(h.includes(k))score+=8;}if(meta.hasUei)score+=25;if(/master|validated|clean|final|targets|segment/.test(np))score+=5;if(/backup|archive|old|test|sample/.test(np))score-=20;return score;}

async function run(){
 const files=[...new Set(ROOTS.flatMap(r=>walk(r)))];
 const metas=files.map(inspect).filter(Boolean);
 const results={};
 for(const family of Object.keys(FAMILIES)){
   const ranked=metas.map(m=>({...m,score:scoreFamily(m,family)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||new Date(b.mtime)-new Date(a.mtime)).slice(0,15);
   results[family]={best:ranked.find(x=>x.hasUei)||null,candidates:ranked};
 }
 const summary={ok:true,gate:'P1.5K7M_FEDERAL_FAMILY_SOURCE_DISCOVERY',version:'1.0-read-only',generatedAt:new Date().toISOString(),roots:ROOTS,filesScanned:metas.length,families:results,liveCampaignsMutated:false,nextAction:'REVIEW_BEST_SOURCE_PER_FAMILY; THEN JOIN_TO_VALIDATED_CONTRACT_AWARD_SUMMARY_AND_REBUILD_K7L'};
 const out=path.join(process.cwd(),'DATA','OUTBOUND','FEDERAL_ORION_BASELINE_K7L');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'K7M_FAMILY_SOURCE_DISCOVERY.json'),JSON.stringify(summary,null,2));return summary;
}
module.exports={run};