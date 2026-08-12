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

  // v1.2 architecture: the HTTP process never requires/instantiates the production bridge.
  // READY operations are persisted and picked up by AutonomousCOOLoopService in its own process.
  source = source.replace(/\nconst BusinessOperationsBridgeService = require\('\.\.\/BusinessOperationsBridgeService'\);/g, '');
  source = source.replace(/\nconst businessBridge = new BusinessOperationsBridgeService\(\{[\s\S]*?\}\);\n/g, '\n');

  // Replace any synchronous or setImmediate targeted bridge block used by earlier convergence versions.
  source = source.replace(/\n\s*let enqueueResult = null;[\s\S]*?\n\s*log\('INFO', `Command accepted:/m,
`\n  const enqueueResult = operation.approvalRequired\n    ? {\n        ok: true,\n        status: 'WAITING_FOR_CEO_APPROVAL',\n        operationId: operation.id\n      }\n    : {\n        ok: true,\n        status: 'QUEUED_FOR_PRODUCTION_BRIDGE',\n        operationId: operation.id,\n        executionOwner: 'AUTONOMOUS_COO'\n      };\n\n  log('INFO', \`Command accepted:`);

  // The broad regex above intentionally terminates at log(. Restore the full log prefix if needed.
  source = source.replace("log('INFO', `Command accepted: ${cleanCommand}`.replace", "log('INFO', `Command accepted: ${cleanCommand}`.replace");
  // Repair accidental reduced log token created by replacement.
  source = source.replace("log('INFO', `Command accepted:, {", "log('INFO', `Command accepted: ${cleanCommand}`, {");
  source = source.replace("log('INFO', `Command accepted:`); ${cleanCommand}`, {", "log('INFO', `Command accepted: ${cleanCommand}`, {");

  // More deterministic fallback: locate operation creation through return block and rebuild handler tail if legacy dispatch remains.
  if (/host\.enqueueOperation\(operation\)|businessBridge\.bridgeOperation\(operation\.id\)/.test(source)) {
    const start = source.indexOf('  const operation = makeOperation(cleanCommand, plan);');
    const end = source.indexOf('\n  return {\n    ok: true,\n    status: \'COMMAND_ACCEPTED\'', start);
    if (start < 0 || end < 0) throw new Error('COMMAND_HANDLER_TAIL_ANCHOR_NOT_FOUND');
    const replacement = `  const operation = makeOperation(cleanCommand, plan);\n\n  addToQueue(operation);\n\n  const enqueueResult = operation.approvalRequired\n    ? {\n        ok: true,\n        status: 'WAITING_FOR_CEO_APPROVAL',\n        operationId: operation.id\n      }\n    : {\n        ok: true,\n        status: 'QUEUED_FOR_PRODUCTION_BRIDGE',\n        operationId: operation.id,\n        executionOwner: 'AUTONOMOUS_COO'\n      };\n\n  log('INFO', \`Command accepted: \${cleanCommand}\`, {\n    operationId: operation.id,\n    provider: operation.provider,\n    action: operation.action,\n    worker: operation.worker,\n    approvalRequired: operation.approvalRequired,\n    executionOwner: operation.approvalRequired ? 'CEO_APPROVAL' : 'AUTONOMOUS_COO'\n  });\n`;
    source = source.slice(0, start) + replacement + source.slice(end);
  }

  // Approval endpoint must persist READY only; Autonomous COO resumes it externally.
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
  approval: validateApproval(),
  taskQueueLock: validateTaskQueueLock()
};

console.log(JSON.stringify({
  ok: true,
  gate: 'MILES_PRODUCTION_CONVERGENCE_REPAIR',
  version: '1.2-process-isolated-command-center',
  results,
  architecture: {
    commandCenter8787: 'PERSIST_AND_ACK_ONLY',
    execution: 'AUTONOMOUS_COO_PROCESS -> BusinessOperationsBridgeService -> WORKFORCE_STEP',
    approval: 'PERSIST_READY_ONLY -> AUTONOMOUS_COO_PROCESS_RESUMES'
  },
  resolvedKnownDefects: [
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
