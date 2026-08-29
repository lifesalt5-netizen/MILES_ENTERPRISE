'use strict';

const fs = require('fs');
const path = require('path');

const PENDING_STATUSES = new Set([
  'AWAITING_APPROVAL',
  'WAITING_FOR_CEO_APPROVAL',
  'AWAITING_CEO_APPROVAL'
]);

function now() {
  return new Date().toISOString();
}

class CanonicalApprovalGovernanceService {
  constructor(options = {}) {
    this.root = options.root || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..');
    this.queueFile = options.queueFile || path.join(this.root, 'state', 'business_operations_queue.json');
  }

  readQueue() {
    try {
      const raw = fs.readFileSync(this.queueFile, 'utf8').replace(/^\uFEFF/, '');
      const queue = JSON.parse(raw || '{}');
      queue.operations = Array.isArray(queue.operations) ? queue.operations : [];
      return queue;
    } catch {
      return { generatedAt: null, source: 'MILES_COMMAND_CENTER', operations: [] };
    }
  }

  writeQueue(queue) {
    fs.mkdirSync(path.dirname(this.queueFile), { recursive: true });
    const temporary = `${this.queueFile}.${process.pid}.${Date.now()}.tmp`;
    queue.generatedAt = now();
    queue.source = queue.source || 'MILES_COMMAND_CENTER';
    fs.writeFileSync(temporary, JSON.stringify(queue, null, 2), 'utf8');
    try {
      fs.renameSync(temporary, this.queueFile);
    } catch {
      fs.copyFileSync(temporary, this.queueFile);
      try { fs.unlinkSync(temporary); } catch {}
    }
  }

  normalizeStatus(value) {
    return String(value || '').trim().toUpperCase();
  }

  isPending(operation) {
    return Boolean(operation && PENDING_STATUSES.has(this.normalizeStatus(operation.status)));
  }

  getOperation(operationId) {
    const queue = this.readQueue();
    const operation = queue.operations.find(item => item && item.id === operationId) || null;
    return { queue, operation };
  }

  validateDecision(operationId) {
    const { operation } = this.getOperation(operationId);
    if (!operation) return { ok: false, status: 'NOT_FOUND', operationId };
    if (!this.isPending(operation)) {
      return {
        ok: false,
        status: 'INVALID_STATUS',
        operationId,
        currentStatus: operation.status
      };
    }
    return { ok: true, status: 'DECISION_ALLOWED', operationId, operation };
  }

  normalizeForLegacyApprove(operationId) {
    const { queue, operation } = this.getOperation(operationId);
    if (!operation) return { ok: false, status: 'NOT_FOUND', operationId };
    if (!this.isPending(operation)) {
      return { ok: false, status: 'INVALID_STATUS', operationId, currentStatus: operation.status };
    }
    if (this.normalizeStatus(operation.status) !== 'AWAITING_CEO_APPROVAL') {
      return { ok: true, changed: false, operation };
    }
    const index = queue.operations.findIndex(item => item && item.id === operationId);
    queue.operations[index] = { ...operation, status: 'AWAITING_APPROVAL', updatedAt: now() };
    this.writeQueue(queue);
    return { ok: true, changed: true, operation: queue.operations[index] };
  }

  requestChanges(operationId, instructions) {
    const clean = String(instructions || '').trim();
    if (!clean) return { ok: false, status: 'CHANGE_INSTRUCTIONS_REQUIRED', operationId };

    const { queue, operation } = this.getOperation(operationId);
    if (!operation) return { ok: false, status: 'NOT_FOUND', operationId };
    if (!this.isPending(operation)) {
      return { ok: false, status: 'INVALID_STATUS', operationId, currentStatus: operation.status };
    }

    const timestamp = now();
    const index = queue.operations.findIndex(item => item && item.id === operationId);
    const original = {
      ...operation,
      status: 'CHANGES_REQUESTED',
      approvalDecision: 'CHANGES_REQUESTED',
      changesRequestedBy: 'CEO',
      changesRequestedAt: timestamp,
      changeInstructions: clean,
      updatedAt: timestamp
    };
    queue.operations[index] = original;

    const revisionId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const revisionNumber = Number(operation.revisionNumber || 0) + 1;
    const revisedObjective = `${operation.objective || operation.command || operation.title || operation.id}\n\nCEO requested changes: ${clean}`;
    const revision = {
      ...operation,
      id: revisionId,
      source: 'MILES_COMMAND_CENTER',
      status: 'AWAITING_APPROVAL',
      approvalRequired: true,
      ceoEscalationOnly: true,
      approvalDecision: null,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      approvalReason: null,
      taskId: null,
      taskQueueStatus: null,
      bridgedAt: null,
      bridgeFailedAt: null,
      error: null,
      result: null,
      parentOperationId: operationId,
      revisionOf: operationId,
      revisionNumber,
      changeInstructions: clean,
      title: `Revision ${revisionNumber}: ${operation.title || operation.objective || operationId}`.slice(0, 200),
      objective: revisedObjective,
      plan: {
        ...(operation.plan || {}),
        objective: revisedObjective,
        revision: {
          parentOperationId: operationId,
          revisionNumber,
          requestedBy: 'CEO',
          instructions: clean,
          requestedAt: timestamp
        }
      },
      createdAt: timestamp,
      updatedAt: timestamp
    };

    queue.operations.unshift(revision);
    this.writeQueue(queue);

    return {
      ok: true,
      status: 'CHANGES_REQUESTED',
      operationId,
      originalStopped: true,
      originalOperation: original,
      revisionOperationId: revisionId,
      revisionOperation: revision,
      message: 'The original governed operation was stopped and a linked revision was returned to the canonical CEO approval queue.'
    };
  }
}

module.exports = CanonicalApprovalGovernanceService;
module.exports.PENDING_STATUSES = PENDING_STATUSES;
