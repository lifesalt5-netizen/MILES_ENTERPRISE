'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const commandCenter = path.join(ROOT, 'SERVICES', 'digital_coo', 'MilesCommandCenter.js');
const bridgeService = path.join(ROOT, 'SERVICES', 'BusinessOperationsBridgeService.js');

for (const target of [commandCenter, bridgeService]) {
  if (!fs.existsSync(target)) throw new Error(`TARGET_NOT_FOUND: ${target}`);
}

function patchFile(target, mutator) {
  const original = fs.readFileSync(target, 'utf8');
  const updated = mutator(original);
  if (updated === original) {
    return { target, changed: false, backup: null };
  }
  const backup = `${target}.bak_targeted_bridge_${Date.now()}`;
  fs.copyFileSync(target, backup);
  fs.writeFileSync(target, updated, 'utf8');
  return { target, changed: true, backup };
}

const bridgeResult = patchFile(bridgeService, (input) => {
  let source = input;
  if (source.includes('async bridgeOperation(operationId)')) return source;

  const anchor = `  async runOnce() {\n`;
  if (!source.includes(anchor)) throw new Error('BRIDGE_METHOD_ANCHOR_NOT_FOUND');

  const method = `  async bridgeOperation(operationId) {\n    if (!this.enabled) {\n      return { ok: false, status: \"DISABLED\", operationId };\n    }\n\n    const queue = this.readQueue();\n    queue.operations = Array.isArray(queue.operations) ? queue.operations : [];\n    const operation = queue.operations.find((item) => item && item.id === operationId);\n\n    if (!operation) {\n      return { ok: false, status: \"OPERATION_NOT_FOUND\", operationId };\n    }\n\n    if (!this.isPending(operation)) {\n      return {\n        ok: false,\n        status: \"OPERATION_NOT_READY\",\n        operationId,\n        operationStatus: operation.status || null\n      };\n    }\n\n    try {\n      const task = this.enqueueTask(operation);\n      this.markOperation(operation.id, {\n        status: \"BRIDGED\",\n        bridgedAt: now(),\n        taskQueueStatus: \"QUEUED\",\n        taskId: task.id || null\n      });\n      this.bridgedCount++;\n      this.log(\`Bridged targeted operation to TaskQueue: \${operation.title || operation.command || operation.id}\`);\n      return {\n        ok: true,\n        status: \"BRIDGED\",\n        operationId: operation.id,\n        taskId: task.id || null,\n        taskType: \"WORKFORCE_STEP\"\n      };\n    } catch (error) {\n      this.markOperation(operation.id, {\n        status: \"BRIDGE_FAILED\",\n        bridgeFailedAt: now(),\n        taskQueueStatus: \"FAILED\",\n        error: error.message\n      });\n      this.failedCount++;\n      this.log(\`Targeted bridge failed: \${error.message}\`);\n      return {\n        ok: false,\n        status: \"BRIDGE_FAILED\",\n        operationId: operation.id,\n        error: error.message\n      };\n    }\n  }\n\n`;

  return source.replace(anchor, method + anchor);
});

