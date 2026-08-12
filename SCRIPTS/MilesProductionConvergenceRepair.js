'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const stamp = Date.now();

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`MISSING_FILE: ${file}`);
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

function writePatched(file, source) {
  const backup = `${file}.bak_convergence_${stamp}`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, source, 'utf8');
  return backup;
}

function mustContain(source, markers, label) {
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${label}_VALIDATION_FAILED: ${marker}`);
  }
}

function patchBridge() {
  const file = path.join(ROOT, 'SERVICES', 'BusinessOperationsBridgeService.js');
  let source = read(file);

  if (!source.includes('async bridgeOperation(operationId)')) {
    const marker = /\n\s*async runOnce\(\)\s*\{/;
    const match = source.match(marker);
    if (!match || match.index == null) throw new Error('BRIDGE_RUNONCE_ANCHOR_NOT_FOUND');

    const method = `
  async bridgeOperation(operationId) {
    if (!this.enabled) return { ok: true, status: "DISABLED", operationId, operationsQueued: 0 };

    this.lastRun = now();
    const queue = this.readQueue();
    queue.operations = Array.isArray(queue.operations) ? queue.operations : [];
    const operation = queue.operations.find(item => item && item.id === operationId);

    if (!operation) return { ok: false, status: "OPERATION_NOT_FOUND", operationId, operationsQueued: 0 };
    if (!this.isPending(operation)) {
      return { ok: false, status: "OPERATION_NOT_PENDING", operationId, operationStatus: operation.status, operationsQueued: 0 };
    }

    try {
      const task = this.enqueueTask(operation);
      this.markOperation(operation.id, {
        status: "BRIDGED",
        bridgedAt: now(),
        taskQueueStatus: "QUEUED",
        taskId: task.id || null
      });
      this.bridgedCount++;
      this.log(`Target-bridged operation to TaskQueue: ${operation.id}`);
      return {
        ok: true,
        status: "BRIDGE_COMPLETED",
        operationId: operation.id,
        operationsFound: 1,
        operationsQueued: 1,
        taskId: task.id || null,
        taskType: "WORKFORCE_STEP"
      };
    } catch (error) {
      this.markOperation(operation.id, {
        status: "BRIDGE_FAILED",
        bridgeFailedAt: now(),
        taskQueueStatus: "FAILED",
        error: error.message
      });
      this.failedCount++;
      return { ok: false, status: "BRIDGE_FAILED", operationId: operation.id, operationsQueued: 0, error: error.message };
    }
  }

`;
    source = source.slice(0, match.index) + '\n' + method + source.slice(match.index + 1);
  }

  mustContain(source, ['async bridgeOperation(operationId)', 'taskType: "WORKFORCE_STEP"'], 'BRIDGE');
  return { file, backup: writePatched(file, source) };
}

function patchCommandCenter() {
  const file = path.join(ROOT, 'SERVICES', 'digital_coo', 'MilesCommandCenter.js');
  let source = read(file);

  // HTTP 8787 is persistence/acknowledgement only. Execution belongs to the
  // separate Autonomous COO process so synchronous queue work cannot freeze UI.
  source = source.replace(/\nconst BusinessOperationsBridgeService = require\('\.\.\/BusinessOperationsBridgeService'\);/g, '');
  source = source.replace(/\nconst businessBridge = new BusinessOperationsBridgeService\(\{[\s\S]*?\}\);\n/g, '\n');

  if (/host\.enqueueOperation\(operation\)|businessBridge\.bridgeOperation\(operation\.id\)/.test(source)) {
    const start = source.indexOf('  const operation = makeOperation(cleanCommand, plan);');
    const end = source.indexOf('\n  return {\n    ok: true,\n    status: \'COMMAND_ACCEPTED\'', start);
    if (start < 0 || end < 0) throw new Error('COMMAND_HANDLER_TAIL_ANCHOR_NOT_FOUND');
    const replacement = `  const operation = makeOperation(cleanCommand, plan);\n\n  addToQueue(operation);\n\n  const enqueueResult = operation.approvalRequired\n    ? {\n        ok: true,\n        status: 'WAITING_FOR_CEO_APPROVAL',\n        operationId: operation.id\n      }\n    : {\n        ok: true,\n        status: 'QUEUED_FOR_PRODUCTION_BRIDGE',\n        operationId: operation.id,\n        executionOwner: 'AUTONOMOUS_COO'\n      };\n\n  log('INFO', \`Command accepted: \${cleanCommand}\`, {\n    operationId: operation.id,\n    provider: operation.provider,\n    action: operation.action,\n    worker: operation.worker,\n    approvalRequired: operation.approvalRequired,\n    executionOwner: operation.approvalRequired ? 'CEO_APPROVAL' : 'AUTONOMOUS_COO'\n  });\n`;
    source = source.slice(0, start) + replacement + source.slice(end);
  }

  source = source.replace(/\n\s*if\s*\(\s*action === 'approve'[\s\S]*?result\.bridge\s*=\s*await businessBridge\.bridgeOperation\(operationId\);\s*\}/m, '');
  source = source.replace(/\n\s*if\s*\(\s*action === 'approve'[\s\S]*?businessBridge\.bridgeOperation\(operationId\)[\s\S]*?\}\);?\s*\}/m, '');

  if (/require\('\.\.\/BusinessOperationsBridgeService'\)|new BusinessOperationsBridgeService|host\.enqueueOperation\(operation\)|businessBridge\.bridgeOperation/.test(source)) {
    throw new Error('COMMAND_CENTER_EXECUTION_COUPLING_STILL_PRESENT');
  }

  mustContain(source, [
    "status: 'QUEUED_FOR_PRODUCTION_BRIDGE'",
    "executionOwner: 'AUTONOMOUS_COO'",
    "status: 'WAITING_FOR_CEO_APPROVAL'"
  ], 'COMMAND_CENTER');

  return { file, backup: writePatched(file, source) };
}

