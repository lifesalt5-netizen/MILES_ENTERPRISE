'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const runtimeDir = path.join(ROOT, 'DATA', 'runtime');
const stateDir = path.join(ROOT, 'state');
const taskQueueFile = path.join(runtimeDir, 'task_queue.json');
const workerStatusFile = path.join(runtimeDir, 'worker_runtime_status.json');
const operationsFile = path.join(stateDir, 'business_operations_queue.json');
const approvalStatuses = new Set(['AWAITING_APPROVAL','AWAITING_CEO_APPROVAL','WAITING_FOR_CEO_APPROVAL']);

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { __readError: error.message, __file: file };
  }
}

function normalize(value) { return String(value || '').trim().toUpperCase(); }
function srcOpId(task = {}) {
  const p = task.payload || {};
  return p.sourceOperationId || p.operationId || p.businessOperationId || task.sourceOperationId || null;
}
function taskReason(task = {}) {
  return task.governance?.approval?.reason || task.payload?.governance?.approval?.reason || task.governance?.policy?.reason || task.payload?.governance?.policy?.reason || task.error || null;
}
function policyDecision(task = {}) {
  return task.governance?.policy?.decision || task.payload?.governance?.policy?.decision || null;
}
function approvalRequired(task = {}) {
  const p = task.governance?.policy || task.payload?.governance?.policy || {};
  return p.approvalRequired === true;
}

const tasksRaw = readJson(taskQueueFile, []);
const opsRaw = readJson(operationsFile, { operations: [] });
const worker = readJson(workerStatusFile, null);

if (!Array.isArray(tasksRaw)) {
  console.error(JSON.stringify({ ok:false, error:'task_queue.json is not a readable array', detail:tasksRaw }, null, 2));
  process.exit(2);
}
const operations = Array.isArray(opsRaw?.operations) ? opsRaw.operations : [];
const byOp = new Map(operations.filter(Boolean).map(op => [op.id, op]));
const pending = tasksRaw.filter(task => approvalStatuses.has(normalize(task?.status)));

const rows = pending.map(task => {
  const sourceOperationId = srcOpId(task);
  const op = sourceOperationId ? byOp.get(sourceOperationId) : null;
  const opStatus = normalize(op?.status);
  const runtimePolicyDecision = policyDecision(task);
  const runtimeApprovalRequired = approvalRequired(task);
  const canonicalPending = approvalStatuses.has(opStatus);
  let classification = 'UNCLASSIFIED';
  if (!sourceOperationId) classification = 'ORPHAN_NO_SOURCE_OPERATION';
  else if (!op) classification = 'ORPHAN_MISSING_CANONICAL_OPERATION';
  else if (['COMPLETED','REJECTED','CANCELLED','BLOCKED','FAILED'].includes(opStatus)) classification = 'STALE_RUNTIME_TERMINAL_CANONICAL';
  else if (!canonicalPending && op?.approvalRequired === false) classification = 'RUNTIME_STALE_AFTER_CANONICAL_RECLASSIFICATION';
  else if (canonicalPending) classification = 'CANONICAL_APPROVAL_STILL_PENDING';
  else classification = 'RUNTIME_REQUIRES_REVIEW';

  return {
    taskId: task.id || task.taskId || null,
    taskStatus: task.status || null,
    sourceOperationId,
    canonicalFound: Boolean(op),
    canonicalStatus: op?.status || null,
    canonicalApprovalRequired: op?.approvalRequired ?? null,
    canonicalTitle: op?.title || op?.objective || null,
    runtimeAction: task.action || task.type || task.payload?.action || null,
    runtimeCapability: task.capability || task.payload?.capability || null,
    runtimeProvider: task.provider || task.payload?.provider || null,
    runtimePolicyDecision,
    runtimeApprovalRequired,
    runtimeApprovalReason: taskReason(task),
    createdAt: task.createdAt || task.enqueuedAt || null,
    updatedAt: task.updatedAt || task.lastUpdatedAt || null,
    classification
  };
});

const summary = rows.reduce((acc, row) => {
  acc[row.classification] = (acc[row.classification] || 0) + 1;
  return acc;
}, {});

const result = {
  ok: true,
  service: 'MILES_RUNTIME_APPROVAL_BACKLOG_AUDIT',
  observedAt: new Date().toISOString(),
  readOnly: true,
  filesChanged: 0,
  processesRestarted: 0,
  runtimePendingCount: rows.length,
  workerRuntimeReportedAwaitingApproval: worker?.queue?.awaitingApproval ?? null,
  canonicalPendingCount: operations.filter(op => approvalStatuses.has(normalize(op?.status))).length,
  summary,
  items: rows
};

console.log(JSON.stringify(result, null, 2));
