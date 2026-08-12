'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const Bridge = require('../SERVICES/BusinessOperationsBridgeService');
const ExecutiveResponseService = require('../SERVICES/ExecutiveResponseService');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function staticChecks() {
  const commandFile = path.join(ROOT, 'SERVICES', 'digital_coo', 'MilesCommandCenter.js');
  const bridgeFile = path.join(ROOT, 'SERVICES', 'BusinessOperationsBridgeService.js');
  const approvalFile = path.join(ROOT, 'SERVICES', 'ExecutiveResponseService.js');
  const lockFile = path.join(ROOT, 'CORE', 'TaskQueue.js');
  const command = read(commandFile);
  const bridge = read(bridgeFile);
  const approval = read(approvalFile);
  const lock = read(lockFile);

  return {
    commandCenterUsesProductionBridge: command.includes("require('../BusinessOperationsBridgeService')"),
    normalCommandTargeted: command.includes('businessBridge.bridgeOperation(operation.id)'),
    approvedCommandTargeted: command.includes('businessBridge.bridgeOperation(operationId)'),
    legacyHostCommandDispatchRemoved: !command.includes('await host.enqueueOperation(operation)'),
    targetedBridgeMethodPresent: bridge.includes('async bridgeOperation(operationId)'),
    workforceStepPreserved: bridge.includes('type: "WORKFORCE_STEP"'),
    approvalEvidenceNested: approval.includes('approved: true') && approval.includes('approver: "CEO"'),
    approvalReturnsReady: approval.includes('operation.status = "READY"'),
    staleLockRecoveryPresent: lock.includes('canReclaimLock()') && lock.includes('isProcessAlive(owner.pid)')
  };
}

async function isolatedNormalBridge() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-convergence-normal-'));
  const queueFile = path.join(root, 'state', 'business_operations_queue.json');
  const captured = [];
  const fakeTaskQueue = {
    add(type, payload, priority) {
      const task = { id: `TEST-${captured.length + 1}`, type, payload, priority };
      captured.push(task);
      return task;
    }
  };

  writeJson(queueFile, {
    operations: [{
      id: 'OP-NORMAL-1',
      status: 'READY',
      command: 'Check outbound campaign health and report findings.',
      action: 'auditCampaignHealth',
      capability: 'CAMPAIGN_INVENTORY',
      provider: 'Marketing',
      connector: 'Marketing',
      priority: 1
    }]
  });

  const bridge = new Bridge({
    rootDir: root,
    queueFile,
    taskQueue: fakeTaskQueue,
    revenueMissionSource: { readCandidates: () => ({ candidates: [], sourceSummary: [] }) }
  });

  const result = await bridge.bridgeOperation('OP-NORMAL-1');
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  const op = queue.operations.find(item => item.id === 'OP-NORMAL-1');

  return {
    ok: result.ok === true &&
      result.operationsQueued === 1 &&
      captured.length === 1 &&
      captured[0].type === 'WORKFORCE_STEP' &&
      captured[0].payload.sourceOperationId === 'OP-NORMAL-1' &&
      op.status === 'BRIDGED',
    result,
    capturedCount: captured.length,
    taskType: captured[0] && captured[0].type,
    finalOperationStatus: op && op.status
  };
}

async function isolatedApprovalResume() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-convergence-approval-'));
  const queueFile = path.join(root, 'state', 'business_operations_queue.json');
  const taskQueueFile = path.join(root, 'DATA', 'runtime', 'task_queue.json');
  const captured = [];
  const fakeTaskQueue = {
    add(type, payload, priority) {
      const task = { id: `APPROVAL-TEST-${captured.length + 1}`, type, payload, priority };
      captured.push(task);
      return task;
    }
  };

  writeJson(queueFile, {
    operations: [{
      id: 'OP-APPROVAL-1',
      status: 'AWAITING_APPROVAL',
      approvalRequired: true,
      ceoEscalationOnly: true,
      command: 'Protected test operation',
      action: 'CONTROLLED_WRITE',
      capability: 'CONTROLLED_WRITE',
      provider: 'MILES',
      connector: 'MILES',
      priority: 1
    }]
  });
  writeJson(taskQueueFile, []);

  const approvals = new ExecutiveResponseService({
    rootDir: root,
    businessQueueFile: queueFile,
    taskQueueFile
  });
  const approved = await approvals.approveOperation('OP-APPROVAL-1', 'acceptance test');

  const bridge = new Bridge({
    rootDir: root,
    queueFile,
    taskQueue: fakeTaskQueue,
    revenueMissionSource: { readCandidates: () => ({ candidates: [], sourceSummary: [] }) }
  });

  const bridged = await bridge.bridgeOperation('OP-APPROVAL-1');
  const secondAttempt = await bridge.bridgeOperation('OP-APPROVAL-1');
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  const op = queue.operations.find(item => item.id === 'OP-APPROVAL-1');

  return {
    ok: approved.ok === true &&
      approved.operation.approval &&
      approved.operation.approval.approved === true &&
      approved.operation.approval.approver === 'CEO' &&
      bridged.ok === true &&
      captured.length === 1 &&
      secondAttempt.ok === false &&
      secondAttempt.status === 'OPERATION_NOT_PENDING' &&
      op.status === 'BRIDGED',
    approvedStatus: approved.status,
    bridgeStatus: bridged.status,
    duplicateBridgeStatus: secondAttempt.status,
    capturedCount: captured.length,
    finalOperationStatus: op && op.status
  };
}

(async () => {
  const checks = staticChecks();
  const normal = await isolatedNormalBridge();
  const approval = await isolatedApprovalResume();
  const failedStatic = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
  const ok = failedStatic.length === 0 && normal.ok && approval.ok;

  console.log(JSON.stringify({
    ok,
    gate: 'MILES_PRODUCTION_CONVERGENCE_GATE',
    version: '1.0',
    externalWritesPerformed: false,
    staticChecks: checks,
    failedStatic,
    normalCommand: normal,
    approvalResume: approval,
    acceptance: {
      targetedCommandBridge: normal.ok,
      oneTimeApprovalResume: approval.ok,
      noLegacyHostDispatch: checks.legacyHostCommandDispatchRemoved,
      noDuplicateApprovedDispatch: approval.capturedCount === 1,
      staleLockRecoveryCodePresent: checks.staleLockRecoveryPresent
    }
  }, null, 2));

  process.exitCode = ok ? 0 : 1;
})().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    gate: 'MILES_PRODUCTION_CONVERGENCE_GATE',
    error: error.stack || error.message
  }, null, 2));
  process.exitCode = 1;
});
