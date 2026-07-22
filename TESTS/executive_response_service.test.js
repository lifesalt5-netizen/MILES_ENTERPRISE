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
