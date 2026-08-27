const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ExecutiveResponseService = require('../SERVICES/ExecutiveResponseService');

function createTempRoot() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-exec-response-'));
  fs.mkdirSync(path.join(rootDir, 'state'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'DATA', 'runtime'), { recursive: true });

  const queuePath = path.join(rootDir, 'state', 'business_operations_queue.json');
  fs.writeFileSync(queuePath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    operations: [
      {
        id: 'op_1',
        status: 'AWAITING_APPROVAL',
        command: 'Delete the legacy website backup',
        provider: 'WEBSITE',
        action: 'WEBSITE_DELETE',
        title: 'Delete legacy website backup'
      }
    ]
  }, null, 2));

  fs.writeFileSync(path.join(rootDir, 'DATA', 'runtime', 'task_queue.json'), JSON.stringify([], null, 2));

  return rootDir;
}

function writeJson(rootDir, relativePath, value) {
  const file = path.join(rootDir, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

test('approveOperation updates status, approvals, and persists the operation', async () => {
  const rootDir = createTempRoot();
  const service = new ExecutiveResponseService({ rootDir });

  const result = await service.approveOperation('op_1', 'CEO approved');

  assert.equal(result.ok, true);
  assert.equal(result.operation.status, 'APPROVED');
  assert.equal(result.operation.approvedBy, 'CEO');
  assert.ok(result.operation.approvedAt);
  assert.equal(result.operation.approvalDecision, 'APPROVED');

  const queue = JSON.parse(fs.readFileSync(path.join(rootDir, 'state', 'business_operations_queue.json'), 'utf8'));
  const updated = queue.operations.find((item) => item.id === 'op_1');
  assert.equal(updated.status, 'APPROVED');
  assert.equal(updated.approvedBy, 'CEO');
});

test('rejectOperation updates status, rejection metadata, and persists the operation', async () => {
  const rootDir = createTempRoot();
  const service = new ExecutiveResponseService({ rootDir });

  const result = await service.rejectOperation('op_1', 'CEO rejected');

  assert.equal(result.ok, true);
  assert.equal(result.operation.status, 'REJECTED');
  assert.equal(result.operation.rejectedBy, 'CEO');
  assert.ok(result.operation.rejectedAt);
  assert.equal(result.operation.approvalDecision, 'REJECTED');

  const queue = JSON.parse(fs.readFileSync(path.join(rootDir, 'state', 'business_operations_queue.json'), 'utf8'));
  const updated = queue.operations.find((item) => item.id === 'op_1');
  assert.equal(updated.status, 'REJECTED');
  assert.equal(updated.rejectedBy, 'CEO');
});

test('email/outbound executive questions return evidence-backed meeting analysis', async () => {
  const rootDir = createTempRoot();

  writeJson(rootDir, 'DATA/runtime/revenue/instantly_reconciliation/latest.json', {
    generatedAt: '2026-08-25T23:50:00.000Z',
    inspected: 48,
    nonActionableResolved: 37,
    actionableRemaining: 11,
    buckets: {
      AUTOMATED_NO_ACTION: 12,
      SUPPRESSED_UNSUBSCRIBE: 3,
      OOO_FOLLOWUP: 19,
      MANUAL_REVIEW: 5,
      QUESTION_ACTION_REQUIRED: 4,
      SPAM_NO_ACTION: 1,
      CLOSED_NEGATIVE: 2,
      POSITIVE_ACTION_REQUIRED: 2
    }
  });
  writeJson(rootDir, 'DATA/operational_acceptance/send_window_history/INSTANTLY_SEND_WINDOW_HISTORY_LATEST.json', {
    generatedAt: '2026-08-25T23:55:00.000Z',
    violations: 4
  });
  writeJson(rootDir, 'DATA/operational_acceptance/campaign_schedule_governance/INSTANTLY_CAMPAIGN_SCHEDULE_GOVERNANCE_LATEST.json', {
    generatedAt: '2026-08-25T23:56:00.000Z',
    activeCampaigns: 4,
    compliantActiveCampaigns: 4
  });
  writeJson(rootDir, 'DATA/revenue_pipeline/latest_crm_progression.json', {
    generatedAt: '2026-08-25T23:57:00.000Z',
    crm: { stageCounts: { Engaged: 5, Qualified: 2 } }
  });
  writeJson(rootDir, 'DATA/runtime/revenue/replies/qualified_reply_queue.json', [
    { category: 'INTERESTED', qualifiedPositive: true },
    { category: 'MEETING_INTENT', qualifiedPositive: true }
  ]);

  const service = new ExecutiveResponseService({ rootDir });
  const result = await service.respond({
    command: 'what is working with the emails and not. what can we do to get more meetings set? analyze and come up with the best possible plan for success'
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'EXECUTIVE_RESPONSE');
  assert.equal(result.conversation, true);
  assert.match(result.message, /Email \/ meeting analysis/);
  assert.match(result.message, /inspected 48 received threads/);
  assert.match(result.message, /11 replies still require human\/revenue action/);
  assert.match(result.message, /4 actual send-window violations|4 sends occurred outside/);
  assert.match(result.message, /Canonical CRM stages currently include/);
  assert.match(result.message, /Best plan to get more meetings/);
  assert.doesNotMatch(result.message, /Executive response received/i);
});

require('./meeting_pipeline_calendly_bridge.test.js');