const commandResult = patchFile(commandCenter, (input) => {
  let source = input;

  const importNeedle = "const DigitalCOOHost = require('./DigitalCOOHost');\n";
  if (!source.includes("require('../BusinessOperationsBridgeService')")) {
    if (!source.includes(importNeedle)) throw new Error('COMMAND_IMPORT_ANCHOR_NOT_FOUND');
    source = source.replace(
      importNeedle,
      importNeedle + "const BusinessOperationsBridgeService = require('../BusinessOperationsBridgeService');\n"
    );
  }

  const hostNeedle = "const host = new DigitalCOOHost({\n  rootDir: ROOT\n});\n";
  if (!source.includes('const businessBridge = new BusinessOperationsBridgeService')) {
    if (!source.includes(hostNeedle)) throw new Error('COMMAND_BRIDGE_ANCHOR_NOT_FOUND');
    source = source.replace(
      hostNeedle,
      hostNeedle + "\nconst businessBridge = new BusinessOperationsBridgeService({\n  rootDir: ROOT,\n  queueFile\n});\n"
    );
  }

  const legacyDispatch = `  let enqueueResult = null;\n\n  if (\n    host &&\n    typeof host.enqueueOperation === 'function'\n  ) {\n    enqueueResult = await host.enqueueOperation(operation);\n  }\n`;

  const priorBridgeDispatch = `  let enqueueResult = null;\n\n  if (operation.approvalRequired) {\n    // Protected work remains visible to the Digital COO Host/CEO approval path.\n    if (host && typeof host.enqueueOperation === 'function') {\n      enqueueResult = await host.enqueueOperation(operation);\n    }\n  } else {\n    // Normal CEO directives use the production Business Operations Bridge.\n    // This converts the accepted operation into a WORKFORCE_STEP and routes it\n    // through the same governed execution path already validated end-to-end.\n    enqueueResult = await businessBridge.runOnce();\n  }\n`;

  const targetedDispatch = `  let enqueueResult = null;\n\n  if (operation.approvalRequired) {\n    // Protected work stays visible to the CEO approval UI. It is bridged only\n    // after ExecutiveResponseService persists governance-valid approval.\n    if (host && typeof host.enqueueOperation === 'function') {\n      enqueueResult = await host.enqueueOperation(operation);\n    }\n  } else {\n    // Normal directives bypass the legacy isolated WorkerDispatcher and bridge\n    // exactly this operation into the canonical WORKFORCE_STEP pipeline.\n    enqueueResult = await businessBridge.bridgeOperation(operation.id);\n  }\n`;

  if (!source.includes('enqueueResult = await businessBridge.bridgeOperation(operation.id);')) {
    if (source.includes(priorBridgeDispatch)) {
      source = source.replace(priorBridgeDispatch, targetedDispatch);
    } else if (source.includes(legacyDispatch)) {
      source = source.replace(legacyDispatch, targetedDispatch);
    } else {
      throw new Error('COMMAND_DISPATCH_ANCHOR_NOT_FOUND');
    }
  }

  const approvalNeedle = `            const result = action === 'approve'\n              ? await executiveResponses.approveOperation(\n                operationId,\n                payload.reason || ''\n              )\n              : await executiveResponses.rejectOperation(\n                operationId,\n                payload.reason || ''\n              );\n\n            res.writeHead(200, {`;

  const approvalReplacement = `            const result = action === 'approve'\n              ? await executiveResponses.approveOperation(\n                operationId,\n                payload.reason || ''\n              )\n              : await executiveResponses.rejectOperation(\n                operationId,\n                payload.reason || ''\n              );\n\n            if (action === 'approve' && result && result.ok) {\n              result.bridge = await businessBridge.bridgeOperation(operationId);\n            }\n\n            res.writeHead(200, {`;

  if (!source.includes("result.bridge = await businessBridge.bridgeOperation(operationId);")) {
    if (!source.includes(approvalNeedle)) throw new Error('COMMAND_APPROVAL_ANCHOR_NOT_FOUND');
    source = source.replace(approvalNeedle, approvalReplacement);
  }

  return source;
});

const commandSource = fs.readFileSync(commandCenter, 'utf8');
const bridgeSource = fs.readFileSync(bridgeService, 'utf8');
const required = [
  [commandSource, "require('../BusinessOperationsBridgeService')"],
  [commandSource, 'const businessBridge = new BusinessOperationsBridgeService'],
  [commandSource, 'businessBridge.bridgeOperation(operation.id)'],
  [commandSource, 'businessBridge.bridgeOperation(operationId)'],
  [bridgeSource, 'async bridgeOperation(operationId)'],
  [bridgeSource, 'taskType: \"WORKFORCE_STEP\"']
];

for (const [source, marker] of required) {
  if (!source.includes(marker)) throw new Error(`PATCH_VALIDATION_FAILED: ${marker}`);
}

console.log(JSON.stringify({
  ok: true,
  gate: 'COMMAND_CENTER_TARGETED_PRODUCTION_BRIDGE_PATCH',
  files: [bridgeResult, commandResult],
  behavior: {
    normalCommand: '8787 -> targeted bridgeOperation -> WORKFORCE_STEP',
    protectedCommand: '8787 -> CEO approval -> targeted bridgeOperation -> WORKFORCE_STEP',
    legacyWorkerDispatcherForBusinessCommands: false,
    sweepsAllPendingOperationsOnCommand: false
  },
  nextAction: 'RUN_NODE_CHECK_AND_TARGETED_BRIDGE_TEST_THEN_RESTART_MILES'
}, null, 2));
