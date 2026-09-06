'use strict';

const fs=require('fs');
const path=require('path');
const http=require('http');
const {execFileSync}=require('child_process');

const ROOT=path.resolve(__dirname,'..');
const PORT=8787;
const APP='miles-command-center';
const CANONICAL_ENTRY=path.join(ROOT,'StartUnifiedMilesControlCenter.js');

function fail(message,details=null){
  console.error(`MILES_COMMAND_CENTER_OWNER_RECOVERY_RED: ${message}`);
  if(details)console.error(typeof details==='string'?details:JSON.stringify(details,null,2));
  process.exit(2);
}
function powershell(){return process.env.SystemRoot?path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'):'powershell.exe';}
function shell(){return process.env.ComSpec||'cmd.exe';}
function runPs(script){return execFileSync(powershell(),['-NoProfile','-NonInteractive','-Command',script],{cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();}
function runPm2(args,stdio='pipe'){return execFileSync(shell(),['/d','/s','/c','pm2.cmd',...args],{cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:stdio==='inherit'?'inherit':['ignore','pipe','pipe']});}
function pm2List(){const rows=JSON.parse(runPm2(['jlist']));if(!Array.isArray(rows))throw new Error('PM2_LIST_INVALID');return rows;}
function appName(x){return String(x?.name||x?.pm2_env?.name||'');}
function normalizedPath(v){try{return path.resolve(String(v||'')).toLowerCase();}catch{return String(v||'').toLowerCase();}}
function readPidFile(file){try{const n=Number(fs.readFileSync(file,'utf8').trim());return Number.isInteger(n)&&n>0?n:null;}catch{return null;}}
function listenerPid(){
  try{
    const raw=runPs(`$c=Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;if(-not $c){exit 3};[Console]::Out.Write($c.OwningProcess)`);
    const pid=Number(raw);return Number.isInteger(pid)&&pid>0?pid:null;
  }catch{return null;}
}
function processInfo(pid){
  const script=`$p=Get-CimInstance Win32_Process -Filter \"ProcessId=${Number(pid)}\" -ErrorAction Stop;if(-not $p){exit 4};$o=[ordered]@{ProcessId=$p.ProcessId;ParentProcessId=$p.ParentProcessId;Name=$p.Name;ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine;CreationDate=$p.CreationDate};$o|ConvertTo-Json -Compress`;
  try{return JSON.parse(runPs(script));}catch(error){return {error:String(error.stderr||error.message||error)};}
}
function genericPm2ChildSignature(info){
  const command=String(info?.CommandLine||'').toLowerCase().replace(/\//g,'\\');
  const executable=String(info?.ExecutablePath||'').toLowerCase();
  const name=String(info?.Name||'').toLowerCase();
  const node=name==='node.exe'||/\\node\.exe$/.test(executable);
  const pm2Container=command.includes('pm2\\lib\\processcontainerfork.js');
  return {ok:node&&pm2Container,node,pm2Container,commandLine:info?.CommandLine||null,executablePath:info?.ExecutablePath||null,parentProcessId:Number(info?.ParentProcessId)||null,creationDate:info?.CreationDate||null};
}
function pm2CanonicalMetadata(app){
  const env=app?.pm2_env||{};
  const execPath=String(env.pm_exec_path||'');
  const cwd=String(env.pm_cwd||'');
  const pidPath=String(env.pm_pid_path||'');
  const execMatch=normalizedPath(execPath)===normalizedPath(CANONICAL_ENTRY);
  const cwdMatch=normalizedPath(cwd)===normalizedPath(ROOT);
  const pidFilePid=pidPath?readPidFile(pidPath):null;
  let pm2Home='';
  if(pidPath){const pidsDir=path.dirname(pidPath);pm2Home=path.basename(pidsDir).toLowerCase()==='pids'?path.dirname(pidsDir):path.dirname(pidPath);}
  const daemonPid=pm2Home?readPidFile(path.join(pm2Home,'pm2.pid')):null;
  const uptimeMs=Number(env.pm_uptime||0);
  return {ok:execMatch&&cwdMatch,execPath,cwd,pidPath,pidFilePid,pm2Home,daemonPid,uptimeMs:Number.isFinite(uptimeMs)?uptimeMs:0,execMatch,cwdMatch,pm2Status:String(env.status||''),pmId:app?.pm_id??env.pm_id??null,reportedPid:Number(app?.pid)||0};
}
function canonicalRegistrations(rows){
  return (Array.isArray(rows)?rows:[]).filter(row=>normalizedPath(row?.pm2_env?.pm_exec_path)===normalizedPath(CANONICAL_ENTRY)).map(row=>({name:appName(row),pmId:row?.pm_id??row?.pm2_env?.pm_id??null,status:String(row?.pm2_env?.status||''),pid:Number(row?.pid)||0,cwd:String(row?.pm2_env?.pm_cwd||''),execPath:String(row?.pm2_env?.pm_exec_path||'')}));
}
function creationTimeMs(value){
  if(!value)return null;
  const dotNet=String(value).match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/);if(dotNet)return Number(dotNet[1]);
  const parsed=Date.parse(value);if(Number.isFinite(parsed))return parsed;
  const m=String(value).match(/^(\d{14})(?:\.\d+)?([+-]\d{3})?$/);if(!m)return null;
  const s=m[1];const t=Date.parse(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}`);return Number.isFinite(t)?t:null;
}
function startupTimeCorrelation(info,meta){
  const created=creationTimeMs(info?.CreationDate);const uptime=Number(meta?.uptimeMs||0);
  if(!created||!uptime)return {available:false,match:false,deltaMs:null,createdMs:created,pm2UptimeMs:uptime||null};
  const delta=Math.abs(created-uptime);return {available:true,match:delta<=10000,deltaMs:delta,createdMs:created,pm2UptimeMs:uptime};
}
function httpJson(requestPath='/api/health',timeoutMs=5000){
  return new Promise((resolve,reject)=>{
    const req=http.get({hostname:'127.0.0.1',port:PORT,path:requestPath,timeout:timeoutMs},res=>{
      let body='';res.setEncoding('utf8');res.on('data',c=>body+=c);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(new Error(`HTTP_${res.statusCode}`));try{resolve({statusCode:res.statusCode,json:JSON.parse(body)});}catch{reject(new Error('INVALID_JSON'));}});
    });
    req.on('timeout',()=>req.destroy(new Error('TIMEOUT')));req.on('error',reject);
  });
}
async function currentHttpIdentity(){
  try{
    const health=await httpJson('/api/health');const dashboard=await httpJson('/api/dashboard');
    const h=health?.json||{};
    const upstreams=h.upstreams||{};
    const exactGateway=h.ok===true&&h.service==='MILES_UNIFIED_CEO_GATEWAY'&&h.publicUrl===`http://127.0.0.1:${PORT}`&&upstreams.commandCenter==='http://127.0.0.1:8788'&&upstreams.executiveDashboard==='http://127.0.0.1:8737'&&upstreams.productLaunchpad==='http://127.0.0.1:8791';
    return {ok:health.statusCode===200&&exactGateway&&dashboard.statusCode===200&&dashboard.json?.ok===true,exactGateway,health:h,dashboardOk:dashboard.json?.ok===true};
  }catch(error){return {ok:false,error:error.message};}
}
async function waitHealthy(timeoutMs=45000){
  const deadline=Date.now()+timeoutMs;let last=null;
  while(Date.now()<deadline){try{const r=await httpJson('/api/dashboard');if(r?.json?.ok===true)return r.json;last=new Error(`DASHBOARD_OK_${r?.json?.ok}`);}catch(e){last=e;}await new Promise(r=>setTimeout(r,1200));}
  throw last||new Error('DASHBOARD_RECOVERY_TIMEOUT');
}
function compositeOrphanProof({beforePid,app,rows,info,httpIdentity}){
  const child=genericPm2ChildSignature(info);const meta=pm2CanonicalMetadata(app);const start=startupTimeCorrelation(info,meta);
  const registrations=canonicalRegistrations(rows);const uniqueCanonicalRegistration=registrations.length===1&&registrations[0].name===APP;
  const directPidFileMatch=Number(meta.pidFilePid)===Number(beforePid);const pm2ReportedPidMatch=Number(meta.reportedPid)===Number(beforePid);const daemonParentMatch=Boolean(meta.daemonPid&&Number(meta.daemonPid)===Number(child.parentProcessId));
  const directAppPidProof=directPidFileMatch||pm2ReportedPidMatch;
  const startTimeFallback=!directAppPidProof&&daemonParentMatch&&start.available&&start.match;
  const verifiedOrphanGatewayFallback=!directAppPidProof&&daemonParentMatch&&uniqueCanonicalRegistration&&String(meta.pm2Status).toLowerCase()!=='online'&&httpIdentity?.ok===true;
  const ok=child.ok&&meta.ok&&httpIdentity?.ok===true&&uniqueCanonicalRegistration&&(directAppPidProof||startTimeFallback||verifiedOrphanGatewayFallback);
  return {ok,child,meta,start,registrations,uniqueCanonicalRegistration,httpIdentity,directPidFileMatch,pm2ReportedPidMatch,daemonParentMatch,directAppPidProof,startTimeFallback,verifiedOrphanGatewayFallback,rule:'PM2_CHILD + UNIQUE_CANONICAL_PM2_REGISTRATION + EXACT_UNIFIED_GATEWAY_HTTP_IDENTITY + (DIRECT_APP_PID_LINK OR DAEMON_PARENT_AND_START_TIME_MATCH OR STOPPED_CANONICAL_APP_WITH_SAME_DAEMON_PARENT)'};
}

async function main(){
  if(process.platform!=='win32')fail('Windows production host required.');
  let rows;try{rows=pm2List();}catch(error){fail('Unable to read PM2 list',error.message);}
  const app=rows.find(x=>appName(x)===APP);if(!app)fail('Canonical PM2 command-center app not found.');
  const beforePid=listenerPid();
  if(!beforePid){try{runPm2(['restart',APP,'--update-env'],'inherit');}catch(error){fail('No listener existed and PM2 restart failed',error.message);}}
  else{
    const managed=rows.find(x=>Number(x?.pid)===Number(beforePid));
    if(managed){if(appName(managed)!==APP)fail(`Port ${PORT} is PM2-managed by unexpected app ${appName(managed)}; refusing recovery.`);if(String(managed?.pm2_env?.status||'').toLowerCase()!=='online')fail('Canonical PM2 owner is not online; refusing ambiguous recovery.');}
    else{
      const info=processInfo(beforePid);const httpIdentity=await currentHttpIdentity();const proof=compositeOrphanProof({beforePid,app,rows,info,httpIdentity});
      if(!proof.ok)fail(`Port ${PORT} PID ${beforePid} is not provably the orphaned canonical MILES command center; refusing to terminate it.`,proof);
      console.log(`VERIFIED_ORPHAN_CANONICAL_COMMAND_CENTER_PID=${beforePid}`);
      try{runPs(`Stop-Process -Id ${beforePid} -Force -ErrorAction Stop`);}catch(error){fail('Verified canonical orphan could not be stopped',String(error.stderr||error.message||error));}
      const deadline=Date.now()+10000;while(Date.now()<deadline&&listenerPid()===beforePid)await new Promise(r=>setTimeout(r,400));if(listenerPid()===beforePid)fail('Verified orphan still owns port after stop attempt.');
      try{runPm2(['restart',APP,'--update-env'],'inherit');}catch(error){fail('PM2 restart after verified orphan cleanup failed',error.message);}
    }
  }
  const dashboard=await waitHealthy();const afterRows=pm2List();const afterApp=afterRows.find(x=>appName(x)===APP);const afterPid=listenerPid();
  if(!afterApp||String(afterApp?.pm2_env?.status||'').toLowerCase()!=='online')fail('PM2 command center is not online after recovery.');
  if(Number(afterApp.pid)!==Number(afterPid))fail(`Port ${PORT} owner ${afterPid} does not match PM2 ${APP} pid ${afterApp.pid}.`);
  console.log(JSON.stringify({ok:true,status:'MILES_COMMAND_CENTER_OWNER_RECOVERY_GREEN',port:PORT,priorListenerPid:beforePid||null,currentPid:afterPid,pm2App:APP,dashboardOk:dashboard.ok===true,checkedAt:new Date().toISOString(),safety:{terminatedOnlyAfterCompositeCanonicalProof:true,unknownProcessTermination:false,destructiveGitRecovery:false}},null,2));
}

if(require.main===module)main().catch(error=>fail(error.message,error.stack));
module.exports={main,compositeOrphanProof,pm2CanonicalMetadata,genericPm2ChildSignature,canonicalRegistrations};
