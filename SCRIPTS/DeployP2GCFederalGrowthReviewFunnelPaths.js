'use strict';

require('dotenv').config({quiet:true});
const fs=require('fs');
const path=require('path');
const https=require('https');
const {spawnSync}=require('child_process');

const ROOT=path.resolve(__dirname,'..');
const ENV_FILE=path.join(ROOT,'.env');
const HTTPS_PORT=443;
const BACKEND='http://127.0.0.1:8792';
const MOUNTS=[
  {path:'/review',target:`${BACKEND}/review`},
  {path:'/api/review',target:`${BACKEND}/api/review`}
];

function run(cmd,args=[],timeout=30000){const r=spawnSync(cmd,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout});return{ok:r.status===0,status:r.status,stdout:String(r.stdout||'').trim(),stderr:String(r.stderr||'').trim(),error:r.error?.message||null};}
function tailscale(args,timeout=30000){const candidates=process.platform==='win32'?['tailscale.exe','tailscale']:['tailscale'];for(const cmd of candidates){const r=run(cmd,args,timeout);if(r.ok||!r.error)return{...r,command:cmd};}return{ok:false,status:-1,stdout:'',stderr:'TAILSCALE_CLI_NOT_FOUND'};}
function fail(message,detail){const e=new Error(message);e.detail=detail;throw e;}
function urls(text){return[...new Set((String(text||'').match(/https:\/\/[A-Za-z0-9.-]+(?::\d+)?/g)||[]).map(x=>x.replace(/\/$/,'')))];}
function status(){const r=tailscale(['funnel','status','--json'],30000);if(!r.ok)fail('TAILSCALE_FUNNEL_STATUS_FAILED',r.stderr||r.stdout);return r;}
function deriveBase(statusRun){const fromJson=urls(statusRun.stdout);if(fromJson.length)return fromJson[0];const plain=tailscale(['funnel','status'],30000);if(!plain.ok)fail('TAILSCALE_FUNNEL_PLAIN_STATUS_FAILED',plain.stderr||plain.stdout);const found=urls(plain.stdout);if(!found.length)fail('TAILSCALE_FUNNEL_PUBLIC_HTTPS_URL_NOT_FOUND',plain.stdout);return found[0];}
function publicGet(base,pathname,timeout=15000){return new Promise(resolve=>{const u=new URL(pathname,`${base}/`);const req=https.get(u,{timeout,headers:{'User-Agent':'P2GC-Funnel-Acceptance/1.0'}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({ok:true,statusCode:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8').slice(0,12000),url:u.toString()}));});req.on('timeout',()=>req.destroy(new Error('TIMEOUT')));req.on('error',error=>resolve({ok:false,error:error.message,url:u.toString()}));});}
function mount(entry){const r=tailscale(['funnel',`--https=${HTTPS_PORT}`,`--set-path=${entry.path}`,'--bg','--yes',entry.target],30000);if(!r.ok)fail(`TAILSCALE_FUNNEL_MOUNT_FAILED:${entry.path}`,r.stderr||r.stdout);return r;}
function unmount(entry){return tailscale(['funnel',`--https=${HTTPS_PORT}`,`--set-path=${entry.path}`,'off'],30000);}
function readEnv(){try{return fs.readFileSync(ENV_FILE,'utf8');}catch{return'';}}
function writeEnv(text){fs.writeFileSync(ENV_FILE,String(text||''),'utf8');}
function setEnvValue(key,value){let text=readEnv();const line=`${key}=${value}`;const re=new RegExp(`^${key}=.*$`,'m');text=re.test(text)?text.replace(re,line):`${text}${text&&!/\r?\n$/.test(text)?'\r\n':''}${line}\r\n`;writeEnv(text);process.env[key]=value;}
function restartCustomerDelivery(){const args=['restart','p2gc-customer-delivery','--update-env'];if(process.platform==='win32'){const shell=process.env.ComSpec||'cmd.exe';const r=run(shell,['/d','/s','/c','pm2.cmd',...args],45000);if(!r.ok)fail('P2GC_CUSTOMER_DELIVERY_RESTART_FAILED',r.stderr||r.stdout);return r;}const r=run('pm2',args,45000);if(!r.ok)fail('P2GC_CUSTOMER_DELIVERY_RESTART_FAILED',r.stderr||r.stdout);return r;}
async function verify(base,rootBefore){const page=await publicGet(base,'/review/P2GC-FGR-FUNNEL-PROBE');const health=await publicGet(base,'/api/review/health');const admin=await publicGet(base,'/api/admin/review/health');const root=await publicGet(base,'/');const pageGreen=page.ok&&page.statusCode===200&&/Personalized Federal Growth Review/i.test(page.body)&&/noindex/i.test(String(page.headers?.['x-robots-tag']||''))&&/no-store/i.test(String(page.headers?.['cache-control']||''));const healthGreen=health.ok&&health.statusCode===200;const adminBlocked=!admin.ok||[401,403,404].includes(admin.statusCode);const rootPreserved=root.ok&&rootBefore.ok&&root.statusCode===rootBefore.statusCode;return{ok:pageGreen&&healthGreen&&adminBlocked&&rootPreserved,page,health:{...health,body:health.body.slice(0,2000)},admin:{...admin,body:admin.body?.slice(0,1000)},root:{before:rootBefore,after:root},checks:{pageGreen,healthGreen,adminBlocked,rootPreserved}};}

async function main(){
  const before=status();const base=deriveBase(before);const rootBefore=await publicGet(base,'/');
  if(!rootBefore.ok)fail('EXISTING_FUNNEL_ROOT_NOT_REACHABLE_BEFORE_CHANGE',rootBefore.error);
  const originalEnv=readEnv();let envChanged=false;const applied=[];
  try{
    const beforeText=String(before.stdout||'');
    const existing=MOUNTS.filter(entry=>beforeText.includes(`\"${entry.path}\"`)||beforeText.includes(`:${entry.path}`));
    if(existing.length)fail('P2GC_REVIEW_FUNNEL_PATH_ALREADY_PRESENT_REFUSING_OVERWRITE',existing.map(x=>x.path).join(','));
    for(const entry of MOUNTS){mount(entry);applied.push(entry);}
    await new Promise(r=>setTimeout(r,2500));
    const acceptance=await verify(base,rootBefore);if(!acceptance.ok)fail('P2GC_REVIEW_FUNNEL_ACCEPTANCE_FAILED',JSON.stringify(acceptance));
    setEnvValue('P2GC_PUBLIC_REVIEW_BASE_URL',base);envChanged=true;restartCustomerDelivery();
    await new Promise(r=>setTimeout(r,1800));
    const postRestart=await verify(base,rootBefore);if(!postRestart.ok)fail('P2GC_REVIEW_FUNNEL_POST_RESTART_ACCEPTANCE_FAILED',JSON.stringify(postRestart));
    console.log(JSON.stringify({ok:true,status:'P2GC_REVIEW_FUNNEL_PATHS_GREEN',publicBaseUrl:base,mounts:MOUNTS,acceptance:postRestart.checks,safety:{rootReset:false,adminRouteMounted:false,onlyProspectPathsAdded:true,rollbackArmed:true}},null,2));
  }catch(error){
    if(envChanged){writeEnv(originalEnv);delete process.env.P2GC_PUBLIC_REVIEW_BASE_URL;try{restartCustomerDelivery();}catch{}}
    const rollback=applied.slice().reverse().map(entry=>({path:entry.path,result:unmount(entry)}));
    console.error(JSON.stringify({ok:false,status:'P2GC_REVIEW_FUNNEL_PATHS_ROLLED_BACK',error:error.message,detail:error.detail||null,envRestored:envChanged,rollback:rollback.map(x=>({path:x.path,ok:x.result.ok,status:x.result.status,stderr:x.result.stderr}))},null,2));
    process.exitCode=2;
  }
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=2;});
