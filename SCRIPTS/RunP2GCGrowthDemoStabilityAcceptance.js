'use strict';

process.env.P2GC_LIVE_DEMO_AUDIT_TIMEOUT_MS = process.env.P2GC_LIVE_DEMO_AUDIT_TIMEOUT_MS || '120000';

const http = require('http');
const { spawnSync } = require('child_process');
const { URL } = require('url');
const Live = require('./AuditLiveP2GCDemoAcceptance');

const BASE_URL = Live.BASE_URL;
const STATIC_TIMEOUT_MS = Math.max(3000, Number(process.env.P2GC_STABILITY_STATIC_TIMEOUT_MS || 8000));
const HEALTH_POLL_MS = Math.max(500, Number(process.env.P2GC_STABILITY_HEALTH_POLL_MS || 2000));
const MAX_HEALTH_LATENCY_MS = Math.max(1000, Number(process.env.P2GC_STABILITY_MAX_HEALTH_LATENCY_MS || 5000));

function requestText(pathname, timeoutMs = STATIC_TIMEOUT_MS) {
  const target = new URL(pathname, `${BASE_URL}/`);
  return new Promise(resolve => {
    const started = Date.now();
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve({ ...value, elapsedMs: Date.now() - started });
    };
    const req = http.get(target, { headers:{ 'user-agent':'MILES-P2GC-Stability-Acceptance' } }, res => {
      const chunks=[];
      res.on('data', c => chunks.push(c));
      res.on('end', () => finish({ ok:res.statusCode>=200&&res.statusCode<300, statusCode:res.statusCode, body:Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`REQUEST_TIMEOUT_${timeoutMs}MS`)));
    req.on('error', error => finish({ ok:false, statusCode:null, body:'', error:error.message }));
  });
}

function pm2Snapshot() {
  if (process.platform !== 'win32') return { ok:true, skipped:true, reason:'WINDOWS_ONLY_PM2_SNAPSHOT' };
  const shell = process.env.ComSpec || 'cmd.exe';
  const result = spawnSync(shell, ['/d','/s','/c','pm2.cmd','jlist'], {
    cwd:Live.ROOT, env:process.env, encoding:'utf8', windowsHide:true, timeout:30000
  });
  if (result.status !== 0) return { ok:false, error:`PM2_LIST_FAILED:${String(result.stderr||'').slice(-1000)}` };
  let list=[];
  try { list=JSON.parse(String(result.stdout||'[]')); } catch (error) { return { ok:false, error:`PM2_JSON_INVALID:${error.message}` }; }
  const app=Array.isArray(list)?list.find(x=>String(x?.name||x?.pm2_env?.name||'')===Live.DEMO_PM2_NAME):null;
  if (!app) return { ok:false, error:'P2GC_GROWTH_DEMO_PM2_NOT_FOUND' };
  return {
    ok:true,
    status:String(app?.pm2_env?.status||'').toLowerCase(),
    pid:Number(app?.pid||0)||null,
    restartCount:Number(app?.pm2_env?.restart_time||0),
    uptimeMs:Number(app?.pm2_env?.pm_uptime||0)||null,
    memoryBytes:Number(app?.monit?.memory||0)||null
  };
}

function sameRuntime(before, after) {
  if (before?.skipped || after?.skipped) return true;
  return before?.ok===true && after?.ok===true && before.pid===after.pid && before.restartCount===after.restartCount && after.status==='online';
}

function addFailure(failures, code, detail='') { failures.push(detail ? `${code}:${detail}` : code); }
function arr(value){return Array.isArray(value)?value:[];}

async function probeStatic(label) {
  const [health,demo,app,css]=await Promise.all([
    Live.requestJson('/api/health'),
    requestText('/demo'),
    requestText('/app.js'),
    requestText('/styles.css')
  ]);
  const failures=[];
  if(!health.ok||health.body?.ok!==true)addFailure(failures,'HEALTH_NOT_OK',health.error||String(health.statusCode));
  if(!demo.ok)addFailure(failures,'DEMO_STATIC_NOT_OK',demo.error||String(demo.statusCode));
  if(!app.ok)addFailure(failures,'APP_STATIC_NOT_OK',app.error||String(app.statusCode));
  if(!css.ok)addFailure(failures,'CSS_STATIC_NOT_OK',css.error||String(css.statusCode));
  for(const [name,probe] of [['demo',demo],['app',app],['css',css]]) if(probe.elapsedMs>MAX_HEALTH_LATENCY_MS)addFailure(failures,'STATIC_LATENCY_EXCEEDED',`${name}:${probe.elapsedMs}`);
  return {label,ok:failures.length===0,failures,health:{ok:health.ok,statusCode:health.statusCode},latencyMs:{demo:demo.elapsedMs,app:app.elapsedMs,css:css.elapsedMs}};
}

async function requestFocused(encoded, type, failures) {
  const route = type==='teaming' ? `/api/teaming?term=${encoded}` : `/api/intelligence?term=${encoded}&type=${type}`;
  const response=await Live.requestJson(route);
  if(!response.ok){addFailure(failures,`${type.toUpperCase()}_HTTP_FAILURE`,response.error||String(response.statusCode));return response;}
  if(type==='opportunities')Live.validateOpportunities(response.body,failures);
  if(type==='vehicles')Live.validateVehicles(response.body,failures);
  if(type==='recompetes')Live.validateRecompetes(response.body,failures);
  if(type==='teaming')Live.validateTeaming(response.body,failures);
  return response;
}

async function auditCompany(company) {
  const encoded=encodeURIComponent(company);
  const failures=[];
  const runtimeBefore=pm2Snapshot();
  if(!runtimeBefore.ok)addFailure(failures,'PM2_BEFORE_INVALID',runtimeBefore.error||'UNKNOWN');

  let assessmentDone=false;
  const assessmentPromise=Live.requestJson(`/api/assessment?term=${encoded}&refresh=1`).finally(()=>{assessmentDone=true;});
  const activeHealth=[];
  while(!assessmentDone){
    const started=Date.now();
    const health=await Live.requestJson('/api/health');
    const elapsedMs=Date.now()-started;
    activeHealth.push({ok:health.ok&&health.body?.ok===true,statusCode:health.statusCode,elapsedMs,error:health.error||null});
    if(!health.ok||health.body?.ok!==true)addFailure(failures,'HEALTH_FAILED_DURING_ASSESSMENT',health.error||String(health.statusCode));
    if(elapsedMs>MAX_HEALTH_LATENCY_MS)addFailure(failures,'HEALTH_LATENCY_DURING_ASSESSMENT',String(elapsedMs));
    if(!assessmentDone)await new Promise(resolve=>setTimeout(resolve,HEALTH_POLL_MS));
  }
  const assessment=await assessmentPromise;
  if(!assessment.ok)addFailure(failures,'ASSESSMENT_HTTP_FAILURE',assessment.error||String(assessment.statusCode));
  else Live.validateAssessment(assessment.body,failures);

  const opportunities=await requestFocused(encoded,'opportunities',failures);
  const vehicles=await requestFocused(encoded,'vehicles',failures);
  const recompetes=await requestFocused(encoded,'recompetes',failures);
  const teaming=await requestFocused(encoded,'teaming',failures);

  const runtimeAfter=pm2Snapshot();
  if(!runtimeAfter.ok)addFailure(failures,'PM2_AFTER_INVALID',runtimeAfter.error||'UNKNOWN');
  if(!sameRuntime(runtimeBefore,runtimeAfter))addFailure(failures,'P2GC_RUNTIME_RESTARTED_DURING_COMPANY',`${runtimeBefore.pid||'NA'}:${runtimeBefore.restartCount??'NA'}->${runtimeAfter.pid||'NA'}:${runtimeAfter.restartCount??'NA'}`);

  return {
    requestedTerm:company,
    resolvedCompany:assessment.body?.profile?.companyName||null,
    ok:failures.length===0,
    failures,
    runtimeBefore,
    runtimeAfter,
    healthPolls:activeHealth.length,
    maxHealthLatencyMs:activeHealth.length?Math.max(...activeHealth.map(x=>x.elapsedMs)):null,
    uei:assessment.body?.profile?.uei||null,
    cage:assessment.body?.profile?.cage||null,
    truthStatus:assessment.body?.truthIntegrity?.status||null,
    opportunityCount:Number(opportunities.body?.totals?.all||0),
    vehicleCount:arr(vehicles.body?.currentVehicles).length,
    recompeteCount:arr(recompetes.body?.records).length,
    primeCandidateCount:arr(teaming.body?.primeCandidates).length
  };
}

async function runAcceptance(){
  const runtime=await Live.ensureDemoCurrent();
  const initial=await probeStatic('INITIAL');
  const baseline=pm2Snapshot();
  const results=[];
  for(const company of Live.DEFAULT_COMPANIES) results.push(await auditCompany(company));
  const finalProbe=await probeStatic('FINAL');
  const finalRuntime=pm2Snapshot();
  const failures=[];
  if(runtime.ok!==true)addFailure(failures,'DEMO_RUNTIME_NOT_CURRENT',runtime.status||runtime.reason||'UNKNOWN');
  if(!initial.ok)failures.push(...initial.failures.map(x=>`INITIAL:${x}`));
  if(!finalProbe.ok)failures.push(...finalProbe.failures.map(x=>`FINAL:${x}`));
  if(!sameRuntime(baseline,finalRuntime))addFailure(failures,'P2GC_RUNTIME_CHANGED_OVER_ACCEPTANCE',`${baseline.pid||'NA'}:${baseline.restartCount??'NA'}->${finalRuntime.pid||'NA'}:${finalRuntime.restartCount??'NA'}`);
  for(const result of results) if(!result.ok) failures.push(...result.failures.map(x=>`${result.requestedTerm}:${x}`));
  return {
    ok:failures.length===0,
    status:failures.length===0?'P2GC_GROWTH_DEMO_STABILITY_GREEN':'P2GC_GROWTH_DEMO_STABILITY_RED',
    generatedAt:new Date().toISOString(),
    baseUrl:BASE_URL,
    runtime,
    baseline,
    finalRuntime,
    initial,
    finalProbe,
    companyCount:results.length,
    passedCompanyCount:results.filter(x=>x.ok).length,
    failedCompanyCount:results.filter(x=>!x.ok).length,
    results,
    failures,
    safety:{readOnly:true,prospectSends:false,providerMutations:false,dnsChanges:false,authBypass:false}
  };
}

async function main(){
  const report=await runAcceptance();
  console.log(JSON.stringify(report,null,2));
  console.log(`RESULT: ${report.status}`);
  process.exitCode=report.ok?0:2;
}

if(require.main===module)main().catch(error=>{console.error(error.stack||error);console.log('RESULT: P2GC_GROWTH_DEMO_STABILITY_RED');process.exitCode=2;});
module.exports={requestText,pm2Snapshot,sameRuntime,probeStatic,auditCompany,runAcceptance};
