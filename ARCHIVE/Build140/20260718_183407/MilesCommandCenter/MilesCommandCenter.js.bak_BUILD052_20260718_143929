'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const DigitalCOOHost = require('./DigitalCOOHost');
const CommandIntentPlannerService = require('../CommandIntentPlannerService');
const ExecutiveResponseService = require('../ExecutiveResponseService');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.MILES_COMMAND_PORT || 8787);

const stateDir = path.join(ROOT, 'state');
const logsDir = path.join(ROOT, 'logs');
const queueFile = path.join(stateDir, 'business_operations_queue.json');
const logFile = path.join(logsDir, 'miles_command_center.log');

fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

function now() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function log(level, message, metadata = {}) {
  fs.appendFileSync(
    logFile,
    JSON.stringify({
      timestamp: now(),
      level,
      service: 'MILES_COMMAND_CENTER',
      message,
      metadata
    }) + '\n'
  );
}

function classifyWorker(text, plan = {}) {
  const provider = String(plan.provider || '').toUpperCase();
  const action = String(plan.action || '').toUpperCase();
  const t = String(text || '').toLowerCase();

  if (provider === 'INSTANTLY') return 'revenueWorker';
  if (provider === 'ORION') return 'atlasWorker';
  if (provider === 'GOOGLE') return 'cooWorker';
  if (provider === 'WEBSITE') return 'cooWorker';
  if (provider === 'LINKEDIN') return 'cooWorker';

  if (action.startsWith('INSTANTLY_')) return 'revenueWorker';
  if (action.startsWith('ORION_')) return 'atlasWorker';
  if (action.startsWith('GOOGLE_')) return 'cooWorker';
  if (action.startsWith('WEBSITE_')) return 'cooWorker';
  if (action.startsWith('LINKEDIN_')) return 'cooWorker';

  if (t.includes('instantly') || t.includes('campaign') || t.includes('email') || t.includes('lead')) return 'revenueWorker';
  if (t.includes('reply') || t.includes('respond') || t.includes('inbox')) return 'replyWorker';
  if (t.includes('deal') || t.includes('proposal') || t.includes('close')) return 'dealWorker';
  if (t.includes('orion') || t.includes('opportunit') || t.includes('sled') || t.includes('contract')) return 'atlasWorker';
  if (t.includes('website') || t.includes('linkedin') || t.includes('marketing')) return 'cooWorker';
  if (t.includes('run') || t.includes('start') || t.includes('check') || t.includes('status')) return 'dispatcherWorker';

  return 'cooWorker';
}

function needsApproval(text) {
  const t = String(text || '').toLowerCase();

  return [
    'change pricing',
    'send proposal',
    'final proposal',
    'sign',
    'agreement',
    'hire',
    'fire',
    'delete',
    'legal',
    'financial commitment',
    'contract'
  ].some((term) => t.includes(term));
}

function normalizeProvider(provider) {
  const value = String(provider || 'MILES').trim();

  if (value.toLowerCase() === 'website') return 'Website';
  if (value.toLowerCase() === 'linkedin') return 'LinkedIn';

  return value.toUpperCase();
}

function makeOperation(command, plan = {}) {
  const normalizedPlan = plan && plan.ok
    ? plan
    : CommandIntentPlannerService.plan({ command });

  const provider = normalizeProvider(normalizedPlan.provider || 'MILES');
  const action = normalizedPlan.action || 'MILES_EXECUTE';

  const worker = classifyWorker(command, {
    ...normalizedPlan,
    provider,
    action
  });

  const approvalRequired = needsApproval(command);

  return {
    id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'MILES_COMMAND_CENTER',
    type: approvalRequired ? 'CEO_APPROVAL_OPERATION' : action,
    status: approvalRequired ? 'WAITING_FOR_CEO_APPROVAL' : 'READY',
    priority: 1,
    worker,
    area: worker.replace('Worker', ''),
    provider,
    system: normalizedPlan.system || provider,
    connector: normalizedPlan.connector || provider,
    department: normalizedPlan.department || provider,
    title: String(command || '').slice(0, 120),
    command,
    action,
    intent: normalizedPlan.intent,
    objective: normalizedPlan.objective || command,
    plan: {
      ...normalizedPlan,
      provider,
      system: normalizedPlan.system || provider,
      connector: normalizedPlan.connector || provider,
      department: normalizedPlan.department || provider,
      action
    },
    approvalRequired,
    ceoEscalationOnly: approvalRequired,
    createdAt: now(),
    updatedAt: now(),
    result: null
  };
}

