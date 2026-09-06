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
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
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
  return {ok:execMatch&&cwdMatch,execPath,cwd,pidPath,pidFilePid,pm2Home,daemonPid,uptimeMs:Number.isFinite(uptimeMs)?uptimeMs:0,execMatch,cwdMatch,pm2Status:String(env.status||''),pmId:app?.pm_id??env.pm_id??null,reportedPid:Number(app?.pid)||0,restartTime:Number(env.restart_time||0)};
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
    const health=await httpJson('/api/health');const dashboard=await httpJson('/api/dashboard');const h=health?.json||{};const upstreams=h.upstreams||{};
    const exactGateway=h.ok===true&&h.service==='MILES_UNIFIED_CEO_GATEWAY'&&h.publicUrl===`http://127.0.0.1:${PORT}`&&upstreams.commandCenter==='http://127.0.0.1:8788'&&upstreams.executiveDashboard==='http://127.0.0.1:8737'&&upstreams.productLaunchpad==='http://127.0.0.1:8791';
    return {ok:health.statusCode===200&&exactGateway&&dashboard.statusCode===200&&dashboard.json?.ok===true,exactGateway,health:h,dashboardOk:dashboard.json?.ok===true};
  }catch(error){return {ok:false,error:error.message};}
}
function compositeOrphanProof({beforePid,app,rows,info,httpIdentity}){
  const child=genericPm2ChildSignature(info);const meta=pm2CanonicalMetadata(app);const start=startupTimeCorrelation(info,meta);
  const registrations=canonicalRegistrations(rows);const uniqueCanonicalRegistration=registrations.length===1&&registrations[0].name===APP;
  const directPidFileMatch=Number(meta.pidFilePid)===Number(beforePid);const pm2ReportedPidMatch=Number(meta.reportedPid)===Number(beforePid);const daemonParentMatch=Boolean(meta.daemonPid&&Number(meta.daemonPid)===Number(child.parentProcessId));
  const directAppPidProof=directPidFileMatch||pm2ReportedPidMatch;
  const startTimeFallback=!directAppPidProof&&daemonParentMatch&&start.available&&start.match;
  const verifiedOrphanGatewayFallback=!directAppPidProof&&daemonParentMatch&&uniqueCanonicalRegistration&&String(meta.pm2Status).toLowerCase()!=='online'&&httpIdentity?.ok===true;
  const ok=child.ok&&meta.ok&&httpIdentity?.ok===true&&uniqueCanonicalRegistration&&(directAppPidProof||startTimeFallback||verifiedOrphanGatewayFallback);
  return {ok,child,meta,start,registrations,uniqueCanonicalRegistration,httpIdentity,directPidFileMatch,pm2ReportedPidMatch,daemonParentMatch,directAppPidProof,startTimeFallback,verifiedOrphanGatewayFallback};
}
async function stopRespawnLoop(){
  try{runPm2(['stop',APP],'inherit');}catch(error){fail('Could not stop canonical command-center PM2 app before orphan cleanup',error.message);}
  await sleep(1200);
  const row=pm2List().find(x=>appName(x)===APP);
  if(!row||String(row?.pm2_env?.status||'').toLowerCase()!=='stopped')fail('PM2 command-center did not reach stopped state before cleanup.');
  return row;
}
async function clearVerifiedGatewayListeners(max=12){
  const cleaned=[];
  for(let i=0;i<max;i++){
    const pid=listenerPid();if(!pid)return cleaned;
    const rows=pm2List();const app=rows.find(x=>appName(x)===APP);if(!app)fail('Canonical PM2 command-center app disappeared during cleanup.');
    if(String(app?.pm2_env?.status||'').toLowerCase()!=='stopped')fail('PM2 command-center respawned during cleanup; refusing process termination.');
    const info=processInfo(pid);const identity=await currentHttpIdentity();const proof=compositeOrphanProof({beforePid:pid,app,rows,info,httpIdentity:identity});
    if(!proof.ok)fail(`Listener PID ${pid} on ${PORT} is not a verified orphaned MILES gateway; refusing to terminate it.`,proof);
    console.log(`CLEARING_VERIFIED_GATEWAY_ORPHAN_PID=${pid}`);
    try{runPs(`Stop-Process -Id ${pid} -Force -ErrorAction Stop`);}catch(error){fail(`Could not stop verified gateway orphan PID ${pid}`,String(error.stderr||error.message||error));}
    cleaned.push(pid);
    const deadline=Date.now()+8000;while(Date.now()<deadline&&listenerPid()===pid)await sleep(300);
    if(listenerPid()===pid)fail(`Verified gateway orphan PID ${pid} still owns ${PORT}.`);
    await sleep(500);
  }
  if(listenerPid())fail(`More than ${max} verified orphan listeners were encountered; stopping cleanup to avoid an unbounded process loop.`);
  return cleaned;
}
async function startAndRequireStableOwnership(){
  try{runPm2(['restart',APP,'--update-env'],'inherit');}catch(error){fail('PM2 restart after orphan cleanup failed',error.message);}
  const deadline=Date.now()+60000;let consecutive=0;let baselineRestart=null;let last=null;
  while(Date.now()<deadline){
    await sleep(2000);
    const rows=pm2List();const app=rows.find(x=>appName(x)===APP);const meta=app?pm2CanonicalMetadata(app):null;const pid=listenerPid();const identity=pid?await currentHttpIdentity():{ok:false,error:'NO_LISTENER'};
    const sample={pm2Status:String(app?.pm2_env?.status||''),pm2Pid:Number(app?.pid)||0,listenerPid:pid||0,restartTime:meta?.restartTime??null,httpOk:identity.ok===true};last=sample;
    const owned=sample.pm2Status.toLowerCase()==='online'&&sample.pm2Pid>0&&sample.pm2Pid===sample.listenerPid&&sample.httpOk;
    if(owned){
      if(baselineRestart===null)baselineRestart=sample.restartTime;
      if(sample.restartTime===baselineRestart)consecutive+=1;else{baselineRestart=sample.restartTime;consecutive=1;}
      if(consecutive>=5)return {ok:true,sample,consecutiveStableChecks:consecutive,stableSeconds:consecutive*2};
    }else{consecutive=0;baselineRestart=null;}
  }
  try{runPm2(['stop',APP],'inherit');}catch{}
  fail('Command center did not achieve stable PM2 PID/port ownership within 60 seconds; PM2 app was stopped to end the restart loop.',last);
}

