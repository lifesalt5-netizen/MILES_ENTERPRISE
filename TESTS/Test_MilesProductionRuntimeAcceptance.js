'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');

function requestJson(method, port, urlPath, body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const startedAt = Date.now();
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {}
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : {}; } catch {}
        resolve({ statusCode: res.statusCode, body: parsed, elapsedMs: Date.now() - startedAt });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`HTTP_TIMEOUT_${port}_${timeoutMs}MS`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Raw HTTP/1.1 probe for the dedicated 3000 API process.
// This avoids a Node http.get false-timeout observed on Windows even while
// Invoke-WebRequest to the same 127.0.0.1 endpoint returns HTTP 200.
function requestText(port, urlPath, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    let raw = '';

    const finishError = error => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      reject(error);
    };

    const finishSuccess = () => {
      if (settled) return;
      const headerEnd = raw.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;

      const headerText = raw.slice(0, headerEnd);
      const body = raw.slice(headerEnd + 4).trim();
      const firstLine = headerText.split('\r\n')[0] || '';
      const match = firstLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i);
      if (!match) return finishError(new Error(`INVALID_HTTP_RESPONSE_${port}`));

      settled = true;
      try { socket.end(); } catch {}
      resolve({
        statusCode: Number(match[1]),
        body,
        elapsedMs: Date.now() - startedAt
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.write(
        `GET ${urlPath} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        'Connection: close\r\n\r\n'
      );
    });
    socket.on('data', chunk => {
      raw += chunk.toString('utf8');
      finishSuccess();
    });
    socket.once('timeout', () => finishError(new Error(`HTTP_TIMEOUT_${port}_${timeoutMs}MS`)));
    socket.once('error', finishError);
    socket.once('end', finishSuccess);
  });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}

function getTasks() {
  const raw = readJson(path.join(ROOT, 'DATA', 'runtime', 'task_queue.json'), []);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.tasks)) return raw.tasks;
  if (Array.isArray(raw.items)) return raw.items;
  return [];
}

function getOperation(operationId) {
  const queue = readJson(path.join(ROOT, 'state', 'business_operations_queue.json'), { operations: [] });
  return (queue.operations || []).find(item => item && item.id === operationId) || null;
}

function getMatchingTask(operationId) {
  return getTasks().find(task => task && task.payload && task.payload.sourceOperationId === operationId) || null;
}

async function waitForBridge(operationId, timeoutMs = 60000) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    const operation = getOperation(operationId);
    const task = getMatchingTask(operationId);
    const status = String(operation && operation.status || '').toUpperCase();
    if ((status === 'BRIDGED' && task) || status === 'BRIDGE_FAILED') {
      return { operation, task, elapsed: Date.now() - started };
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return { operation: getOperation(operationId), task: getMatchingTask(operationId), elapsed: Date.now() - started };
}

(async () => {
  const health8787 = await requestJson('GET', 8787, '/api/health', null, 5000);
  const health3000 = await requestText(3000, '/', 5000);

  const command = `MILES runtime acceptance ${Date.now()}: check current outbound campaign health and report what needs attention. Do not make any external changes.`;
  const submitted = await requestJson('POST', 8787, '/api/command', { command }, 5000);
  const operation = submitted.body && submitted.body.operation;
  const operationId = operation && operation.id;

  const bridged = operationId ? await waitForBridge(operationId, 60000) : { operation: null, task: null, elapsed: 0 };
  const queuedOperation = bridged.operation;
  const matchingTask = bridged.task;
  const enqueueResult = submitted.body && submitted.body.enqueueResult;
  const serialized = JSON.stringify({ submitted: submitted.body, operation: queuedOperation, task: matchingTask });

  const checks = {
    api3000Responsive: health3000.statusCode >= 200 && health3000.statusCode < 500 && health3000.elapsedMs < 5000,
    api3000ExpectedBody: /MILES OS is running/i.test(String(health3000.body || '')),
    commandCenterHealthy: health8787.statusCode === 200 && health8787.body && health8787.body.ok === true,
    commandCenterResponsive: health8787.elapsedMs < 5000,
    commandAccepted: submitted.statusCode === 200 && submitted.body && submitted.body.ok === true,
    commandResponseFast: submitted.elapsedMs < 5000,
    operationIdCreated: Boolean(operationId),
    executionDelegated: Boolean(enqueueResult && enqueueResult.ok === true && enqueueResult.status === 'QUEUED_FOR_PRODUCTION_BRIDGE' && enqueueResult.executionOwner === 'AUTONOMOUS_COO'),
    businessOperationBridged: Boolean(queuedOperation && String(queuedOperation.status || '').toUpperCase() === 'BRIDGED'),
    workforceStepCreated: Boolean(matchingTask && matchingTask.type === 'WORKFORCE_STEP'),
    sourceOperationLinked: Boolean(matchingTask && matchingTask.payload && matchingTask.payload.sourceOperationId === operationId),
    noLegacyWorkerDispatchFailure: !/WORKER_NOT_FOUND|CUSTOM_TASK_NOT_IMPLEMENTED/.test(serialized),
    commandCenterStillResponsiveAfterBridge: false,
    api3000StillResponsiveAfterBridge: false
  };

  try {
    const healthAfter = await requestJson('GET', 8787, '/api/health', null, 5000);
    checks.commandCenterStillResponsiveAfterBridge = healthAfter.statusCode === 200 && healthAfter.body && healthAfter.body.ok === true && healthAfter.elapsedMs < 5000;
  } catch {}

  try {
    const apiAfter = await requestText(3000, '/', 5000);
    checks.api3000StillResponsiveAfterBridge = apiAfter.statusCode >= 200 && apiAfter.statusCode < 500 && apiAfter.elapsedMs < 5000;
  } catch {}

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  const ok = failed.length === 0;

  console.log(JSON.stringify({
    ok,
    gate: 'MILES_PRODUCTION_RUNTIME_ACCEPTANCE',
    version: '1.4-windows-raw-http-api-probe',
    externalWritesRequested: false,
    command,
    operationId,
    timings: {
      health8787Ms: health8787.elapsedMs,
      health3000Ms: health3000.elapsedMs,
      commandResponseMs: submitted.elapsedMs,
      bridgeWaitMs: bridged.elapsed
    },
    checks,
    failed,
    enqueueResult,
    operationStatus: queuedOperation && queuedOperation.status,
    operationError: queuedOperation && queuedOperation.error,
    task: matchingTask ? {
      id: matchingTask.id,
      type: matchingTask.type,
      status: matchingTask.status,
      action: matchingTask.payload && matchingTask.payload.action,
      provider: matchingTask.payload && matchingTask.payload.provider
    } : null
  }, null, 2));

  process.exitCode = ok ? 0 : 1;
})().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    gate: 'MILES_PRODUCTION_RUNTIME_ACCEPTANCE',
    version: '1.4-windows-raw-http-api-probe',
    error: error.stack || error.message
  }, null, 2));
  process.exitCode = 1;
});