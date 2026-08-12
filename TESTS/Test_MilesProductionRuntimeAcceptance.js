'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');

function requestJson(method, port, urlPath, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
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
        try { resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : {} }); }
        catch { resolve({ statusCode: res.statusCode, body: data }); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('HTTP_TIMEOUT')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}

function taskList() {
  const raw = readJson(path.join(ROOT, 'DATA', 'runtime', 'task_queue.json'), []);
  return Array.isArray(raw) ? raw : Array.isArray(raw.tasks) ? raw.tasks : Array.isArray(raw.items) ? raw.items : [];
}

async function waitForOperation(operationId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const businessQueue = readJson(path.join(ROOT, 'state', 'business_operations_queue.json'), { operations: [] });
    const operation = (businessQueue.operations || []).find(item => item.id === operationId);
    const task = taskList().find(item => item && item.payload && item.payload.sourceOperationId === operationId);
    if (operation && ['BRIDGED', 'BRIDGE_FAILED'].includes(String(operation.status || '').toUpperCase())) {
      return { operation, task };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const businessQueue = readJson(path.join(ROOT, 'state', 'business_operations_queue.json'), { operations: [] });
  return {
    operation: (businessQueue.operations || []).find(item => item.id === operationId) || null,
    task: taskList().find(item => item && item.payload && item.payload.sourceOperationId === operationId) || null
  };
}

(async () => {
  const health8787 = await requestJson('GET', 8787, '/api/health', null, 5000);
  const health3000Raw = await new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:3000', res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data.trim() }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('HTTP_TIMEOUT_3000')));
    req.on('error', reject);
  });

  const command = `MILES runtime acceptance ${Date.now()}: check current outbound campaign health and report what needs attention. Do not make any external changes.`;
  const started = Date.now();
  const submitted = await requestJson('POST', 8787, '/api/command', { command }, 5000);
  const responseMs = Date.now() - started;
  const operation = submitted.body && submitted.body.operation;
  const operationId = operation && operation.id;
  const settled = operationId ? await waitForOperation(operationId, 30000) : { operation: null, task: null };
  const queuedOperation = settled.operation;
  const matchingTask = settled.task;
  const enqueue = submitted.body && submitted.body.enqueueResult;

  const checks = {
    api3000Listening: health3000Raw.statusCode >= 200 && health3000Raw.statusCode < 500,
    commandCenterHealthy: health8787.statusCode === 200 && health8787.body && health8787.body.ok === true,
    commandAccepted: submitted.statusCode === 200 && submitted.body && submitted.body.ok === true,
    commandResponseFast: responseMs < 5000,
    operationIdCreated: Boolean(operationId),
    targetedBridgeScheduled: Boolean(enqueue && enqueue.ok === true && enqueue.status === 'BRIDGE_SCHEDULED' && enqueue.taskType === 'WORKFORCE_STEP'),
    businessOperationBridged: Boolean(queuedOperation && String(queuedOperation.status).toUpperCase() === 'BRIDGED'),
    workforceStepCreated: Boolean(matchingTask && matchingTask.type === 'WORKFORCE_STEP'),
    sourceOperationLinked: Boolean(matchingTask && matchingTask.payload && matchingTask.payload.sourceOperationId === operationId),
    noLegacyWorkerDispatchFailure: !/WORKER_NOT_FOUND|CUSTOM_TASK_NOT_IMPLEMENTED/.test(JSON.stringify({ enqueue, queuedOperation, matchingTask }))
  };

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  const ok = failed.length === 0;

  console.log(JSON.stringify({
    ok,
    gate: 'MILES_PRODUCTION_RUNTIME_ACCEPTANCE',
    version: '1.1-async-bridge-polling',
    externalWritesRequested: false,
    responseMs,
    command,
    operationId,
    checks,
    failed,
    enqueueResult: enqueue,
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
    error: error.stack || error.message
  }, null, 2));
  process.exitCode = 1;
});
