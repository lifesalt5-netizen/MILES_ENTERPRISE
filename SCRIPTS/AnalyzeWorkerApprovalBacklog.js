'use strict';

const fs = require('fs');
const path = require('path');
const { resolveConnectorAction } = require('../CORE/ExecutionActionContracts');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const TASK_QUEUE_FILE = path.join(ROOT, 'DATA', 'runtime', 'task_queue.json');
const BUSINESS_QUEUE_FILE = path.join(ROOT, 'state', 'business_operations_queue.json');
const PENDING = new Set(['AWAITING_APPROVAL','AWAITING_CEO_APPROVAL']);
const CANONICAL_PENDING = new Set(['AWAITING_APPROVAL','WAITING_FOR_CEO_APPROVAL','AWAITING_CEO_APPROVAL']);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function normalized(value) {
  return String(value || '').trim().toUpperCase();
}

function timestampMs(item) {
  for (const value of [item?.updatedAt, item?.createdAt, item?.startedAt]) {
    const parsed = Date.parse(String(value || ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function ageHours(item, nowMs) {
  const ts = timestampMs(item);
  return ts > 0 ? Math.max(0, (nowMs - ts) / 3600000) : null;
}

function sourceOperationId(task) {
  return task?.payload?.sourceOperationId || task?.sourceOperationId || task?.payload?.id || null;
}

function taskProvider(task) {
  return task?.payload?.connector || task?.payload?.provider || task?.connector || task?.provider || 'MILES';
}

function taskAction(task) {
  return task?.payload?.action || task?.action || task?.type || null;
}

function classify(task, canonicalById, nowMs) {
  const operationId = sourceOperationId(task);
  const operation = operationId ? canonicalById.get(String(operationId)) || null : null;
  const age = ageHours(task, nowMs);
  const provider = taskProvider(task);
  const action = taskAction(task);
  const contract = resolveConnectorAction(provider, action);
  const opStatus = normalized(operation?.status);
  const opDecision = normalized(operation?.approvalDecision);

  if (operation && CANONICAL_PENDING.has(opStatus)) {
    return { classification: 'CURRENT_CANONICAL_CEO_APPROVAL', operation, contract, ageHours: age };
  }

  if (operation && ['APPROVED','REJECTED','CHANGES_REQUESTED','BRIDGED','COMPLETED','EXECUTED','CANCELLED','BRIDGE_FAILED'].includes(opStatus)) {
    return { classification: 'STALE_AFTER_CANONICAL_DECISION', operation, contract, ageHours: age };
  }

  if (operation && ['APPROVED','REJECTED','CHANGES_REQUESTED'].includes(opDecision)) {
    return { classification: 'STALE_AFTER_CANONICAL_DECISION', operation, contract, ageHours: age };
  }

  if (!contract.supported && contract.ephemeralConnectorAvailable) {
    return { classification: 'UNSUPPORTED_LEGACY_ACTION', operation, contract, ageHours: age };
  }

  if (!operationId && age !== null && age >= 24) {
    return { classification: 'ORPHAN_LEGACY_NO_OPERATION_LINK', operation, contract, ageHours: age };
  }

  if (operationId && !operation && age !== null && age >= 24) {
    return { classification: 'ORPHAN_LEGACY_MISSING_CANONICAL_OPERATION', operation, contract, ageHours: age };
  }

  if (age !== null && age >= 168) {
    return { classification: 'AGED_UNRESOLVED_LEGACY_APPROVAL', operation, contract, ageHours: age };
  }

  return { classification: 'UNRESOLVED_REVIEW_REQUIRED', operation, contract, ageHours: age };
}

function increment(map, key) {
  const name = String(key || 'UNKNOWN');
  map[name] = Number(map[name] || 0) + 1;
}

function main() {
  const nowMs = Date.now();
  const tasks = readJson(TASK_QUEUE_FILE, []);
  const businessQueue = readJson(BUSINESS_QUEUE_FILE, { operations: [] });
  const operations = Array.isArray(businessQueue?.operations) ? businessQueue.operations : [];
  const canonicalById = new Map(operations.filter(Boolean).map(item => [String(item.id || ''), item]));
  const awaiting = Array.isArray(tasks) ? tasks.filter(task => PENDING.has(normalized(task?.status))) : [];

  const counts = {};
  const byProvider = {};
  const byAction = {};
  const sampleByClassification = {};
  let oldestHours = null;
  let newestHours = null;

  for (const task of awaiting) {
    const result = classify(task, canonicalById, nowMs);
    increment(counts, result.classification);
    increment(byProvider, taskProvider(task));
    increment(byAction, taskAction(task));
    if (result.ageHours !== null) {
      oldestHours = oldestHours === null ? result.ageHours : Math.max(oldestHours, result.ageHours);
      newestHours = newestHours === null ? result.ageHours : Math.min(newestHours, result.ageHours);
    }
    if (!sampleByClassification[result.classification]) sampleByClassification[result.classification] = [];
    if (sampleByClassification[result.classification].length < 5) {
      sampleByClassification[result.classification].push({
        id: task.id || null,
        status: task.status || null,
        sourceOperationId: sourceOperationId(task),
        provider: taskProvider(task),
        action: taskAction(task),
        ageHours: result.ageHours === null ? null : Number(result.ageHours.toFixed(1)),
        canonicalOperationStatus: result.operation?.status || null,
        approvalDecision: result.operation?.approvalDecision || null,
        actionSupported: result.contract.supported,
        canonicalAction: result.contract.canonicalAction || null
      });
    }
  }

  const genuinelyCurrent = Number(counts.CURRENT_CANONICAL_CEO_APPROVAL || 0);
  const clearlyLegacy = awaiting.length - genuinelyCurrent - Number(counts.UNRESOLVED_REVIEW_REQUIRED || 0);
  const proof = {
    ok: true,
    service: 'MILES_WORKER_APPROVAL_BACKLOG_ANALYSIS',
    observedAt: new Date(nowMs).toISOString(),
    taskQueueFile: TASK_QUEUE_FILE,
    canonicalQueueFile: BUSINESS_QUEUE_FILE,
    totalTaskQueueItems: Array.isArray(tasks) ? tasks.length : 0,
    rawAwaitingApproval: awaiting.length,
    genuinelyCurrentCanonicalApprovals: genuinelyCurrent,
    clearlyLegacyOrStale: clearlyLegacy,
    unresolvedReviewRequired: Number(counts.UNRESOLVED_REVIEW_REQUIRED || 0),
    classifications: counts,
    age: {
      oldestHours: oldestHours === null ? null : Number(oldestHours.toFixed(1)),
      newestHours: newestHours === null ? null : Number(newestHours.toFixed(1))
    },
    byProvider,
    byAction,
    samples: sampleByClassification,
    recommendation: genuinelyCurrent === 0
      ? 'No worker approval record is backed by a current canonical CEO approval. Legacy/stale records can be reconciled without changing the canonical Kevin approval queue.'
      : 'Preserve current canonical approval-linked tasks and reconcile only legacy/stale classifications.',
    safety: {
      readOnly: true,
      taskQueueMutation: false,
      canonicalQueueMutation: false,
      providerMutation: false
    }
  };

  console.log(JSON.stringify(proof, null, 2));
}

if (require.main === module) main();

module.exports = { classify, main };
