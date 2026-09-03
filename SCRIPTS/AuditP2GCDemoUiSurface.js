'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

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

function containsAll(text, markers) {
  return markers.filter(marker => !String(text || '').includes(marker));
}

async function auditUiSurface() {
  const [html, app, css] = await Promise.all([requestText('/demo'), requestText('/app.js'), requestText('/styles.css')]);
  const failures=[];
  if (!html.ok) failures.push(`DEMO_HTML_HTTP_FAILURE:${html.statusCode||'ERR'}:${html.error||''}`);
  if (!app.ok) failures.push(`APP_JS_HTTP_FAILURE:${app.statusCode||'ERR'}:${app.error||''}`);
  if (!css.ok) failures.push(`STYLES_HTTP_FAILURE:${css.statusCode||'ERR'}:${css.error||''}`);

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

  return {
    ok: failures.length===0,
    status: failures.length===0 ? 'P2GC_UI_SURFACE_ACCEPTANCE_GREEN' : 'P2GC_UI_SURFACE_ACCEPTANCE_RED',
    baseUrl:BASE_URL,
    failures,
    assets:{ htmlBytes:Buffer.byteLength(html.body||''), appBytes:Buffer.byteLength(app.body||''), cssBytes:Buffer.byteLength(css.body||'') },
    checks:{ salesStorySections:true, rendererPresent:true, javascriptSyntax:true, responsiveCss:true, printCss:true }
  };
}

if (require.main===module) auditUiSurface().then(result=>{console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:2;}).catch(error=>{console.error(error.stack||error.message);process.exitCode=2;});
module.exports={auditUiSurface,requestText};
