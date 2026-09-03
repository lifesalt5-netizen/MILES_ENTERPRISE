'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const http=require('http');
const {execFileSync}=require('child_process');

const ROOT=path.resolve(__dirname,'..');
const ENV_FILE=path.join(ROOT,'.env');
const APP='p2gc-customer-delivery';
const PORT=Number(process.env.P2GC_CUSTOMER_PORT||8792);

function fail(message,details=''){
  console.error(`P2GC_FEDERAL_GROWTH_REVIEW_DEPLOY_RED: ${message}`);
  if(details) console.error(details);
  process.exit(2);
}
function readEnvText(){try{return fs.readFileSync(ENV_FILE,'utf8');}catch{return '';}}
function envValue(text,key){const m=String(text||'').match(new RegExp(`^${key}=([^\\r\\n]*)$`,'m'));return m?String(m[1]||'').trim().replace(/^['"]|['"]$/g,''):'';}
function ensureTokenSecret(){
  let text=readEnvText();
  let value=String(process.env.P2GC_REVIEW_TOKEN_SECRET||'').trim()||envValue(text,'P2GC_REVIEW_TOKEN_SECRET');
  if(value.length>=32){process.env.P2GC_REVIEW_TOKEN_SECRET=value;return {created:false,length:value.length};}
  value=crypto.randomBytes(48).toString('base64url');
  const prefix=text && !/\r?\n$/.test(text)?'\r\n':'';
  fs.appendFileSync(ENV_FILE,`${prefix}P2GC_REVIEW_TOKEN_SECRET=${value}\r\n`,'utf8');
  process.env.P2GC_REVIEW_TOKEN_SECRET=value;
  return {created:true,length:value.length};
}
function verifyRequiredFiles(){
  const required=[
    'StartP2GCCustomerDelivery.js',
    'CONNECTORS/IONOS/smtp_governed.js',
    'SERVICES/revenue/P2GCFederalGrowthReviewLifecycleService.js',
    'SERVICES/revenue/P2GCFederalGrowthReviewAccessService.js',
    'SERVICES/revenue/P2GCFederalGrowthReviewVerificationService.js',
    'SERVICES/revenue/P2GCFederalGrowthReviewHttpController.js',
    'SERVICES/review/public/review.html',
    'SERVICES/review/public/review.js',
    'SERVICES/review/public/review.css'
  ];
  const missing=required.filter(rel=>!fs.existsSync(path.join(ROOT,rel)));
  if(missing.length) fail('Required review files missing.',missing.join(','));
}
function runPm2(args,options={}){
  if(process.platform==='win32'){
    const shell=process.env.ComSpec||'cmd.exe';
    return execFileSync(shell,['/d','/s','/c','pm2.cmd',...args],{cwd:ROOT,encoding:'utf8',windowsHide:true,...options});
  }
  return execFileSync('pm2',args,{cwd:ROOT,encoding:'utf8',...options});
}
function verifyPm2App(){
  const list=JSON.parse(runPm2(['jlist'],{stdio:['ignore','pipe','pipe']}));
  const item=list.find(x=>String(x?.name||x?.pm2_env?.name||'')===APP);
  if(!item) fail(`${APP} not found in PM2.`);
  if(String(item?.pm2_env?.status||'').toLowerCase()!=='online') fail(`${APP} is not online before restart.`);
  return item;
}
function request(pathname,timeoutMs=10000){
  return new Promise((resolve,reject)=>{
    const req=http.get({host:'127.0.0.1',port:PORT,path:pathname,timeout:timeoutMs},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({statusCode:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject);
  });
}
async function waitForReviewHealth(){
  const deadline=Date.now()+45000;let last=null;
  while(Date.now()<deadline){
    try{
      const r=await request('/api/review/health',8000);
      let body=null;try{body=JSON.parse(r.body);}catch{}
      if(r.statusCode===200&&body?.ok===true)return {response:r,body};
      last=new Error(`health status=${r.statusCode} body=${r.body.slice(0,500)}`);
    }catch(error){last=error;}
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw last||new Error('review health timeout');
}
async function verifySurface(){
  const page=await request('/review/P2GC-FGR-SECURITY-PROBE');
  if(page.statusCode!==200) fail('Secure review page did not return HTTP 200.',String(page.statusCode));
  if(!/noindex/i.test(String(page.headers['x-robots-tag']||''))) fail('Secure review page missing noindex header.');
  if(!/no-store/i.test(String(page.headers['cache-control']||''))) fail('Secure review page missing no-store header.');
  if(!/Personalized Federal Growth Review/i.test(page.body)) fail('Secure review page content marker missing.');
  return {statusCode:page.statusCode,xRobotsTag:page.headers['x-robots-tag']||null,cacheControl:page.headers['cache-control']||null};
}
async function main(){
  if(process.platform!=='win32') fail('Deployment helper is intended for the Windows MILES production host only.');
  verifyRequiredFiles();
  const secret=ensureTokenSecret();
  const envText=readEnvText();
  const ionosPasswordConfigured=Boolean(String(process.env.IONOS_KEVIN_PASSWORD||'').trim()||envValue(envText,'IONOS_KEVIN_PASSWORD'));
  if(!ionosPasswordConfigured) fail('IONOS_KEVIN_PASSWORD is not configured; refusing to mark secure review delivery ready.');
  verifyPm2App();
  console.log(`RESTARTING_PM2_APP=${APP}`);
  runPm2(['restart',APP,'--update-env'],{stdio:'inherit'});
  const health=await waitForReviewHealth();
  const surface=await verifySurface();
  console.log(`P2GC_REVIEW_TOKEN_SECRET_CREATED=${secret.created}`);
  console.log(`P2GC_REVIEW_TOKEN_SECRET_READY=${secret.length>=32}`);
  console.log(`P2GC_REVIEW_IONOS_SMTP_READY=${health.body?.senderHealth?.ok===true}`);
  console.log(`P2GC_REVIEW_ASSETS_READY=${Object.values(health.body?.assets||{}).every(Boolean)}`);
  console.log(`P2GC_REVIEW_SECURITY_HEADERS_READY=${health.body?.securityHeadersReady===true}`);
  console.log(`P2GC_REVIEW_PAGE_HTTP=${surface.statusCode}`);
  console.log(`P2GC_REVIEW_X_ROBOTS_TAG=${surface.xRobotsTag}`);
  console.log(`P2GC_REVIEW_CACHE_CONTROL=${surface.cacheControl}`);
  console.log('P2GC_FEDERAL_GROWTH_REVIEW_DEPLOY_GREEN');
}

main().catch(error=>fail(error.message,error.stack));
