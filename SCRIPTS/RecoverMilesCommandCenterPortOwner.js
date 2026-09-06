'use strict';

const path=require('path');
const http=require('http');
const {execFileSync}=require('child_process');

const ROOT=path.resolve(__dirname,'..');
const PORT=8787;
const APP='miles-command-center';

function fail(message,details=null){console.error(`MILES_COMMAND_CENTER_OWNER_RECOVERY_RED: ${message}`);if(details)console.error(typeof details==='string'?details:JSON.stringify(details,null,2));process.exit(2);}
function powershell(){return process.env.SystemRoot?path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'):'powershell.exe';}
function shell(){return process.env.ComSpec||'cmd.exe';}
function runPs(script){return execFileSync(powershell(),['-NoProfile','-NonInteractive','-Command',script],{cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();}
function runPm2(args,stdio='pipe'){return execFileSync(shell(),['/d','/s','/c','pm2.cmd',...args],{cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:stdio==='inherit'?'inherit':['ignore','pipe','pipe']});}
function pm2List(){const rows=JSON.parse(runPm2(['jlist']));if(!Array.isArray(rows))throw new Error('PM2_LIST_INVALID');return rows;}
function appName(x){return String(x?.name||x?.pm2_env?.name||'');}
function listenerPid(){try{const raw=runPs(`$c=Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;if(-not $c){exit 3};[Console]::Out.Write($c.OwningProcess)`);const pid=Number(raw);return Number.isInteger(pid)&&pid>0?pid:null;}catch{return null;}}
function processInfo(pid){
  const script=`$p=Get-CimInstance Win32_Process -Filter \"ProcessId=${Number(pid)}\" -ErrorAction Stop;if(-not $p){exit 4};$o=[ordered]@{ProcessId=$p.ProcessId;ParentProcessId=$p.ParentProcessId;Name=$p.Name;ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine};$o|ConvertTo-Json -Compress`;
  try{return JSON.parse(runPs(script));}catch(error){return {error:String(error.stderr||error.message||error)};}
}
function canonicalSignature(info){
  const command=String(info?.CommandLine||'').toLowerCase().replace(/\//g,'\\');
  const executable=String(info?.ExecutablePath||'').toLowerCase();
  const root=ROOT.toLowerCase().replace(/\//g,'\\');
  const name=String(info?.Name||'').toLowerCase();
  const node=name==='node.exe'||/\\node\.exe$/.test(executable);
  const rootMatch=command.includes(root);
  const entryMatch=command.includes('startunifiedmilescontrolcenter.js')||command.includes('services\\digital_coo\\unifiedmilesgateway');
  return {ok:node&&rootMatch&&entryMatch,node,rootMatch,entryMatch,commandLine:info?.CommandLine||null,executablePath:info?.ExecutablePath||null,parentProcessId:info?.ParentProcessId||null};
}
function httpJson(timeoutMs=5000){return new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port:PORT,path:'/api/dashboard',timeout:timeoutMs},res=>{let body='';res.setEncoding('utf8');res.on('data',c=>body+=c);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(new Error(`HTTP_${res.statusCode}`));try{resolve(JSON.parse(body));}catch{reject(new Error('INVALID_JSON'));}});});req.on('timeout',()=>req.destroy(new Error('TIMEOUT')));req.on('error',reject);});}
async function waitHealthy(timeoutMs=45000){const deadline=Date.now()+timeoutMs;let last=null;while(Date.now()<deadline){try{const d=await httpJson();if(d?.ok===true)return d;last=new Error(`DASHBOARD_OK_${d?.ok}`);}catch(e){last=e;}await new Promise(r=>setTimeout(r,1200));}throw last||new Error('DASHBOARD_RECOVERY_TIMEOUT');}

async function main(){
  if(process.platform!=='win32')fail('Windows production host required.');
  let rows;try{rows=pm2List();}catch(error){fail('Unable to read PM2 list',error.message);}
  const app=rows.find(x=>appName(x)===APP);if(!app)fail('Canonical PM2 command-center app not found.');
  const beforePid=listenerPid();
  if(!beforePid){
    try{runPm2(['restart',APP,'--update-env'],'inherit');}catch(error){fail('No listener existed and PM2 restart failed',error.message);}
  }else{
    const managed=rows.find(x=>Number(x?.pid)===Number(beforePid));
    if(managed){
      if(appName(managed)!==APP)fail(`Port ${PORT} is PM2-managed by unexpected app ${appName(managed)}; refusing recovery.`);
      const status=String(managed?.pm2_env?.status||'').toLowerCase();
      if(status!=='online')fail(`Canonical PM2 owner exists but status is ${status||'unknown'}; refusing ambiguous recovery.`);
    }else{
      const info=processInfo(beforePid);const signature=canonicalSignature(info);
      if(!signature.ok)fail(`Port ${PORT} PID ${beforePid} is not provably the canonical MILES command center; refusing to terminate it.`,signature);
      console.log(`VERIFIED_ORPHAN_CANONICAL_COMMAND_CENTER_PID=${beforePid}`);
      try{runPs(`Stop-Process -Id ${beforePid} -Force -ErrorAction Stop`);}catch(error){fail('Verified canonical orphan could not be stopped',String(error.stderr||error.message||error));}
      const deadline=Date.now()+10000;while(Date.now()<deadline&&listenerPid()===beforePid)await new Promise(r=>setTimeout(r,400));
      if(listenerPid()===beforePid)fail('Verified orphan still owns port after stop attempt.');
      try{runPm2(['restart',APP,'--update-env'],'inherit');}catch(error){fail('PM2 restart after verified orphan cleanup failed',error.message);}
    }
  }
  const dashboard=await waitHealthy();
  const afterRows=pm2List();const afterApp=afterRows.find(x=>appName(x)===APP);const afterPid=listenerPid();
  if(!afterApp||String(afterApp?.pm2_env?.status||'').toLowerCase()!=='online')fail('PM2 command center is not online after recovery.');
  if(Number(afterApp.pid)!==Number(afterPid))fail(`Port ${PORT} owner ${afterPid} does not match PM2 ${APP} pid ${afterApp.pid}.`);
  console.log(JSON.stringify({ok:true,status:'MILES_COMMAND_CENTER_OWNER_RECOVERY_GREEN',port:PORT,priorListenerPid:beforePid||null,currentPid:afterPid,pm2App:APP,dashboardOk:dashboard.ok===true,checkedAt:new Date().toISOString(),safety:{terminatedOnlyAfterCanonicalSignatureProof:true,unknownProcessTermination:false,destructiveGitRecovery:false}},null,2));
}

if(require.main===module)main().catch(error=>fail(error.message,error.stack));
module.exports={main,canonicalSignature};
