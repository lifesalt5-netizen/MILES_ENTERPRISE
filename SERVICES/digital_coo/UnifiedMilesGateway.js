'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const CanonicalApprovalGovernanceService = require('./CanonicalApprovalGovernanceService');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..', '..');
const PUBLIC_PORT = Number(process.env.MILES_UNIFIED_PORT || 8787);
const COMMAND_PORT = Number(process.env.MILES_INTERNAL_COMMAND_PORT || 8788);
const DASHBOARD_PORT = Number(process.env.MILES_DASHBOARD_PORT || 8737);
const PRODUCT_PORT = Number(process.env.P2GC_GROWTH_DEMO_PORT || 8791);
const approvalGovernance = new CanonicalApprovalGovernanceService({ root: ROOT });

const COMMAND_API_PREFIXES = [
  '/api/command',
  '/api/dashboard',
  '/api/demo',
  '/api/operation',
  '/api/operations/'
];

const DASHBOARD_API_PREFIXES = [
  '/api/state',
  '/api/brief',
  '/api/revenue',
  '/api/customer-health',
  '/api/clients',
  '/api/prospects',
  '/api/client',
  '/api/growth-assets',
  '/api/growth-search',
  '/api/growth-health',
  '/api/prospect',
  '/api/subscription',
  '/api/invoice',
  '/api/referral',
  '/api/growth-asset',
  '/api/growth-publish'
];

const PRODUCT_API_PREFIXES = [
  '/api/assessment',
  '/api/pathway-score',
  '/api/intelligence',
  '/api/teaming',
  '/api/blueprint',
  '/api/proposal-command/'
];

const PRODUCT_PAGE_PATHS = new Set([
  '/demo',
  '/teaming',
  '/opportunities',
  '/vehicles',
  '/recompetes',
  '/proposal-command',
  '/app.js',
  '/proposal-command.js',
  '/styles.css'
]);

function matchesPrefix(pathname, prefixes) {
  return prefixes.some(prefix => pathname === prefix || pathname.startsWith(prefix));
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('REQUEST_BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); }
      catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

function internalJsonRequest(port, targetPath, method = 'GET', payload = null) {
  return new Promise(resolve => {
    const body = payload == null ? null : JSON.stringify(payload);
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: targetPath,
      method,
      headers: body ? {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      } : undefined
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          statusCode: response.statusCode,
          json,
          text: json ? null : text
        });
      });
    });
    request.on('error', error => resolve({ ok: false, statusCode: 502, error: error.message }));
    if (body) request.write(body);
    request.end();
  });
}

async function handleRequestChanges(req, res, operationId) {
  let payload = {};
  try { payload = await readJsonBody(req); }
  catch (error) {
    sendJson(res, 400, { ok: false, status: error.message });
    return;
  }

  const instructions = String(payload.instructions || payload.reason || '').trim();
  const result = approvalGovernance.requestChanges(operationId, instructions);
  sendJson(res, result.ok ? 200 : 400, result);
}

async function handleGovernedDecision(req, res, operationId, action) {
  let payload = {};
  try { payload = await readJsonBody(req); }
  catch (error) {
    sendJson(res, 400, { ok: false, status: error.message });
    return;
  }

  if (action === 'request-changes') {
    const instructions = String(payload.instructions || payload.reason || '').trim();
    const result = approvalGovernance.requestChanges(operationId, instructions);
    sendJson(res, result.ok ? 200 : 400, result);
    return;
  }

  const validation = approvalGovernance.validateDecision(operationId);
  if (!validation.ok) {
    sendJson(res, 400, validation);
    return;
  }

  if (action === 'approve') {
    const normalized = approvalGovernance.normalizeForLegacyApprove(operationId);
    if (!normalized.ok) {
      sendJson(res, 400, normalized);
      return;
    }
  }

  const upstream = await internalJsonRequest(
    COMMAND_PORT,
    `/api/operations/${encodeURIComponent(operationId)}/${action}`,
    'POST',
    { reason: String(payload.reason || '').trim() }
  );

  if (!upstream.ok) {
    sendJson(res, upstream.statusCode || 400, upstream.json || {
      ok: false,
      status: 'DECISION_UPSTREAM_FAILED',
      operationId,
      action,
      error: upstream.text || upstream.error || null
    });
    return;
  }

  sendJson(res, upstream.statusCode || 200, upstream.json || {
    ok: true,
    status: action === 'approve' ? 'APPROVED' : 'REJECTED',
    operationId
  });
}

function upstreamRequest(req, res, port, options = {}) {
  const targetPath = options.path || req.url;
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  delete headers['content-length'];

  const request = http.request({
    hostname: '127.0.0.1',
    port,
    path: targetPath,
    method: req.method,
    headers
  }, upstream => {
    const chunks = [];
    upstream.on('data', chunk => chunks.push(chunk));
    upstream.on('end', () => {
      let body = Buffer.concat(chunks);
      const responseHeaders = { ...upstream.headers };
      delete responseHeaders['content-length'];
      delete responseHeaders['transfer-encoding'];

      if (typeof options.transform === 'function') {
        body = Buffer.from(options.transform(body.toString('utf8')), 'utf8');
      }

      responseHeaders['content-length'] = Buffer.byteLength(body);
      responseHeaders['cache-control'] = 'no-store';
      res.writeHead(upstream.statusCode || 502, responseHeaders);
      res.end(body);
    });
  });

  request.on('error', error => {
    if (res.headersSent) return res.end();
    sendJson(res, 502, {
      ok: false,
      status: 'UPSTREAM_UNAVAILABLE',
      port,
      error: error.message
    });
  });

  req.pipe(request);
}