function addToQueue(operation) {
  const queue = readJson(queueFile, {
    generatedAt: now(),
    source: 'MILES_COMMAND_CENTER',
    operations: []
  });

  queue.operations = Array.isArray(queue.operations) ? queue.operations : [];
  queue.operations.unshift(operation);
  queue.generatedAt = now();

  writeJson(queueFile, queue);
}

const host = new DigitalCOOHost({ rootDir: ROOT });
const executiveResponses = new ExecutiveResponseService({ rootDir: ROOT });

async function handleCommand(command) {
  const cleanCommand = String(command || '').trim();

  if (!cleanCommand) {
    return {
      ok: false,
      status: 'EMPTY_COMMAND',
      message: 'No command was provided.'
    };
  }

  const plan = CommandIntentPlannerService.plan({
    command: cleanCommand
  });

  const operation = makeOperation(cleanCommand, plan);

  addToQueue(operation);

  let enqueueResult = null;

  if (host && typeof host.enqueueOperation === 'function') {
    enqueueResult = await host.enqueueOperation(operation);
  }

  log('INFO', `Command accepted: ${cleanCommand}`, {
    operationId: operation.id,
    provider: operation.provider,
    action: operation.action,
    worker: operation.worker,
    approvalRequired: operation.approvalRequired
  });

  return {
    ok: true,
    status: 'COMMAND_ACCEPTED',
    message: operation.approvalRequired
      ? 'Miles created a CEO approval item.'
      : 'Miles accepted the work, planned the intent, and added it to the operations queue.',
    operation,
    enqueueResult
  };
}

