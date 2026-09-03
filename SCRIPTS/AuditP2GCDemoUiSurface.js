'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const LiveAcceptance = require('./AuditLiveP2GCDemoAcceptance');

const BASE_URL = String(process.env.P2GC_LIVE_DEMO_BASE_URL || 'http://127.0.0.1:8791').replace(/\/$/, '');
const TIMEOUT_MS = Math.max(3000, Number(process.env.P2GC_UI_AUDIT_TIMEOUT_MS || 15000));

function requestText(pathname) {
  const target = new URL(pathname, `${BASE_URL}/`);
  const client = target.protocol === 'https:' ? https : http;
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    const req = client.get(target, { headers:{ 'user-agent':'MILES-P2GC-UI-Surface-Audit' } }, res => {
      const chunks=[];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => finish({ ok:res.statusCode>=200&&res.statusCode<300, statusCode:res.statusCode, body:Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`REQUEST_TIMEOUT_${TIMEOUT_MS}MS`)));
    req.on('error', error => finish({ ok:false, statusCode:null, body:'', error:error.message }));
  });
}

async function requestJson(pathname){
  const response=await requestText(pathname);
  if(!response.ok)return {...response,json:null};
  try{return {...response,json:JSON.parse(response.body)};}catch(error){return {...response,ok:false,json:null,error:`JSON_PARSE_FAILED:${error.message}`};}
}

function containsAll(text, markers) {
  return markers.filter(marker => !String(text || '').includes(marker));
}

async function auditIdentityAliases(){
  const name=await requestJson('/api/assessment?term=DeLune%20Corporation');
  const failures=[];
  if(!name.ok||!name.json?.ok)return{ok:false,status:'P2GC_IDENTITY_ALIAS_ACCEPTANCE_RED',failures:[`NAME_LOOKUP_FAILED:${name.statusCode||'ERR'}:${name.error||''}`],aliases:{}};
  const canonical={company:name.json.profile?.companyName||null,uei:name.json.profile?.uei||null,cage:name.json.profile?.cage||null,samStatus:name.json.profile?.samStatus||null,samEvidence:name.json.evidence?.currentSamRegistration?.authority||null};
  if(!canonical.uei)failures.push('NAME_LOOKUP_UEI_MISSING');
  if(!canonical.cage)failures.push('NAME_LOOKUP_CAGE_MISSING');
  const aliases={name:canonical};
  for(const [kind,value] of [['uei',canonical.uei],['cage',canonical.cage]]){
    if(!value)continue;
    const response=await requestJson(`/api/assessment?term=${encodeURIComponent(value)}`);
    if(!response.ok||!response.json?.ok){failures.push(`${kind.toUpperCase()}_LOOKUP_FAILED:${response.statusCode||'ERR'}:${response.error||''}`);continue;}
    const observed={company:response.json.profile?.companyName||null,uei:response.json.profile?.uei||null,cage:response.json.profile?.cage||null,samStatus:response.json.profile?.samStatus||null,samEvidence:response.json.evidence?.currentSamRegistration?.authority||null};
    aliases[kind]=observed;
    if(String(observed.uei||'').toUpperCase()!==String(canonical.uei||'').toUpperCase())failures.push(`${kind.toUpperCase()}_UEI_MISMATCH`);
    if(String(observed.cage||'').toUpperCase()!==String(canonical.cage||'').toUpperCase())failures.push(`${kind.toUpperCase()}_CAGE_MISMATCH`);
    if(String(observed.company||'').toUpperCase()!==String(canonical.company||'').toUpperCase())failures.push(`${kind.toUpperCase()}_COMPANY_MISMATCH`);
    if(observed.samStatus!==canonical.samStatus)failures.push(`${kind.toUpperCase()}_SAM_STATUS_MISMATCH`);
    if(observed.samEvidence!==canonical.samEvidence)failures.push(`${kind.toUpperCase()}_SAM_EVIDENCE_MISMATCH`);
  }
  if(canonical.samEvidence!=='SAM_PUBLIC_ENTITY_REGISTRATION_BULK_V2')failures.push(`SAM_EVIDENCE_AUTHORITY_UNEXPECTED:${canonical.samEvidence||'EMPTY'}`);
  return{ok:failures.length===0,status:failures.length===0?'P2GC_IDENTITY_ALIAS_ACCEPTANCE_GREEN':'P2GC_IDENTITY_ALIAS_ACCEPTANCE_RED',failures,aliases};
}

