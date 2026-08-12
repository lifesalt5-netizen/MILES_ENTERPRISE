'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');

function requestJson(method, port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {}
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('HTTP_TIMEOUT')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

(async () => {
  const health8787 = await requestJson('GET', 8787, '/api/health');
  const health3000Raw = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:3000', res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data.trim() }));
    }).on('error', reject);
  });

  const command = `MILES runtime acceptance ${Date.now()}: check current outbound campaign health and report what needs attention. Do not make any external changes.`;
  const submitted = await requestJson('POST', 8787, '/api/command', { command });
  const operation = submitted.body && submitted.body.operation;
  const operationId = operation && operation.id;

  await new Promise(resolve => setTimeout(resolve, 500));

  const businessQueue = readJson(
    path.join(ROOT, 'state', 'business_operations_queue.json'),
    { operations: [] }
  );
  const taskQueueRaw = readJson(
    path.join(ROOT, 'DATA', 'runtime', 'task_queue.json'),
    []
  );
  const tasks = Array.isArray(taskQueueRaw)
    ? taskQueueRaw
    : Array.isArray(taskQueueRaw.tasks)
      ? taskQueueRaw.tasks
      : Array.isArray(taskQueueRaw.items)
        ? taskQueueRaw.items
        : [];

  const queuedOperation = (businessQueue.operations || []).find(item => item.id === operationId);
  const matchingTask = tasks.find(task => {
    const payload = task.payload || {};
    return payload.sourceOperationId === operationId;
  });

  const checks = {
    api3000Listening: health3000Raw.statusCode >= 200 && health3000Raw.statusCode < 500,
    commandCenterHealthy: health8787.statusCode === 200 && health8787.body && health8787.body.ok === true,
    commandAccepted: submitted.statusCode === 200 && submitted.body && submitted.body.ok === true,
    operationIdCreated: Boolean(operationId),
    targetedBridgeSucceeded: Boolean(submitted.body && submitted.body.enqueueResult && submitted.body.enqueueResult.ok === true && submitted.body.enqueueResult.taskType === 'WORKFORCE_STEP'),
    businessOperationBridged: Boolean(queuedOperation && String(queuedOperation.status).toUpperCase() === 'BRIDGED'),
    workforceStepCreated: Boolean(matchingTask && matchingTask.type === 'WORKFORCE_STEP'),
    sourceOperationLinked: Boolean(matchingTask && matchingTask.payload && matchingTask.payload.sourceOperationId === operationId),
    noLegacyWorkerDispatchFailure: !(submitted.body && submitted.body.enqueueResult && /WORKER_NOT_FOUND|CUSTOM_TASK_NOT_IMPLEMENTED/.test(JSON.stringify(submitted.body.enqueueResult)))
  };

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  const ok = failed.length === 0;

  console.log(JSON.stringify({
    ok,
    gate: 'MILES_PRODUCTION_RUNTIME_ACCEPTANCE',
    externalWritesRequested: false,
    command,
    operationId,
    checks,
    failed,
    enqueueResult: submitted.body && submitted.body.enqueueResult,
    operationStatus: queuedOperation && queuedOperation.status,
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