async function main(){
  if(process.platform!=='win32')fail('Windows production host required.');
  let rows;try{rows=pm2List();}catch(error){fail('Unable to read PM2 list',error.message);}
  const app=rows.find(x=>appName(x)===APP);if(!app)fail('Canonical PM2 command-center app not found.');
  const registrations=canonicalRegistrations(rows);if(registrations.length!==1||registrations[0].name!==APP)fail('Canonical command-center PM2 registration is not unique.',registrations);
  const canonical=pm2CanonicalMetadata(app);if(!canonical.ok)fail('PM2 miles-command-center metadata does not point to the canonical MILES gateway entry.',canonical);
  const originalListener=listenerPid();const originalRestartTime=canonical.restartTime;

  await stopRespawnLoop();
  const cleanedPids=await clearVerifiedGatewayListeners();
  if(listenerPid())fail(`Port ${PORT} is still occupied after verified cleanup.`);
  const stable=await startAndRequireStableOwnership();

  console.log(JSON.stringify({ok:true,status:'MILES_COMMAND_CENTER_STABLE_OWNERSHIP_GREEN',port:PORT,originalListenerPid:originalListener||null,cleanedPids,originalRestartTime,currentPid:stable.sample.pm2Pid,currentRestartTime:stable.sample.restartTime,consecutiveStableChecks:stable.consecutiveStableChecks,stableSeconds:stable.stableSeconds,dashboardOk:true,checkedAt:new Date().toISOString(),safety:{pm2RespawnStoppedBeforeCleanup:true,terminatedOnlyVerifiedGatewayOrphans:true,unknownProcessTermination:false,destructiveGitRecovery:false,providerMutation:false,dataDeletion:false}},null,2));
}

if(require.main===module)main().catch(error=>fail(error.message,error.stack));
module.exports={main,compositeOrphanProof,pm2CanonicalMetadata,genericPm2ChildSignature,canonicalRegistrations};
