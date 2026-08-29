'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CanonicalApprovalGovernanceService = require('../SERVICES/digital_coo/CanonicalApprovalGovernanceService');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-approval-governance-'));
const queueFile = path.join(root, 'state', 'business_operations_queue.json');
fs.mkdirSync(path.dirname(queueFile), { recursive: true });

const seed = {
  generatedAt: new Date().toISOString(),
  source: 'MILES_COMMAND_CENTER',
  operations: [
    {
      id: 'pending-1',
      status: 'AWAITING_CEO_APPROVAL',
      provider: 'MILES',
      connector: 'MILES',
      action: 'REPOSITORY_EVIDENCE_REPORT',
      capability: 'REPOSITORY_EVIDENCE_REPORT',
      title: 'Safe read-only approval',
      command: 'Generate a read-only repository evidence report.',
      objective: 'Generate a read-only repository evidence report.',
      approvalRequired: true,
      plan: { action: 'REPOSITORY_EVIDENCE_REPORT', provider: 'MILES', connector: 'MILES' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'done-1',
      status: 'BRIDGED',
      provider: 'MILES',
      action: 'REPOSITORY_EVIDENCE_REPORT'
    }
  ]
};
fs.writeFileSync(queueFile, JSON.stringify(seed, null, 2));

const service = new CanonicalApprovalGovernanceService({ root, queueFile });

assert.strictEqual(service.validateDecision('missing').status, 'NOT_FOUND');
assert.strictEqual(service.validateDecision('done-1').status, 'INVALID_STATUS');
assert.strictEqual(service.validateDecision('pending-1').ok, true);

const normalized = service.normalizeForLegacyApprove('pending-1');
assert.strictEqual(normalized.ok, true);
assert.strictEqual(normalized.changed, true);
assert.strictEqual(service.getOperation('pending-1').operation.status, 'AWAITING_APPROVAL');

const changed = service.requestChanges('pending-1', 'Add explicit source evidence and return for approval.');
assert.strictEqual(changed.ok, true);
assert.strictEqual(changed.status, 'CHANGES_REQUESTED');
assert.strictEqual(changed.originalOperation.status, 'CHANGES_REQUESTED');
assert.strictEqual(changed.revisionOperation.status, 'AWAITING_APPROVAL');
assert.strictEqual(changed.revisionOperation.approvalRequired, true);
assert.strictEqual(changed.revisionOperation.parentOperationId, 'pending-1');
assert.strictEqual(changed.revisionOperation.action, 'REPOSITORY_EVIDENCE_REPORT');
assert.strictEqual(changed.revisionOperation.taskId, null);
assert.strictEqual(service.validateDecision('pending-1').status, 'INVALID_STATUS');
assert.strictEqual(service.validateDecision(changed.revisionOperationId).ok, true);

const noInstructions = service.requestChanges(changed.revisionOperationId, '');
assert.strictEqual(noInstructions.status, 'CHANGE_INSTRUCTIONS_REQUIRED');

fs.rmSync(root, { recursive: true, force: true });
console.log('canonical_approval_governance.test.js: PASS');
