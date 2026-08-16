'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const CommandIntentPlannerService = require('../CommandIntentPlannerService');
const ExecutiveResponseService = require('../ExecutiveResponseService');
const BusinessOperationsBridgeService = require('../BusinessOperationsBridgeService');
const workforce = require('../WorkforceService');
const taskQueue = require('../../CORE/TaskQueue');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.MILES_COMMAND_PORT || 8787);
const STATE_DIR = path.join(ROOT, 'state');
const LOGS_DIR = path.join(ROOT, 'logs');
const QUEUE_FILE = path.join(STATE_DIR, 'business_operations_queue.json');
const LOG_FILE = path.join(LOGS_DIR, 'miles_command_center.log');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

const bridge = new BusinessOperationsBridgeService({
  rootDir: ROOT,
  taskQueue,
  queueFile: QUEUE_FILE
});

const executiveResponses = new ExecutiveResponseService({
  rootDir: ROOT
});

const CANONICAL_DEPARTMENTS = Object.freeze([
  'Executive Operations',
  'Revenue Operations',
  'Sales Operations',
  'Marketing Operations',
  'Client Delivery',
  'Customer Success',
  'Executive Demo Operations',
  'ORION Intelligence',
  'Government Intelligence',
  'Opportunity Intelligence',
  'Vehicle Intelligence',
  'Recompete Intelligence',
  'Capture Strategy',
  'Proposal Operations',
  'Website Operations',
  'Engineering Operations'
]);

function now() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(temporary, file);
  } catch {
    fs.copyFileSync(temporary, file);
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function log(level, message, metadata = {}) {
  try {
    fs.appendFileSync(
      LOG_FILE,
      JSON.stringify({
        timestamp: now(),
        level,
        service: 'MILES_COMMAND_CENTER',
        message,
        metadata
      }) + '\n',
      'utf8'
    );
  } catch {}
}

function safeStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof Error) {
      return {
        name: item.name,
        message: item.message,
        stack: item.stack
      };
    }
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[Circular]';
      seen.add(item);
    }
    return item;
  }, 2);
}

function sendJson(res, statusCode, value) {
  let body;
  try {
    body = safeStringify(value);
  } catch (error) {
    statusCode = 500;
    body = JSON.stringify({
      ok: false,
      status: 'SERIALIZATION_FAILED',
      error: error.message
    }, null, 2);
  }

  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Connection': 'close'
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  const body = Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf8');
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendFile(res, file, contentType) {
  try {
    sendText(res, 200, fs.readFileSync(file), contentType);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      status: 'STATIC_ASSET_FAILED',
      error: error.message
    });
  }
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function queueState() {
  const queue = readJson(QUEUE_FILE, {
    generatedAt: null,
    source: 'MILES_COMMAND_CENTER',
    operations: []
  });
  queue.operations = Array.isArray(queue.operations) ? queue.operations : [];
  return queue;
}

function saveOperation(operation) {
  const queue = queueState();
  const index = queue.operations.findIndex(item => item && item.id === operation.id);
  if (index >= 0) queue.operations[index] = operation;
  else queue.operations.unshift(operation);
  queue.generatedAt = now();
  queue.source = 'MILES_COMMAND_CENTER';
  writeJson(QUEUE_FILE, queue);
  return operation;
}

function updateOperation(operationId, patch = {}) {
  const queue = queueState();
  const index = queue.operations.findIndex(item => item && item.id === operationId);
  if (index < 0) return null;
  queue.operations[index] = {
    ...queue.operations[index],
    ...patch,
    updatedAt: now()
  };
  queue.generatedAt = now();
  writeJson(QUEUE_FILE, queue);
  return queue.operations[index];
}

function normalizeProvider(provider) {
  const value = String(provider || 'MILES').trim();
  if (value.toLowerCase() === 'website') return 'Website';
  if (value.toLowerCase() === 'linkedin') return 'LinkedIn';
  return value.toUpperCase();
}

