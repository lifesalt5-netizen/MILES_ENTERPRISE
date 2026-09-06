'use strict';

const fs=require('fs');
const path=require('path');
const http=require('http');
const {execFileSync}=require('child_process');

const ROOT=path.resolve(__dirname,'..');
const REQUIRED=[
  'SERVICES/revenue/P2GCMarketingSalesOperatingPolicy.js',
  'SERVICES/revenue/P2GCCompanySpecificOutboundPipelineService.js',
  'SERVICES/revenue/P2GCPrivateDiagnosticHttpController.js',
  'SERVICES/private_diagnostic/public/diagnostic.js',
  'SERVICES/private_diagnostic/public/diagnostic.html',
  'SERVICES/private_diagnostic/public/diagnostic.css',
  'StartP2GCCustomerDelivery.js',
  'TESTS/p2gc_private_diagnostic_gate.test.js'
];

function fail(message,details){console.error(`P2GC_PRIVATE_DIAGNOSTIC_DEPLOY_RED: ${message}`);if(details)console.error(details);process.exit(2);}
function shell(){return process.env.ComSpec||'cmd.exe';}
function runPm2(args,stdio='pipe'){return execFileSync(shell(),['/d','/s','/c','pm2.cmd',...args],{cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:stdio==='inherit'?'inherit':['ignore','pipe','pipe']});}
function getJson(url,timeout=6000){return new Promise((resolve,reject)=>{const req=http.get(url,{timeout},res=>{let body='';res.setEncoding('utf8');res.on('data',c=>body+=c);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(new Error(`HTTP_${res.statusCode}:${body.slice(0,300)}`));try{resolve({statusCode:res.statusCode,headers:res.headers,body:JSON.parse(body)});}catch{resolve({statusCode:res.statusCode,headers:res.headers,body});}});});req.on('timeout',()=>req.destroy(new Error('HTTP_TIMEOUT')));req.on('error',reject);});}
async function wait(url,predicate,timeoutMs=45000){const deadline=Date.now()+timeoutMs;let last=null;while(Date.now()<deadline){try{const r=await getJson(url);if(!predicate||predicate(r))return r;last=new Error('PREDICATE_FAILED');}catch(e){last=e;}await new Promise(r=>setTimeout(r,1200));}throw last||new Error('WAIT_TIMEOUT');}

async function main(){
  for(const rel of REQUIRED){const file=path.join(ROOT,rel);if(!fs.existsSync(file))fail(`Missing required file: ${rel}`);}
  for(const rel of REQUIRED.filter(x=>x.endsWith('.js'))){try{execFileSync(process.execPath,['--check',path.join(ROOT,rel)],{cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});}catch(e){fail(`Syntax check failed: ${rel}`,String(e.stderr||e.stdout||e.message));}}
  try{execFileSync(process.execPath,[path.join(ROOT,'TESTS','p2gc_private_diagnostic_gate.test.js')],{cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});}catch(e){fail('Private diagnostic acceptance test failed',String(e.stderr||e.stdout||e.message));}
  if(process.platform!=='win32'){
    console.log(JSON.stringify({ok:true,status:'P2GC_PRIVATE_DIAGNOSTIC_SOURCE_GREEN_RUNTIME_RESTART_SKIPPED_NON_WINDOWS'},null,2));return;
  }
  let list;try{list=JSON.parse(runPm2(['jlist']));}catch(e){fail('Unable to read PM2 application state',e.message);}
  const app=(Array.isArray(list)?list:[]).find(x=>String(x?.name||x?.pm2_env?.name||'')==='p2gc-customer-delivery');
  if(!app)fail('PM2 app p2gc-customer-delivery not found');
  const priorStatus=String(app?.pm2_env?.status||'').toLowerCase();
  if(priorStatus!=='online')fail(`p2gc-customer-delivery is not online before deploy (${priorStatus||'unknown'})`);
  const selector=app.pm_id!=null?String(app.pm_id):'p2gc-customer-delivery';
  try{runPm2(['restart',selector,'--update-env'],'inherit');}catch(e){fail('PM2 restart failed',e.message);}
  const health=await wait('http://127.0.0.1:8792/api/health',r=>r.statusCode===200);
  const css=await wait('http://127.0.0.1:8792/private-diagnostic/diagnostic.css',r=>r.statusCode===200&&/noindex/i.test(String(r.headers['x-robots-tag']||'')));
  const js=await wait('http://127.0.0.1:8792/private-diagnostic/diagnostic.js',r=>r.statusCode===200&&/noindex/i.test(String(r.headers['x-robots-tag']||'')));
  console.log(JSON.stringify({ok:true,status:'P2GC_PRIVATE_DIAGNOSTIC_DEPLOY_GREEN',pm2App:'p2gc-customer-delivery',priorPid:app.pid||null,healthStatus:health.statusCode,cssSecurity:css.headers['x-robots-tag']||null,jsSecurity:js.headers['x-robots-tag']||null,checkedAt:new Date().toISOString()},null,2));
}

if(require.main===module)main().catch(error=>fail(error.message,error.stack));
module.exports={main};
