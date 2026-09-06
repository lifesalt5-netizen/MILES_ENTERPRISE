'use strict';

const path=require('path');
const {execFileSync}=require('child_process');

const ROOT=path.resolve(__dirname,'..');
const APP='miles-autonomous-coo';
const FILES=[
  'SERVICES/revenue/P2GCMarketingSalesOperatingPolicy.js',
  'SERVICES/revenue/P2GCCompanySpecificOutboundPipelineService.js',
  'SERVICES/revenue/ReplyIntelligenceProductionLoopService.js',
  'TESTS/p2gc_company_specific_reply_bridge.test.js',
  'TESTS/p2gc_private_diagnostic_gate.test.js',
  'TESTS/Test_QualifiedReplyRevenueBridge.js'
];
function fail(message,details=null){console.error(`P2GC_COMPANY_SPECIFIC_REPLY_BRIDGE_DEPLOY_RED: ${message}`);if(details)console.error(String(details));process.exit(2);}
function shell(){return process.env.ComSpec||'cmd.exe';}
function runPm2(args,stdio='pipe'){return execFileSync(shell(),['/d','/s','/c','pm2.cmd',...args],{cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:stdio==='inherit'?'inherit':['ignore','pipe','pipe']});}
function list(){const rows=JSON.parse(runPm2(['jlist']));if(!Array.isArray(rows))throw new Error('PM2_LIST_INVALID');return rows;}
function appName(x){return String(x?.name||x?.pm2_env?.name||'');}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function stableApp(expectedMinRestart){let baseline=null;let consecutive=0;let last=null;const deadline=Date.now()+45000;while(Date.now()<deadline){await sleep(2000);const app=list().find(x=>appName(x)===APP);const status=String(app?.pm2_env?.status||'').toLowerCase();const pid=Number(app?.pid)||0;const restart=Number(app?.pm2_env?.restart_time||0);last={status,pid,restart};if(status==='online'&&pid>0&&restart>=expectedMinRestart){if(baseline===null)baseline=restart;if(restart===baseline)consecutive+=1;else{baseline=restart;consecutive=1;}if(consecutive>=4)return {...last,stableChecks:consecutive};}else{baseline=null;consecutive=0;}}throw new Error(`AUTONOMOUS_COO_NOT_STABLE:${JSON.stringify(last)}`);}
async function main(){
  for(const rel of FILES){const file=path.join(ROOT,rel);try{execFileSync(process.execPath,['--check',file],{cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});}catch(error){fail(`Syntax check failed: ${rel}`,error.stderr||error.stdout||error.message);}}
  for(const test of ['TESTS/p2gc_private_diagnostic_gate.test.js','TESTS/p2gc_company_specific_reply_bridge.test.js','TESTS/Test_QualifiedReplyRevenueBridge.js']){try{execFileSync(process.execPath,[path.join(ROOT,test)],{cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:120000});}catch(error){fail(`Acceptance test failed: ${test}`,error.stderr||error.stdout||error.message);}}
  if(process.platform!=='win32'){console.log(JSON.stringify({ok:true,status:'P2GC_COMPANY_SPECIFIC_REPLY_BRIDGE_SOURCE_GREEN_RUNTIME_SKIPPED_NON_WINDOWS'},null,2));return;}
  let before;try{before=list().find(x=>appName(x)===APP);}catch(error){fail('Unable to read PM2 state',error.message);}
  if(!before)fail(`PM2 app ${APP} not found.`);
  if(String(before?.pm2_env?.status||'').toLowerCase()!=='online')fail(`${APP} is not online before deploy.`);
  const priorPid=Number(before.pid)||0;const priorRestart=Number(before?.pm2_env?.restart_time||0);
  try{runPm2(['restart',APP,'--update-env'],'inherit');}catch(error){fail(`Could not restart ${APP}`,error.message);}
  let stable;try{stable=await stableApp(priorRestart);}catch(error){fail(error.message);}
  console.log(JSON.stringify({ok:true,status:'P2GC_COMPANY_SPECIFIC_REPLY_BRIDGE_DEPLOY_GREEN',pm2App:APP,priorPid,currentPid:stable.pid,priorRestartTime:priorRestart,currentRestartTime:stable.restart,stableChecks:stable.stableChecks,behavior:{companySpecificPositiveReply:'PRIVATE_DIAGNOSTIC_BEFORE_CALENDAR',sameThreadRequired:true,p2gcComHandoffBlocked:true,qualificationBeforeKevinCalendar:true,legacyQualifiedReplyPathPreserved:true},safety:{commandCenterRestarted:false,providerMutationPerformedByDeployer:false,dataDeletion:false,destructiveGitRecovery:false},checkedAt:new Date().toISOString()},null,2));
}
if(require.main===module)main().catch(error=>fail(error.stack||error.message));
module.exports={main};
