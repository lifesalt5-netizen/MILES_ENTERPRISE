'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'SERVICES', 'digital_coo', 'MilesCommandCenter.js');
const APPLY = process.argv.includes('--apply');

function fail(message) {
  console.error(`CANONICAL_APPROVAL_REPAIR_RED: ${message}`);
  process.exit(2);
}

if (!fs.existsSync(TARGET)) fail(`Missing target: ${TARGET}`);
let source = fs.readFileSync(TARGET, 'utf8').replace(/^\uFEFF/, '');
let changed = false;

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) fail(`${label}: expected exactly one anchor, found ${count}`);
  source = source.replace(before, after);
  changed = true;
}

replaceOnce(
  "  const approvalRequired = legacyRequiresCEOApproval(command, plan) || policy.approvalRequired === true;\n",
  "  const approvalRequired = policy.evaluated === false\n    ? legacyRequiresCEOApproval(command, plan)\n    : policy.approvalRequired === true;\n",
  'future-command-approval-authority'
);

const helperAnchor = "function reconcileRuntimeApprovals() {\n";
const helperBlock = `function currentPolicyForOperation(operation = {}) {\n  const command = operation.command || operation.objective || operation.title || '';\n  const plan = operation.plan || {\n    provider: operation.provider,\n    connector: operation.connector,\n    action: operation.action || operation.type,\n    capability: operation.capability || operation.action || operation.type,\n    intent: operation.intent,\n    workflow: operation.workflow,\n    objective: operation.objective || command\n  };\n  return governanceForCommand(command, plan);\n}\n\nfunction reclassifyFalseCanonicalApprovals(queue) {\n  let changed = 0;\n  for (const operation of queue.operations || []) {\n    if (!operation) continue;\n    const status = String(operation.status || '').toUpperCase();\n    if (!['AWAITING_APPROVAL', 'WAITING_FOR_CEO_APPROVAL', 'AWAITING_CEO_APPROVAL'].includes(status)) continue;\n\n    const policy = currentPolicyForOperation(operation);\n    if (policy?.evaluated === false) continue;\n    if (policy?.decision !== 'ALLOW' || policy?.approvalRequired === true) continue;\n\n    const hasTask = Boolean(operation.runtimeTaskId || operation.taskId);\n    Object.assign(operation, {\n      status: hasTask ? 'BRIDGED' : 'READY',\n      approvalRequired: false,\n      ceoEscalationOnly: false,\n      approvalReason: null,\n      approvalSource: null,\n      approvalReclassifiedAt: now(),\n      approvalReclassificationReason: 'Current canonical governance policy does not require CEO approval.',\n      risk: policy.risk || operation.risk || 'UNKNOWN',\n      governance: {\n        ...(operation.governance || {}),\n        policy,\n        approval: { approved: false, approver: null, approvedAt: null, required: false }\n      },\n      updatedAt: now()\n    });\n    changed += 1;\n  }\n  return changed;\n}\n\n`;

if (!source.includes('function reclassifyFalseCanonicalApprovals(queue)')) {
  const count = source.split(helperAnchor).length - 1;
  if (count !== 1) fail(`canonical-reclassification-helper: expected exactly one anchor, found ${count}`);
  source = source.replace(helperAnchor, helperBlock + helperAnchor);
  changed = true;
}

replaceOnce(
  "function reconcileRuntimeApprovals() {\n  const runtimeTasks = runtimeApprovalTasks();\n  if (!runtimeTasks.length) return { changed: 0, runtimePending: 0 };\n  const queue = queueState();\n",
  "function reconcileRuntimeApprovals() {\n  const runtimeTasks = runtimeApprovalTasks();\n  const queue = queueState();\n  let changed = reclassifyFalseCanonicalApprovals(queue);\n  if (!runtimeTasks.length) {\n    if (changed) {\n      queue.generatedAt = now();\n      queue.source = 'MILES_COMMAND_CENTER';\n      writeJson(QUEUE_FILE, queue);\n    }\n    return { changed, runtimePending: 0 };\n  }\n",
  'reconcile-canonical-first'
);

replaceOnce(
  "  const byId = new Map(queue.operations.filter(Boolean).map(operation => [operation.id, operation]));\n  let changed = 0;\n\n  for (const task of runtimeTasks) {\n",
  "  const byId = new Map(queue.operations.filter(Boolean).map(operation => [operation.id, operation]));\n\n  for (const task of runtimeTasks) {\n",
  'preserve-reclassification-count'
);

replaceOnce(
  "    const operationStatus = String(operation.status || '').toUpperCase();\n    if (['COMPLETED', 'REJECTED', 'CANCELLED', 'BLOCKED'].includes(operationStatus)) continue;\n\n    const policy = task.governance?.policy || task.payload?.governance?.policy || null;\n",
  "    const operationStatus = String(operation.status || '').toUpperCase();\n    if (['COMPLETED', 'REJECTED', 'CANCELLED', 'BLOCKED'].includes(operationStatus)) continue;\n\n    const currentPolicy = currentPolicyForOperation(operation);\n    if (\n      currentPolicy?.evaluated !== false &&\n      currentPolicy?.decision === 'ALLOW' &&\n      currentPolicy?.approvalRequired !== true\n    ) {\n      if (\n        operation.approvalRequired !== false ||\n        ['AWAITING_APPROVAL', 'WAITING_FOR_CEO_APPROVAL', 'AWAITING_CEO_APPROVAL'].includes(operationStatus)\n      ) {\n        Object.assign(operation, {\n          status: 'BRIDGED',\n          approvalRequired: false,\n          ceoEscalationOnly: false,\n          approvalReason: null,\n          approvalSource: null,\n          approvalReclassifiedAt: operation.approvalReclassifiedAt || now(),\n          approvalReclassificationReason: 'Worker-runtime approval was re-evaluated under current canonical governance and is not a CEO approval.',\n          risk: currentPolicy.risk || operation.risk || 'UNKNOWN',\n          governance: {\n            ...(operation.governance || {}),\n            policy: currentPolicy,\n            approval: { approved: false, approver: null, approvedAt: null, required: false }\n          },\n          updatedAt: now()\n        });\n        changed += 1;\n      }\n      continue;\n    }\n\n    const policy = task.governance?.policy || task.payload?.governance?.policy || currentPolicy || null;\n",
  'runtime-do-not-reinflate-false-approval'
);

if (!changed) {
  console.log('CANONICAL_APPROVAL_REPAIR_NO_CHANGES');
  process.exit(0);
}

if (!APPLY) {
  console.log('CANONICAL_APPROVAL_REPAIR_DRY_RUN_OK');
  console.log('Would patch future approval authority and historical canonical reclassification safeguards.');
  process.exit(0);
}

const backupDir = path.join(ROOT, 'BACKUPS', `canonical-approval-reclassification-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(TARGET, path.join(backupDir, 'MilesCommandCenter.js'));
fs.writeFileSync(TARGET, source, 'utf8');
console.log('CANONICAL_APPROVAL_REPAIR_APPLIED');
console.log(`BACKUP=${backupDir}`);
