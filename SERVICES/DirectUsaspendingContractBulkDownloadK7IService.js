'use strict';
const fs=require('fs');
const path=require('path');
const {Readable}=require('stream');
const {pipeline}=require('stream/promises');

const API='https://api.usaspending.gov/api/v2/bulk_download/awards/';
const START='2026-02-01';
const END='2026-08-12';
const CONTRACT_CODES=['A','B','C','D','IDV_A','IDV_B','IDV_B_A','IDV_B_B','IDV_B_C','IDV_C','IDV_D','IDV_E'];
const DOWNLOADS=process.env.USERPROFILE?path.join(process.env.USERPROFILE,'Downloads'):process.cwd();

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function jsonFetch(url,options={}){
  const r=await fetch(url,options);
  const text=await r.text();
  let data; try{data=JSON.parse(text);}catch{data={detail:text};}
  if(!r.ok)throw new Error(`HTTP ${r.status} ${url}: ${typeof data.detail==='string'?data.detail:JSON.stringify(data)}`);
  return data;
}

function requestBody(level){
  const filters={
    agency:'all',
    date_type:'action_date',
    date_range:{start_date:START,end_date:END}
  };
  if(level==='prime_awards') filters.prime_award_types=CONTRACT_CODES;
  if(level==='sub_awards') filters.sub_award_types=['procurement'];
  return {
    award_levels:[level],
    constraint_type:'year',
    filters,
    file_format:'csv'
  };
}

async function submit(level){
  console.log(`[K7I] submitting ${level} ${START}..${END}`);
  const data=await jsonFetch(API,{
    method:'POST',
    headers:{'content-type':'application/json','user-agent':'MILES-P2GC-K7I/1.0'},
    body:JSON.stringify(requestBody(level))
  });
  if(!data.file_url||!data.file_name)throw new Error(`USAspending bulk response missing file_url/file_name for ${level}: ${JSON.stringify(data)}`);
  return data;
}

function statusDone(j){
  const s=String(j?.status||j?.job_status||j?.message||'').toLowerCase();
  const p=Number(j?.progress||j?.percent_complete||j?.percentage||0);
  return /finish|complete|success|ready/.test(s)||p>=100;
}
function statusFailed(j){
  const s=String(j?.status||j?.job_status||j?.message||'').toLowerCase();
  return /fail|error|cancel/.test(s);
}

async function waitReady(job,opts={}){
  const pollMs=Math.max(5000,Number(opts.pollMs)||15000);
  const maxPolls=Math.max(20,Number(opts.maxPolls)||240);
  for(let i=1;i<=maxPolls;i++){
    let stat=null;
    try{ if(job.status_url) stat=await jsonFetch(job.status_url,{headers:{'user-agent':'MILES-P2GC-K7I/1.0'}}); }catch(e){ console.log(`[K7I] status poll ${i}: ${e.message}`); }
    if(stat){
      const label=stat.status||stat.job_status||stat.message||stat.progress||'pending';
      console.log(`[K7I] ${job.file_name} poll ${i}: ${label}`);
      if(statusFailed(stat))throw new Error(`USAspending generation failed for ${job.file_name}: ${JSON.stringify(stat)}`);
    }
    try{
      const r=await fetch(job.file_url,{method:'GET',headers:{'user-agent':'MILES-P2GC-K7I/1.0'}});
      if(r.ok){
        const ct=String(r.headers.get('content-type')||'').toLowerCase();
        const len=Number(r.headers.get('content-length')||0);
        if(/zip|octet-stream/.test(ct)||len>1000||statusDone(stat)) return r;
      }
    }catch{}
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for ${job.file_name}`);
}

async function downloadJob(job,level,opts={}){
  const response=await waitReady(job,opts);
  fs.mkdirSync(DOWNLOADS,{recursive:true});
  const safe=`USASPENDING_${level.toUpperCase()}_CONTRACTS_${START}_TO_${END}_${path.basename(job.file_name)}`.replace(/[^A-Za-z0-9_.-]+/g,'_');
  const dest=path.join(DOWNLOADS,safe.endsWith('.zip')?safe:`${safe}.zip`);
  const body=Readable.fromWeb(response.body);
  await pipeline(body,fs.createWriteStream(dest));
  const st=fs.statSync(dest);
  if(st.size<1000)throw new Error(`Downloaded file too small (${st.size} bytes): ${dest}`);
  console.log(`[K7I] saved ${level}: ${dest} (${st.size} bytes)`);
  return {level,path:dest,size:st.size,fileName:path.basename(dest),sourceFileUrl:job.file_url,statusUrl:job.status_url||null};
}

async function run(opts={}){
  const primeJob=await submit('prime_awards');
  const subJob=await submit('sub_awards');
  const prime=await downloadJob(primeJob,'prime_awards',opts);
  const sub=await downloadJob(subJob,'sub_awards',opts);
  return {
    ok:true,
    gate:'P1.5K7I_DIRECT_USASPENDING_CONTRACT_BULK_DOWNLOAD',
    version:'1.0',
    generatedAt:new Date().toISOString(),
    dateRange:{start:START,end:END},
    scope:{prime:'contracts + contract IDVs only',sub:'procurement subawards/subcontracts only',excluded:'assistance/grants/loans/direct payments'},
    files:{prime,sub},
    nextAction:'RUN_K7H_BULK_LOCAL_RECONSTRUCTION'
  };
}
module.exports={run};