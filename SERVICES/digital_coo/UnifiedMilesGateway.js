'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..', '..');
const PUBLIC_PORT = Number(process.env.MILES_UNIFIED_PORT || 8787);
const COMMAND_PORT = Number(process.env.MILES_INTERNAL_COMMAND_PORT || 8788);
const DASHBOARD_PORT = Number(process.env.MILES_DASHBOARD_PORT || 8737);
const PRODUCT_PORT = Number(process.env.P2GC_GROWTH_DEMO_PORT || 8791);

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
    const body = JSON.stringify({
      ok: false,
      status: 'UPSTREAM_UNAVAILABLE',
      port,
      error: error.message
    }, null, 2);
    res.writeHead(502, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store'
    });
    res.end(body);
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
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PUBLIC_PORT}`);
    const pathname = url.pathname;

    if (pathname === '/api/health') {
      const body = JSON.stringify({
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
      }, null, 2);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store'
      });
      res.end(body);
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      upstreamRequest(req, res, DASHBOARD_PORT, {
        path: '/',
        transform: rewriteDashboardHtml
      });
      return;
    }

    if (pathname === '/ceo.js' || pathname === '/ceo.css' || pathname === '/legacy') {
      upstreamRequest(req, res, DASHBOARD_PORT);
      return;
    }

    if (pathname === '/execution' || pathname === '/execution/') {
      upstreamRequest(req, res, COMMAND_PORT, {
        path: '/',
        transform: rewriteExecutionHtml
      });
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

    const body = JSON.stringify({
      ok: false,
      status: 'NOT_FOUND',
      path: pathname,
      publicSurface: `http://127.0.0.1:${PUBLIC_PORT}`
    }, null, 2);
    res.writeHead(404, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store'
    });
    res.end(body);
  });
}

function startInternalCommandCenter() {
  const commandPath = path.join(__dirname, 'MilesCommandCenter.js');
  return spawn(process.execPath, [commandPath], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      MILES_ROOT: ROOT,
      MILES_COMMAND_PORT: String(COMMAND_PORT)
    }
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
  rewriteDashboardHtml,
  rewriteExecutionHtml,
  createGatewayServer,
  startInternalCommandCenter,
  main
};