function rewriteDashboardHtml(html) {
  return html
    .replaceAll('http://127.0.0.1:8791/demo', '/demo')
    .replaceAll('http://127.0.0.1:8791/teaming', '/teaming')
    .replaceAll('http://127.0.0.1:8791/opportunities', '/opportunities')
    .replaceAll('http://127.0.0.1:8791/vehicles', '/vehicles')
    .replaceAll('http://127.0.0.1:8791/recompetes', '/recompetes')
    .replaceAll('http://127.0.0.1:8791/proposal-command', '/proposal-command')
    .replaceAll('http://127.0.0.1:8787', '/execution');
}

function rewriteExecutionHtml(html) {
  return html
    .replace('href="/styles.css"', 'href="/execution/styles.css"')
    .replace('src="/app.js"', 'src="/execution/app.js"');
}

function createGatewayServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PUBLIC_PORT}`);
    const pathname = url.pathname;

    if (pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        status: 'HEALTHY',
        service: 'MILES_UNIFIED_CEO_GATEWAY',
        publicUrl: `http://127.0.0.1:${PUBLIC_PORT}`,
        upstreams: {
          commandCenter: `http://127.0.0.1:${COMMAND_PORT}`,
          executiveDashboard: `http://127.0.0.1:${DASHBOARD_PORT}`,
          productLaunchpad: `http://127.0.0.1:${PRODUCT_PORT}`
        },
        generatedAt: new Date().toISOString()
      });
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      upstreamRequest(req, res, DASHBOARD_PORT, { path: '/', transform: rewriteDashboardHtml });
      return;
    }

    if (pathname === '/ceo.js' || pathname === '/ceo.css' || pathname === '/legacy') {
      upstreamRequest(req, res, DASHBOARD_PORT);
      return;
    }

    if (pathname === '/execution' || pathname === '/execution/') {
      upstreamRequest(req, res, COMMAND_PORT, { path: '/', transform: rewriteExecutionHtml });
      return;
    }

    if (pathname === '/execution/app.js') {
      upstreamRequest(req, res, COMMAND_PORT, { path: '/app.js' });
      return;
    }

    if (pathname === '/execution/styles.css') {
      upstreamRequest(req, res, COMMAND_PORT, { path: '/styles.css' });
      return;
    }

    const decisionMatch = pathname.match(/^\/api\/operations\/([^/]+)\/(approve|reject|request-changes)$/);
    if (req.method === 'POST' && decisionMatch) {
      await handleGovernedDecision(req, res, decodeURIComponent(decisionMatch[1]), decisionMatch[2]);
      return;
    }

    if (matchesPrefix(pathname, COMMAND_API_PREFIXES)) {
      upstreamRequest(req, res, COMMAND_PORT);
      return;
    }

    if (matchesPrefix(pathname, DASHBOARD_API_PREFIXES)) {
      upstreamRequest(req, res, DASHBOARD_PORT);
      return;
    }

    if (matchesPrefix(pathname, PRODUCT_API_PREFIXES) || PRODUCT_PAGE_PATHS.has(pathname)) {
      upstreamRequest(req, res, PRODUCT_PORT);
      return;
    }

    sendJson(res, 404, {
      ok: false,
      status: 'NOT_FOUND',
      path: pathname,
      publicSurface: `http://127.0.0.1:${PUBLIC_PORT}`
    });
  });
}

function startInternalCommandCenter() {
  const commandPath = path.join(__dirname, 'MilesCommandCenter.js');
  return spawn(process.execPath, [commandPath], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, MILES_ROOT: ROOT, MILES_COMMAND_PORT: String(COMMAND_PORT) }
  });
}

function main() {
  const child = startInternalCommandCenter();
  const server = createGatewayServer();

  child.once('exit', (code, signal) => {
    console.error(`[MILES UNIFIED] Internal Command Center exited code=${code} signal=${signal}`);
    server.close(() => process.exit(code || 1));
  });

  server.listen(PUBLIC_PORT, '127.0.0.1', () => {
    console.log(`[MILES UNIFIED] CEO Control Center: http://127.0.0.1:${PUBLIC_PORT}`);
    console.log(`[MILES UNIFIED] Internal execution engine: http://127.0.0.1:${COMMAND_PORT}`);
    console.log(`[MILES UNIFIED] Dashboard upstream: http://127.0.0.1:${DASHBOARD_PORT}`);
    console.log(`[MILES UNIFIED] Product upstream: http://127.0.0.1:${PRODUCT_PORT}`);
  });

  const shutdown = signal => {
    console.log(`[MILES UNIFIED] Shutdown requested by ${signal}`);
    try { child.kill('SIGTERM'); } catch {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return { server, child };
}

if (require.main === module) main();

module.exports = {
  PUBLIC_PORT,
  COMMAND_PORT,
  DASHBOARD_PORT,
  PRODUCT_PORT,
  COMMAND_API_PREFIXES,
  DASHBOARD_API_PREFIXES,
  PRODUCT_API_PREFIXES,
  PRODUCT_PAGE_PATHS,
  matchesPrefix,
  sendJson,
  readJsonBody,
  internalJsonRequest,
  handleRequestChanges,
  handleGovernedDecision,
  rewriteDashboardHtml,
  rewriteExecutionHtml,
  createGatewayServer,
  startInternalCommandCenter,
  main
};
