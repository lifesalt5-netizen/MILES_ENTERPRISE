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
    if (!source.includes(marker)) {
      throw new Error(`${label}_VALIDATION_FAILED: ${marker}`);
    }
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
    if (!this.enabled) {
      return { ok: true, status: "DISABLED", operationId, operationsQueued: 0 };
    }

    this.lastRun = now();
    const queue = this.readQueue();
    queue.operations = Array.isArray(queue.operations) ? queue.operations : [];
    const operation = queue.operations.find(item => item && item.id === operationId);

    if (!operation) {
      return { ok: false, status: "OPERATION_NOT_FOUND", operationId, operationsQueued: 0 };
    }

    if (!this.isPending(operation)) {
      return {
        ok: false,
        status: "OPERATION_NOT_PENDING",
        operationId,
        operationStatus: operation.status,
        operationsQueued: 0
      };
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
      this.log(\`Target-bridged operation to TaskQueue: \${operation.id}\`);
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
      return {
        ok: false,
        status: "BRIDGE_FAILED",
        operationId: operation.id,
        operationsQueued: 0,
        error: error.message
      };
    }
  }

`;

    source = source.slice(0, match.index) + '\n' + method + source.slice(match.index + 1);
  }

  mustContain(source, [
    'async bridgeOperation(operationId)',
    'taskType: "WORKFORCE_STEP"',
    'Target-bridged operation to TaskQueue'
  ], 'BRIDGE');

  return { file, backup: writePatched(file, source) };
}

function patchCommandCenter() {
  const file = path.join(ROOT, 'SERVICES', 'digital_coo', 'MilesCommandCenter.js');
  let source = read(file);

  if (!source.includes("require('../BusinessOperationsBridgeService')")) {
    const anchor = "const DigitalCOOHost = require('./DigitalCOOHost');";
    if (!source.includes(anchor)) throw new Error('COMMAND_IMPORT_ANCHOR_NOT_FOUND');
    source = source.replace(anchor, `${anchor}\nconst BusinessOperationsBridgeService = require('../BusinessOperationsBridgeService');`);
  }

  if (!source.includes('const businessBridge = new BusinessOperationsBridgeService')) {
    const hostRegex = /const host = new DigitalCOOHost\(\{[\s\S]*?rootDir:\s*ROOT[\s\S]*?\}\);/;
    const match = source.match(hostRegex);
    if (!match) throw new Error('COMMAND_HOST_ANCHOR_NOT_FOUND');
    source = source.replace(match[0], `${match[0]}\n\nconst businessBridge = new BusinessOperationsBridgeService({\n  rootDir: ROOT,\n  queueFile\n});`);
  }

  // Remove legacy command dispatch into DigitalCOOHost/WorkerDispatcher.
  const legacyDispatch = /\n\s*let enqueueResult = null;\s*\n\s*if\s*\(\s*host\s*&&\s*typeof host\.enqueueOperation === 'function'\s*\)\s*\{\s*enqueueResult = await host\.enqueueOperation\(operation\);\s*\}/m;
  if (legacyDispatch.test(source)) {
    source = source.replace(legacyDispatch, `
  let enqueueResult = null;

  if (operation.approvalRequired) {
    enqueueResult = {
      ok: true,
      status: 'WAITING_FOR_CEO_APPROVAL',
      operationId: operation.id
    };
  } else {
    enqueueResult = await businessBridge.bridgeOperation(operation.id);
  }`);
  }

  if (!source.includes('enqueueResult = await businessBridge.bridgeOperation(operation.id);')) {
    throw new Error('COMMAND_NORMAL_TARGET_BRIDGE_NOT_INSTALLED');
  }

  // After a CEO approval becomes READY, bridge that exact operation once.
  if (!source.includes('result.bridge = await businessBridge.bridgeOperation(operationId);')) {
    const approvalRegex = /const result = action === 'approve'\s*\? await executiveResponses\.approveOperation\(\s*operationId,\s*payload\.reason \|\| ''\s*\)\s*:\s*await executiveResponses\.rejectOperation\(\s*operationId,\s*payload\.reason \|\| ''\s*\);/m;
    const match = source.match(approvalRegex);
    if (!match) throw new Error('COMMAND_APPROVAL_ANCHOR_NOT_FOUND');
    source = source.replace(match[0], `let result = action === 'approve'
              ? await executiveResponses.approveOperation(
                operationId,
                payload.reason || ''
              )
              : await executiveResponses.rejectOperation(
                operationId,
                payload.reason || ''
              );

            if (
              action === 'approve' &&
              result &&
              result.ok &&
              result.operation &&
              String(result.operation.status || '').toUpperCase() === 'READY'
            ) {
              result.bridge = await businessBridge.bridgeOperation(operationId);
            }`);
  }

  mustContain(source, [
    "require('../BusinessOperationsBridgeService')",
    'const businessBridge = new BusinessOperationsBridgeService',
    'enqueueResult = await businessBridge.bridgeOperation(operation.id);',
    'result.bridge = await businessBridge.bridgeOperation(operationId);'
  ], 'COMMAND_CENTER');

  if (/await host\.enqueueOperation\(operation\)/.test(source)) {
    throw new Error('LEGACY_HOST_COMMAND_DISPATCH_STILL_PRESENT');
  }

  return { file, backup: writePatched(file, source) };
}

function validateApproval() {
  const file = path.join(ROOT, 'SERVICES', 'ExecutiveResponseService.js');
  const source = read(file);
  mustContain(source, [
    'approved: true',
    'approver: "CEO"',
    'operation.status = "READY"'
  ], 'APPROVAL');
  return { file, status: 'VALIDATED' };
}

function validateTaskQueueLock() {
  const file = path.join(ROOT, 'CORE', 'TaskQueue.js');
  const source = read(file);
  mustContain(source, [
    'canReclaimLock()',
    'isProcessAlive(owner.pid)',
    'fs.rmSync(this.lockPath'
  ], 'TASK_QUEUE_LOCK');
  return { file, status: 'VALIDATED' };
}

const results = {
  bridge: patchBridge(),
  commandCenter: patchCommandCenter(),
  approval: validateApproval(),
  taskQueueLock: validateTaskQueueLock()
};

console.log(JSON.stringify({
  ok: true,
  gate: 'MILES_PRODUCTION_CONVERGENCE_REPAIR',
  version: '1.0',
  results,
  resolvedKnownDefects: [
    '8787 legacy WORKER_NOT_FOUND routing',
    '8787 CUSTOM_TASK_NOT_IMPLEMENTED legacy worker path',
    'broad pending-operation replay from command intake',
    'CEO approval resume not entering canonical WORKFORCE_STEP path',
    'duplicate approved operation dispatch risk',
    'stale TaskQueue lock recovery validation'
  ],
  nextAction: 'RUN_CONVERGENCE_GATE'
}, null, 2));