function requiresCEOApproval(command, plan = {}) {
  const text = String(command || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const action = String(plan.action || '').toUpperCase();
  const protectedActions = new Set([
    'CHANGE_PRICING',
    'PRICING_CHANGE',
    'SEND_PROPOSAL',
    'SUBMIT_PROPOSAL',
    'SIGN_AGREEMENT',
    'SIGN_CONTRACT',
    'HIRE',
    'FIRE',
    'DELETE_PRODUCTION_DATA',
    'MAKE_FINANCIAL_COMMITMENT'
  ]);
  if (protectedActions.has(action)) return true;
  return [
    /\b(change|set|increase|decrease|discount|override)\s+(our\s+)?pricing\b/,
    /\b(send|submit|deliver)\s+(the\s+|a\s+)?(final\s+)?proposal\b/,
    /\b(sign|execute)\s+(the\s+|a\s+|an\s+)?(agreement|contract|legal document)\b/,
    /\b(hire|fire|terminate)\s+(an?\s+|the\s+)?(employee|contractor|staff|person|worker)\b/,
    /\b(delete|drop|destroy|purge)\s+(production\s+)?(database|records?|data|campaign|account|repository|repo)\b/,
    /\b(make|approve|authorize|commit|spend|purchase|pay)\b.{0,60}\b(financial commitment|payment|expense|purchase|spend|budget)\b/
  ].some(pattern => pattern.test(text));
}

function makeOperation(command) {
  const plan = CommandIntentPlannerService.plan({ command });
  const provider = normalizeProvider(plan.provider || 'MILES');
  const action = plan.action || plan.capability || 'BUSINESS_EXECUTION';
  const approvalRequired = requiresCEOApproval(command, plan);

  return {
    id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'MILES_COMMAND_CENTER',
    type: action,
    status: approvalRequired ? 'AWAITING_APPROVAL' : 'READY',
    priority: 1,
    provider,
    system: plan.system || provider,
    connector: plan.connector || provider,
    department: plan.department || provider,
    action,
    capability: plan.capability || action,
    workflow: plan.workflow || null,
    intent: plan.intent || null,
    title: String(command || '').slice(0, 160),
    command,
    objective: plan.objective || command,
    plan: {
      ...plan,
      provider,
      system: plan.system || provider,
      connector: plan.connector || provider,
      department: plan.department || provider,
      action,
      capability: plan.capability || action,
      originalCommand: plan.originalCommand || command,
      objective: plan.objective || command
    },
    approvalRequired,
    ceoEscalationOnly: approvalRequired,
    createdAt: now(),
    updatedAt: now(),
    result: null
  };
}

function bridgeOperation(operation) {
  const task = bridge.enqueueTask(operation);
  const taskId = task && (task.id || task.taskId) ? (task.id || task.taskId) : null;
  const updated = updateOperation(operation.id, {
    status: 'BRIDGED',
    bridgedAt: now(),
    taskQueueStatus: 'QUEUED',
    taskId
  });
  return {
    ok: Boolean(taskId),
    status: taskId ? 'BRIDGE_COMPLETED' : 'BRIDGE_FAILED',
    operationId: operation.id,
    taskId,
    operationsFound: 1,
    operationsQueued: taskId ? 1 : 0,
    operationsFailed: taskId ? 0 : 1,
    operation: updated || operation
  };
}

async function handleCommand(command) {
  const clean = String(command || '').trim();
  if (!clean) {
    return {
      ok: false,
      status: 'EMPTY_COMMAND',
      message: 'command is required'
    };
  }

  const operation = makeOperation(clean);
  saveOperation(operation);

  if (operation.approvalRequired) {
    log('INFO', 'Command routed to CEO approval.', {
      operationId: operation.id,
      action: operation.action
    });
    return {
      ok: true,
      status: 'AWAITING_APPROVAL',
      operation,
      enqueueResult: {
        ok: false,
        status: 'AWAITING_APPROVAL',
        operationId: operation.id,
        taskId: null
      }
    };
  }

  try {
    const enqueueResult = bridgeOperation(operation);
    log(enqueueResult.ok ? 'INFO' : 'ERROR', 'Command bridged to canonical TaskQueue.', {
      operationId: operation.id,
      taskId: enqueueResult.taskId,
      provider: operation.provider,
      action: operation.action
    });
    return {
      ok: enqueueResult.ok,
      status: enqueueResult.ok ? 'COMMAND_ACCEPTED' : 'BRIDGE_FAILED',
      message: enqueueResult.ok
        ? 'Miles accepted the CEO command and bridged it to the canonical execution queue.'
        : 'Miles could not bridge the CEO command to the execution queue.',
      operation: enqueueResult.operation,
      enqueueResult
    };
  } catch (error) {
    updateOperation(operation.id, {
      status: 'BRIDGE_FAILED',
      bridgeFailedAt: now(),
      taskQueueStatus: 'FAILED',
      error: error.message
    });
    log('ERROR', 'Command bridge failed.', {
      operationId: operation.id,
      error: error.message
    });
    return {
      ok: false,
      status: 'BRIDGE_FAILED',
      operation,
      enqueueResult: {
        ok: false,
        status: 'BRIDGE_FAILED',
        operationId: operation.id,
        taskId: null,
        error: error.message
      }
    };
  }
}

function taskQueueSummary() {
  try {
    const items = typeof taskQueue.list === 'function' ? taskQueue.list() : [];
    const counts = {
      total: items.length,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      awaitingApproval: 0,
      other: 0
    };
    for (const item of items) {
      const status = String(item?.status || '').toUpperCase();
      if (['QUEUED', 'READY', 'PENDING'].includes(status)) counts.queued += 1;
      else if (['RUNNING', 'IN_PROGRESS'].includes(status)) counts.running += 1;
      else if (['COMPLETED', 'COMPLETE'].includes(status)) counts.completed += 1;
      else if (status === 'FAILED') counts.failed += 1;
      else if (['AWAITING_APPROVAL', 'AWAITING_CEO_APPROVAL'].includes(status)) counts.awaitingApproval += 1;
      else counts.other += 1;
    }
    return { ok: true, ...counts };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function buildDepartments() {
  let employees = [];
  try { employees = workforce.all(); } catch {}
  return CANONICAL_DEPARTMENTS.map(name => {
    const needle = name.toLowerCase().replace(/ operations| intelligence| strategy| delivery/g, '').trim();
    const workers = employees.filter(employee =>
      String(employee.department || '').toLowerCase().includes(needle) ||
      String(employee.role || '').toLowerCase().includes(needle)
    );
    return {
      name,
      status: 'REGISTERED',
      health: workers.length ? 'WORKFORCE_MAPPED' : 'CONTROL_PLANE_READY',
      workerCount: workers.length,
      workers: workers.slice(0, 8).map(employee => employee.name || employee.employee || employee.id).filter(Boolean)
    };
  });
}

function healthPayload() {
  const queue = taskQueueSummary();
  let workforceStatus = null;
  try { workforceStatus = workforce.status(); } catch (error) {
    workforceStatus = { ok: false, error: error.message };
  }
  return {
    ok: queue.ok === true && workforceStatus?.ok === true,
    service: 'MILES_COMMAND_CENTER',
    status: queue.ok === true && workforceStatus?.ok === true ? 'HEALTHY' : 'DEGRADED',
    architecture: 'LEAN_CONTROL_PLANE',
    executionOwner: 'miles-worker',
    autonomousOwner: 'miles-autonomous-coo',
    port: PORT,
    pid: process.pid,
    taskQueue: queue,
    workforce: workforceStatus,
    bridge: bridge.getStatus(),
    generatedAt: now()
  };
}

function dashboardPayload() {
  const queue = queueState();
  return {
    ok: true,
    service: 'MILES_COMMAND_CENTER',
    status: 'READY',
    generatedAt: now(),
    departments: buildDepartments(),
    taskQueue: taskQueueSummary(),
    workforce: (() => {
      try { return workforce.status(); } catch (error) { return { ok:false, error:error.message }; }
    })(),
    bridge: bridge.getStatus(),
    operations: queue.operations.slice(0, 50),
    surfaces: {
      commandCenter: 'http://127.0.0.1:8787',
      ceoDashboard: 'http://127.0.0.1:8737',
      desktop: 'http://127.0.0.1:3737',
      prospectDemo: 'http://127.0.0.1:8791',
      customerDelivery: 'http://127.0.0.1:8792'
    }
  };
}

function demoPayload() {
  return {
    ok: true,
    service: 'MILES_COMMAND_CENTER',
    status: 'DEMO_CONTROL_READY',
    readOnly: true,
    writesEnabled: false,
    prospectDemo: {
      url: 'http://127.0.0.1:8791',
      purpose: 'P2GC Executive Government Growth Blueprint prospect demonstration'
    },
    customerDelivery: {
      url: 'http://127.0.0.1:8792',
      purpose: 'P2GC customer delivery and revenue command layer'
    },
    generatedAt: now()
  };
}

function operationResponse(operationId) {
  return executiveResponses.getResponse(operationId);
}

function approveOperation(operationId, reason = '') {
  const queue = queueState();
  const operation = queue.operations.find(item => item && item.id === operationId);
  if (!operation) return { ok:false, status:'NOT_FOUND', operationId };
  if (!['AWAITING_APPROVAL', 'WAITING_FOR_CEO_APPROVAL'].includes(String(operation.status || '').toUpperCase())) {
    return { ok:false, status:'INVALID_STATUS', operationId, currentStatus:operation.status };
  }
  const approved = updateOperation(operationId, {
    status: 'READY',
    approvalDecision: 'APPROVED',
    approvedBy: 'CEO',
    approvedAt: now(),
    approvalReason: reason
  });
  try {
    const enqueueResult = bridgeOperation(approved);
    return { ok:enqueueResult.ok, status:enqueueResult.ok ? 'APPROVED_AND_BRIDGED' : 'APPROVED_BRIDGE_FAILED', operation:enqueueResult.operation, enqueueResult };
  } catch (error) {
    updateOperation(operationId, { status:'BRIDGE_FAILED', error:error.message });
    return { ok:false, status:'APPROVED_BRIDGE_FAILED', operationId, error:error.message };
  }
}

function rejectOperation(operationId, reason = '') {
  const operation = updateOperation(operationId, {
    status: 'REJECTED',
    approvalDecision: 'REJECTED',
    rejectedBy: 'CEO',
    rejectedAt: now(),
    approvalReason: reason
  });
  return operation
    ? { ok:true, status:'REJECTED', operation }
    : { ok:false, status:'NOT_FOUND', operationId };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const health = healthPayload();
      sendJson(res, health.ok ? 200 : 503, health);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/dashboard') {
      sendJson(res, 200, dashboardPayload());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/demo') {
      sendJson(res, 200, demoPayload());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/operation') {
      const operationId = url.searchParams.get('id');
      if (!operationId) {
        sendJson(res, 400, { ok:false, status:'OPERATION_ID_REQUIRED' });
        return;
      }
      const result = operationResponse(operationId);
      sendJson(res, result?.ok ? 200 : 404, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/command') {
      const raw = await readBody(req);
      let payload;
      try { payload = JSON.parse(raw || '{}'); }
      catch {
        sendJson(res, 400, { ok:false, status:'INVALID_JSON' });
        return;
      }
      const result = await handleCommand(payload.command);
      sendJson(res, result.ok ? 200 : 500, result);
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/operations/')) {
      const segments = url.pathname.split('/').filter(Boolean);
      const operationId = segments[2];
      const action = segments[3];
      if (!operationId || !['approve', 'reject'].includes(action || '')) {
        sendJson(res, 400, { ok:false, status:'INVALID_OPERATION_ACTION' });
        return;
      }
      const raw = await readBody(req);
      let payload = {};
      try { payload = JSON.parse(raw || '{}'); } catch {}
      const result = action === 'approve'
        ? approveOperation(operationId, payload.reason || '')
        : rejectOperation(operationId, payload.reason || '');
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      sendFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/app.js') {
      sendFile(res, path.join(PUBLIC_DIR, 'app.js'), 'application/javascript; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/styles.css') {
      sendFile(res, path.join(PUBLIC_DIR, 'styles.css'), 'text/css; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      res.writeHead(204, { 'Cache-Control':'no-store' });
      res.end();
      return;
    }

    sendJson(res, 404, { ok:false, status:'NOT_FOUND', path:url.pathname });
  } catch (error) {
    log('ERROR', 'Unhandled Command Center request failure.', {
      method: req.method,
      url: req.url,
      error: error.stack || error.message
    });
    sendJson(res, 500, {
      ok: false,
      status: 'COMMAND_CENTER_REQUEST_FAILED',
      error: error.message
    });
  }
});

server.on('clientError', (error, socket) => {
  log('ERROR', 'HTTP client error.', { error:error.message });
  try {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    }
  } catch {}
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Miles Command Center running: http://127.0.0.1:${PORT}`);
  console.log('Architecture: lean control plane -> BusinessOperationsBridgeService -> TaskQueue -> miles-worker');
});

function shutdown(signal) {
  console.log(`\nStopping Miles Command Center (${signal})...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
