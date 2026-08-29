'use strict';

const fs = require('fs');
const path = require('path');
const taskQueue = require('../CORE/TaskQueue');
const { classify } = require('./AnalyzeWorkerApprovalBacklog');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const BUSINESS_QUEUE_FILE = path.join(ROOT, 'state', 'business_operations_queue.json');
const PENDING = new Set(['AWAITING_APPROVAL','AWAITING_CEO_APPROVAL']);
const PROTECTED = new Set(['CURRENT_CANONICAL_CEO_APPROVAL','UNRESOLVED_REVIEW_REQUIRED']);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}

function normalized(value) {
  return String(value || '').trim().toUpperCase();
}

function sourceOperationId(task) {
  return task?.payload?.sourceOperationId || task?.sourceOperationId || task?.payload?.id || null;
}

function main() {
  const execute = process.argv.includes('--execute');
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const operations = readJson(BUSINESS_QUEUE_FILE, { operations: [] });
  const canonical = Array.isArray(operations?.operations) ? operations.operations : [];
  const canonicalById = new Map(canonical.filter(Boolean).map(item => [String(item.id || ''), item]));
  const tasks = taskQueue._read();

  const candidates = [];
  const protectedTasks = [];
  for (const task of tasks) {
    if (!PENDING.has(normalized(task?.status))) continue;
    const result = classify(task, canonicalById, nowMs);
    const row = {
      id: task.id || null,
      previousStatus: task.status || null,
      sourceOperationId: sourceOperationId(task),
      classification: result.classification,
      ageHours: result.ageHours === null ? null : Number(result.ageHours.toFixed(1))
    };
    if (PROTECTED.has(result.classification)) protectedTasks.push(row);
    else candidates.push(row);
  }

  if (protectedTasks.length) {
    const proof = {
      ok: false,
      status: 'PROTECTED_APPROVALS_PRESENT',
      execute,
      candidates: candidates.length,
      protected: protectedTasks.length,
      protectedTasks: protectedTasks.slice(0, 20),
      safety: { failClosed: true, canonicalApprovalsProtected: true }
    };
    console.log(JSON.stringify(proof, null, 2));
    process.exitCode = 2;
    return;
  }

  if (execute && candidates.length) {
    const candidateById = new Map(candidates.map(item => [String(item.id), item]));
    const updated = tasks.map(task => {
      const row = candidateById.get(String(task?.id || ''));
      if (!row) return task;
      return {
        ...task,
        status: 'CANCELLED',
        updatedAt: nowIso,
        cancelledAt: nowIso,
        cancellationReason: 'LEGACY_APPROVAL_BACKLOG_RECONCILIATION',
        approvalBacklogReconciliation: {
          reconciledAt: nowIso,
          reconciledBy: 'MILES_WORKER_APPROVAL_BACKLOG_RECONCILIATION',
          previousStatus: row.previousStatus,
          classification: row.classification,
          sourceOperationId: row.sourceOperationId,
          preservedForAudit: true
        }
      };
    });
    taskQueue._write(updated);
  }

  const after = taskQueue._read();
  const remainingAwaiting = after.filter(task => PENDING.has(normalized(task?.status)));
  const reconciledIds = new Set(candidates.map(item => String(item.id)));
  const reconciledStillPending = remainingAwaiting.filter(task => reconciledIds.has(String(task?.id || '')));

  const proof = {
    ok: !execute || (reconciledStillPending.length === 0 && remainingAwaiting.length === 0),
    service: 'MILES_WORKER_APPROVAL_BACKLOG_RECONCILIATION',
    mode: execute ? 'EXECUTE' : 'PLAN',
    observedAt: new Date().toISOString(),
    before: {
      totalTasks: tasks.length,
      awaitingApproval: candidates.length + protectedTasks.length,
      candidates: candidates.length,
      protected: protectedTasks.length
    },
    after: {
      totalTasks: after.length,
      awaitingApproval: remainingAwaiting.length,
      reconciledStillPending: reconciledStillPending.length
    },
    classifications: candidates.reduce((acc, row) => {
      acc[row.classification] = Number(acc[row.classification] || 0) + 1;
      return acc;
    }, {}),
    samples: candidates.slice(0, 20),
    safety: {
      historyDeleted: false,
      canonicalQueueMutated: false,
      currentCanonicalApprovalsProtected: true,
      unresolvedApprovalsProtected: true,
      onlyAwaitingApprovalRecordsChanged: true,
      terminalStatusApplied: 'CANCELLED',
      originalStatusPreservedInAuditMetadata: true,
      providerMutation: false
    }
  };

  console.log(JSON.stringify(proof, null, 2));
  process.exitCode = proof.ok ? 0 : 2;
}

if (require.main === module) main();

module.exports = { main };