function patchApiProcessIsolation() {
  const workerFile = path.join(ROOT, 'StartProductionSystem.js');
  let workerSource = read(workerFile);

  // Worker Runtime must never host port 3000. Its synchronous TaskQueue lock
  // path can legitimately wait; sharing the HTTP event loop made the API hang.
  workerSource = workerSource.replace(/\n\s*require\(["']\.\/api\/server["']\);\s*/i, '\n  // MILES API runs in dedicated StartMilesApi.js process.\n');
  if (/require\(["']\.\/api\/server["']\)/i.test(workerSource)) {
    throw new Error('WORKER_RUNTIME_STILL_HOSTS_API');
  }

  const bootstrapFile = path.join(ROOT, 'StartMilesProduction.js');
  let bootstrapSource = read(bootstrapFile);

  if (!bootstrapSource.includes('name: "MILES API"')) {
    const planAnchor = '  return [\n    {\n      name: "Worker Runtime",';
    if (!bootstrapSource.includes(planAnchor)) throw new Error('BOOTSTRAP_WORKER_PLAN_ANCHOR_NOT_FOUND');

    const apiDescriptor = `  return [\n    {\n      name: "MILES API",\n      file: "StartMilesApi.js",\n      phase: 1,\n      readiness: [\n        {\n          type: "tcp",\n          host: "127.0.0.1",\n          port: positiveNumber(env.MILES_API_PORT, 3000)\n        }\n      ]\n    },\n    {\n      name: "Worker Runtime",`;

    bootstrapSource = bootstrapSource.replace(planAnchor, apiDescriptor);
  }

  mustContain(bootstrapSource, [
    'name: "MILES API"',
    'file: "StartMilesApi.js"',
    'port: positiveNumber(env.MILES_API_PORT, 3000)'
  ], 'API_BOOTSTRAP');

  const apiEntry = path.join(ROOT, 'StartMilesApi.js');
  const apiEntrySource = read(apiEntry);
  mustContain(apiEntrySource, ["require('./API/server')"], 'API_ENTRY');

  return {
    workerRuntime: { file: workerFile, backup: writePatched(workerFile, workerSource) },
    bootstrap: { file: bootstrapFile, backup: writePatched(bootstrapFile, bootstrapSource) },
    apiEntry: { file: apiEntry, status: 'VALIDATED' }
  };
}

function validateApproval() {
  const file = path.join(ROOT, 'SERVICES', 'ExecutiveResponseService.js');
  const source = read(file);
  mustContain(source, ['approved: true', 'approver: "CEO"', 'operation.status = "READY"'], 'APPROVAL');
  return { file, status: 'VALIDATED' };
}

function validateTaskQueueLock() {
  const file = path.join(ROOT, 'CORE', 'TaskQueue.js');
  const source = read(file);
  mustContain(source, ['canReclaimLock()', 'isProcessAlive(owner.pid)', 'fs.rmSync(this.lockPath'], 'TASK_QUEUE_LOCK');
  return { file, status: 'VALIDATED' };
}

const results = {
  bridge: patchBridge(),
  commandCenter: patchCommandCenter(),
  apiIsolation: patchApiProcessIsolation(),
  approval: validateApproval(),
  taskQueueLock: validateTaskQueueLock()
};

console.log(JSON.stringify({
  ok: true,
  gate: 'MILES_PRODUCTION_CONVERGENCE_REPAIR',
  version: '1.3-api-and-command-process-isolation',
  results,
  architecture: {
    api3000: 'DEDICATED_START_MILES_API_PROCESS',
    workerRuntime: 'TASK_EXECUTION_ONLY_NO_HTTP',
    commandCenter8787: 'PERSIST_AND_ACK_ONLY',
    execution: 'AUTONOMOUS_COO_PROCESS -> BusinessOperationsBridgeService -> WORKFORCE_STEP',
    approval: 'PERSIST_READY_ONLY -> AUTONOMOUS_COO_PROCESS_RESUMES'
  },
  resolvedKnownDefects: [
    '3000 bound-but-unresponsive Worker Runtime event-loop blocking',
    '8787 legacy WORKER_NOT_FOUND routing',
    '8787 CUSTOM_TASK_NOT_IMPLEMENTED legacy worker path',
    '8787 event-loop blocking on synchronous TaskQueue lock',
    'broad pending-operation replay from command intake',
    'CEO approval loop / wrong approval evidence',
    'duplicate approved operation direct dispatch risk',
    'stale TaskQueue lock recovery validation'
  ],
  nextAction: 'RESTART_AND_RUN_RUNTIME_ACCEPTANCE'
}, null, 2));