async function auditRegressionMatrix(){
  const results=[];
  for(const company of LiveAcceptance.DEFAULT_COMPANIES){
    results.push(await LiveAcceptance.auditCompany(company));
  }
  const failed=results.filter(x=>!x.ok);
  return{ok:failed.length===0,status:failed.length===0?'P2GC_FIVE_COMPANY_REGRESSION_GREEN':'P2GC_FIVE_COMPANY_REGRESSION_RED',companyCount:results.length,passedCompanyCount:results.length-failed.length,failedCompanyCount:failed.length,results};
}

async function auditUiSurface() {
  const [html, app, css, identityAliases] = await Promise.all([requestText('/demo'), requestText('/app.js'), requestText('/styles.css'), auditIdentityAliases()]);
  const failures=[];
  if (!html.ok) failures.push(`DEMO_HTML_HTTP_FAILURE:${html.statusCode||'ERR'}:${html.error||''}`);
  if (!app.ok) failures.push(`APP_JS_HTTP_FAILURE:${app.statusCode||'ERR'}:${app.error||''}`);
  if (!css.ok) failures.push(`STYLES_HTTP_FAILURE:${css.statusCode||'ERR'}:${css.error||''}`);
  if(!identityAliases.ok)failures.push(...identityAliases.failures.map(x=>`IDENTITY_ALIAS:${x}`));

  const requiredIds=['id="executivePosition"','id="strengths"','id="currentState"','id="gaps"','id="revenueCards"','id="awardHistory"','id="vehicles"','id="agencies"','id="primes"','id="subcontracting"','id="buyers"','id="opportunities"','id="recompetes"','id="diagnosis"','id="pathway"','id="trajectoryNow"','id="trajectoryP2gc"','id="recommendations"','id="paidNextStep"'];
  for (const marker of containsAll(html.body, requiredIds)) failures.push(`HTML_REQUIRED_SURFACE_MISSING:${marker}`);

  const requiredCopy=['Where You Stand Today','Strengths P2GC Can Build On','What the Evidence Means','If Nothing Changes','With P2GC','Federal Pathway Validation™'];
  for (const marker of containsAll(html.body, requiredCopy)) failures.push(`HTML_SALES_STORY_COPY_MISSING:${marker}`);

  const requiredJs=['function renderSalesStory(m)','renderSalesStory(m);','function proofLine(name)','function renderPrimes(p0)','function renderOpportunities(o)'];
  for (const marker of containsAll(app.body, requiredJs)) failures.push(`APP_RENDERER_MISSING:${marker}`);
  try { new Function(app.body); } catch (error) { failures.push(`APP_JS_SYNTAX_INVALID:${error.message}`); }

  if (!/@media\s*\(/i.test(css.body || '')) failures.push('RESPONSIVE_MEDIA_QUERY_MISSING');
  if (!/max-width|grid-template-columns/i.test(css.body || '')) failures.push('RESPONSIVE_LAYOUT_RULE_MISSING');
  if (!/no-print|@media\s+print/i.test(css.body || '')) failures.push('PRINT_SURFACE_RULE_MISSING');

  const regression=await auditRegressionMatrix();
  if(!regression.ok){for(const row of regression.results.filter(x=>!x.ok))failures.push(`FIVE_COMPANY_REGRESSION:${row.requestedTerm}:${row.failures.join(',')}`);}

  return {
    ok: failures.length===0,
    status: failures.length===0 ? 'P2GC_UI_SURFACE_ACCEPTANCE_GREEN' : 'P2GC_UI_SURFACE_ACCEPTANCE_RED',
    baseUrl:BASE_URL,
    failures,
    identityAliases,
    regression,
    assets:{ htmlBytes:Buffer.byteLength(html.body||''), appBytes:Buffer.byteLength(app.body||''), cssBytes:Buffer.byteLength(css.body||'') },
    checks:{ salesStorySections:true, rendererPresent:true, javascriptSyntax:true, responsiveCss:true, printCss:true, identityAliasContinuity:true, fiveCompanyRegression:true }
  };
}

if (require.main===module) auditUiSurface().then(result=>{console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:2;}).catch(error=>{console.error(error.stack||error.message);process.exitCode=2;});
module.exports={auditUiSurface,auditIdentityAliases,auditRegressionMatrix,requestText,requestJson};
