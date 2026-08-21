'use strict';

process.env.MILES_ROOT = process.cwd();

const assert = require('assert');

const taskQueueStub = {
  update() {},
  list() { return []; },
  claimNextExecutableTask() { return null; }
};
const eventBusStub = {
  publish() { return null; },
  emitEvent() { return null; },
  emit() { return null; }
};

const taskQueuePath = require.resolve('../CORE/TaskQueue');
const eventBusPath = require.resolve('../CORE/EventBus');
require.cache[taskQueuePath] = { id: taskQueuePath, filename: taskQueuePath, loaded: true, exports: taskQueueStub };
require.cache[eventBusPath] = { id: eventBusPath, filename: eventBusPath, loaded: true, exports: eventBusStub };

const connectorManager = require('../CORE/ConnectorManager');
const executionService = require('../SERVICES/ExecutionService');

(async () => {
  const previous = connectorManager.get('INSTANTLY');
  const originalUpdate = taskQueueStub.update;
  const updates = [];
  let executions = 0;

  try {
    if (previous) connectorManager.unregister('INSTANTLY');
    connectorManager.register('INSTANTLY', {
      async healthCheck() { return { ok: true }; },
      async execute(task) {
        executions += 1;
        assert.strictEqual(String(task.action).toUpperCase(), 'REPLYTOEMAIL');
        assert.strictEqual(task.payload.reply_to_uuid, 'email-uuid-1');
        assert.strictEqual(task.payload.eaccount, 'sender@outreach.example');
        return {
          ok: true,
          status: 'REPLY_SENT',
          mutationExecuted: true,
          dryRun: false,
          provider: 'Instantly',
          connector: 'INSTANTLY',
          action: 'replyToEmail'
        };
      }
    });

    taskQueueStub.update = (id, patch) => {
      updates.push({ id, patch });
      return { id, ...patch };
    };

    const governedTask = {
      id: 'TASK-QUALIFIED-REPLY-1',
      type: 'replyToEmail',
      action: 'replyToEmail',
      provider: 'INSTANTLY',
      connector: 'INSTANTLY',
      payload: {
        provider: 'INSTANTLY',
        connector: 'INSTANTLY',
        system: 'INSTANTLY',
        department: 'Revenue Operations',
        action: 'replyToEmail',
        capability: 'INSTANTLY_SEND_REPLY',
        source: 'qualified_replies',
        category: 'MEETING_INTENT',
        confidence: 0.98,
        autonomy: { eligible: true, confidence: 0.98, suppressed: false },
        reply_to_uuid: 'email-uuid-1',
        eaccount: 'sender@outreach.example',
        subject: 'Re: Government contracting',
        body: { text: 'Happy to connect. Choose a time here: https://calendly.com/example' },
        plan: {
          provider: 'INSTANTLY',
          connector: 'INSTANTLY',
          system: 'INSTANTLY',
          department: 'Revenue Operations',
          action: 'replyToEmail',
          capability: 'INSTANTLY_SEND_REPLY'
        }
      }
    };

    const result = await executionService.execute(governedTask);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 'COMPLETED');
    assert.strictEqual(String(result.action).toUpperCase(), 'REPLYTOEMAIL');
    assert.strictEqual(executions, 1);
    assert.ok(updates.some(row => row.patch.status === 'RUNNING'));
    assert.ok(updates.some(row => row.patch.status === 'COMPLETED'));

    const manualTask = {
      id: 'TASK-MANUAL-REPLY-1',
      type: 'replyToEmail',
      action: 'replyToEmail',
      provider: 'INSTANTLY',
      connector: 'INSTANTLY',
      payload: {
        provider: 'INSTANTLY',
        connector: 'INSTANTLY',
        action: 'replyToEmail',
        capability: 'INSTANTLY_SEND_REPLY',
        reply_to_uuid: 'manual-uuid',
        eaccount: 'sender@outreach.example',
        subject: 'Re: manual',
        body: { text: 'Manual reply without qualified evidence.' }
      }
    };
    const manual = await executionService.execute(manualTask);
    assert.strictEqual(manual.ok, false);
    assert.strictEqual(manual.status, 'AWAITING_APPROVAL');
    assert.strictEqual(executions, 1);

    console.log('QUALIFIED_REPLY_WORKER_EXECUTION_TEST=PASS');
  } finally {
    taskQueueStub.update = originalUpdate;
    connectorManager.unregister('INSTANTLY');
    if (previous) connectorManager.register('INSTANTLY', previous);
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