function page() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Miles Command Center</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background:#0f172a;
      color:#e5e7eb;
      margin:0;
    }
    .wrap {
      max-width: 960px;
      margin: 40px auto;
      padding: 24px;
    }
    h1 {
      margin-bottom: 4px;
    }
    .sub {
      color:#94a3b8;
      margin-bottom:24px;
    }
    textarea {
      width:100%;
      height:120px;
      font-size:18px;
      padding:14px;
      border-radius:10px;
      border:0;
      box-sizing:border-box;
    }
    button {
      margin-top:12px;
      padding:12px 20px;
      font-size:16px;
      border:0;
      border-radius:10px;
      cursor:pointer;
      background:#22c55e;
      color:#052e16;
      font-weight:bold;
    }
    .card {
      background:#111827;
      padding:18px;
      border-radius:12px;
      margin-top:20px;
      white-space:pre-wrap;
      overflow:auto;
    }
    .ok {
      color:#86efac;
      font-weight:bold;
    }
    .warn {
      color:#fde68a;
      font-weight:bold;
    }
    .bad {
      color:#fca5a5;
      font-weight:bold;
    }
    .muted {
      color:#94a3b8;
    }
    .grid {
      display:grid;
      grid-template-columns: repeat(4, 1fr);
      gap:12px;
      margin-top:16px;
    }
    .mini {
      background:#020617;
      border:1px solid #1e293b;
      border-radius:10px;
      padding:12px;
    }
    .mini .label {
      color:#94a3b8;
      font-size:12px;
      margin-bottom:6px;
    }
    .mini .value {
      font-size:16px;
      font-weight:bold;
      word-break:break-word;
    }
    pre {
      background:#020617;
      border:1px solid #1e293b;
      border-radius:10px;
      padding:14px;
      overflow:auto;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Miles Command Center</h1>
    <div class="sub">Tell Miles what you need done. Miles will create an operation, assign a worker, track it, and report back.</div>

    <textarea id="cmd" placeholder="Example: Miles, check ORION system health and produce an executive status report."></textarea>
    <br />
    <button onclick="send()">Give this to Miles</button>

    <div id="out" class="card">Miles is ready.</div>
  </div>

<script>
let currentOperationId = null;
let pollTimer = null;

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function statusClass(status) {
  const s = String(status || '').toUpperCase();

  if (s === 'COMPLETED' || s === 'COMMAND_ACCEPTED' || s === 'READY') return 'ok';
  if (s === 'FAILED' || s === 'ERROR') return 'bad';
  return 'warn';
}

function renderAccepted(data) {
  const op = data.operation || {};

  document.getElementById('out').innerHTML =
    '<span class="' + statusClass(data.status) + '">' + esc(data.status) + '</span>\\n\\n' +
    esc(data.message || '') +
    '<div class="grid">' +
      '<div class="mini"><div class="label">Operation</div><div class="value">' + esc(op.id || '') + '</div></div>' +
      '<div class="mini"><div class="label">Provider</div><div class="value">' + esc(op.provider || '') + '</div></div>' +
      '<div class="mini"><div class="label">Action</div><div class="value">' + esc(op.action || '') + '</div></div>' +
      '<div class="mini"><div class="label">Status</div><div class="value">' + esc(op.status || '') + '</div></div>' +
    '</div>' +
    '\\n\\n<span class="muted">Miles is tracking this operation. Waiting for execution updates...</span>' +
    '\\n\\n<pre>' + esc(JSON.stringify(op, null, 2)) + '</pre>';
}

function renderResponse(data) {
  const latest = data.latestTask || {};
  const status = data.status || 'UNKNOWN';

  document.getElementById('out').innerHTML =
    '<span class="' + statusClass(status) + '">' + esc(status) + '</span>\\n\\n' +
    esc(data.message || '') +
    '<div class="grid">' +
      '<div class="mini"><div class="label">Operation</div><div class="value">' + esc(data.operationId || '') + '</div></div>' +
      '<div class="mini"><div class="label">Provider</div><div class="value">' + esc(data.provider || '') + '</div></div>' +
      '<div class="mini"><div class="label">Action</div><div class="value">' + esc(data.action || '') + '</div></div>' +
      '<div class="mini"><div class="label">Task Status</div><div class="value">' + esc(latest.status || status) + '</div></div>' +
    '</div>' +
    '\\n\\n<pre>' + esc(JSON.stringify(data, null, 2)) + '</pre>';
}

async function send() {
  const command = document.getElementById('cmd').value.trim();
  if (!command) return;

  document.getElementById('out').textContent = 'Sending to Miles...';

  const res = await fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command })
  });

  const data = await res.json();

  if (!data.ok) {
    document.getElementById('out').innerHTML =
      '<span class="bad">' + esc(data.status || 'ERROR') + '</span>\\n\\n' +
      esc(data.message || data.error || 'Unknown error');
    return;
  }

  currentOperationId = data.operation && data.operation.id;

  renderAccepted(data);

  if (currentOperationId) {
    startPolling(currentOperationId);
  }
}

function startPolling(operationId) {
  if (pollTimer) clearInterval(pollTimer);

  pollOperation(operationId);

  pollTimer = setInterval(function() {
    pollOperation(operationId);
  }, 3000);
}

async function pollOperation(operationId) {
  try {
    const res = await fetch('/api/operation?id=' + encodeURIComponent(operationId));
    const data = await res.json();

    renderResponse(data);

    const s = String(data.status || '').toUpperCase();

    if (
      s === 'COMPLETED' ||
      s === 'FAILED' ||
      s === 'AWAITING_APPROVAL' ||
      s === 'WAITING_FOR_CEO_APPROVAL'
    ) {
      if (pollTimer) clearInterval(pollTimer);
    }
  } catch (error) {
    document.getElementById('out').innerHTML =
      '<span class="bad">POLLING_ERROR</span>\\n\\n' +
      esc(error.message);
  }
}
</script>
</body>
</html>`;
}

async function start() {
  await host.start();

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page());
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/operation')) {
      try {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        const id = url.searchParams.get('id');

        const result = executiveResponses.getResponse(id);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
      } catch (error) {
        log('ERROR', 'Operation response failed', {
          error: error.message
        });

        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error.message }, null, 2));
      }

      return;
    }

    if (req.method === 'POST' && req.url === '/api/command') {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = await handleCommand(String(payload.command || '').trim());

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result, null, 2));
        } catch (error) {
          log('ERROR', 'Command handling failed', {
            error: error.message
          });

          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error.message }, null, 2));
        }
      });

      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, () => {
    console.log(`Miles Command Center running: http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop.');
  });

  process.on('SIGINT', async () => {
    console.log('\\nStopping Miles...');
    await host.stop();
    process.exit(0);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
