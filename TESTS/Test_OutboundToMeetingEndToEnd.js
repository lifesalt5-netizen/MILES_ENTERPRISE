'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-outbound-meeting-e2e-'));
fs.mkdirSync(path.join(root, 'CONFIG'), { recursive: true });
fs.copyFileSync(
  path.join(repoRoot, 'CONFIG', 'canonical_crm_rules.json'),
  path.join(root, 'CONFIG', 'canonical_crm_rules.json')
);
fs.mkdirSync(path.join(root, 'GOVERNANCE'), { recursive: true });
for (const name of [
  'constitution.json',
  'approval_matrix.json',
  'data_access_policy.json',
  'demo_access_policy.json'
]) {
  fs.copyFileSync(path.join(repoRoot, 'GOVERNANCE', name), path.join(root, 'GOVERNANCE', name));
}
process.env.MILES_ROOT = root;

const queueUpdates = [];
const taskQueueStub = {
  update(id, patch) { queueUpdates.push({ id, patch }); return { id, ...patch }; },
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

const ReplyIntelligenceProductionLoopService = require('../SERVICES/revenue/ReplyIntelligenceProductionLoopService');
const RevenueMissionSourceService = require('../SERVICES/RevenueMissionSourceService');
const BusinessOperationsBridgeService = require('../SERVICES/BusinessOperationsBridgeService');
const RevenueCrmProgressionService = require('../SERVICES/revenue/RevenueCrmProgressionService');
const crm = require('../SERVICES/CanonicalCrmService');
const connectorManager = require('../CORE/ConnectorManager');
const executionService = require('../SERVICES/ExecutionService');

(async () => {
  const prospectEmail = 'prospect@example.com';
  const rawEmail = {
    id: 'email-uuid-e2e-1',
    eaccount: 'sender@outreach.example',
    from_address_email: prospectEmail,
    campaign_id: 'campaign-e2e-1',
    lead_id: 'lead-e2e-1',
    subject: 'Re: Government contracting growth',
    body: { text: "Yes, I'm interested. Let's schedule a call." },
    timestamp_created: new Date().toISOString()
  };

  const emailSource = {
    async listEmails() { return { items: [rawEmail], next_starting_after: null }; }
  };
  const suppression = {
    get() { return null; },
    upsert() {},
    filePath: path.join(root, 'suppression.json')
  };
  const surfacePolicy = {
    queuePath: path.join(root, 'executive.json'),
    apply(row) { return { ...row, surfaceToExecutiveInbox: Boolean(row.qualifiedPositive) }; }
  };
  const replacementRecovery = { detect() { return null; } };

  const replyLoop = new ReplyIntelligenceProductionLoopService({
    rootDir: root,
    emailSource,
    suppression,
    surfacePolicy,
    replacementRecovery
  });
  const replyReport = await replyLoop.runOnce();
  assert.strictEqual(replyReport.ok, true);
  assert.strictEqual(replyReport.governedRepliesReady, 1);

  const qualifiedPath = path.join(root, 'DATA', 'runtime', 'revenue', 'replies', 'qualified_reply_queue.json');
  const qualified = JSON.parse(fs.readFileSync(qualifiedPath, 'utf8'));
  assert.strictEqual(qualified.length, 1);
  assert.strictEqual(qualified[0].status, 'READY');
  assert.strictEqual(qualified[0].provider, 'INSTANTLY');
  assert.strictEqual(qualified[0].action, 'replyToEmail');
  assert.strictEqual(qualified[0].autonomy.eligible, true);
  assert.ok(qualified[0].body.text.includes('calendly.com/kevin-pathways2gc/30min'));

  const source = new RevenueMissionSourceService({ rootDir: root });
  const queued = [];
  const bridgeQueue = {
    add(type, payload, priority) {
      const task = { id: 'TASK-E2E-REPLY-1', type, payload, priority };
      queued.push(task);
      return task;
    }
  };
  const commandPreflight = {
    evaluate() { return { ok: true, allowedToQueue: true, status: 'READY', blockers: [] }; }
  };
  const bridge = new BusinessOperationsBridgeService({
    rootDir: root,
    taskQueue: bridgeQueue,
    commandPreflight,
    revenueMissionSource: source
  });
  const bridgeResult = await bridge.runOnce();
  assert.strictEqual(bridgeResult.operationsQueued, 1);
  assert.strictEqual(queued.length, 1);
  assert.strictEqual(queued[0].payload.source, 'qualified_replies');
  assert.strictEqual(queued[0].payload.reply_to_uuid, 'email-uuid-e2e-1');

  const previousInstantly = connectorManager.get('INSTANTLY');
  if (previousInstantly) connectorManager.unregister('INSTANTLY');
  let externalMutations = 0;
  connectorManager.register('INSTANTLY', {
    async healthCheck() { return { ok: true }; },
    async execute(task) {
      externalMutations += 1;
      assert.strictEqual(task.payload.reply_to_uuid, 'email-uuid-e2e-1');
      assert.strictEqual(task.payload.eaccount, 'sender@outreach.example');
      return {
        ok: true,
        status: 'REPLY_SENT',
        mutationExecuted: true,
        dryRun: false,
        executionTruth: 'EXTERNAL_MUTATION_CONFIRMED',
        provider: 'Instantly',
        connector: 'INSTANTLY',
        action: 'replyToEmail'
      };
    }
  });

  const execution = await executionService.execute(queued[0]);
  assert.strictEqual(execution.ok, true);
  assert.strictEqual(execution.status, 'COMPLETED');
  assert.strictEqual(externalMutations, 1);
  assert.strictEqual(execution.result.mutationExecuted, true);
  assert.strictEqual(execution.result.executionTruth, 'EXTERNAL_MUTATION_CONFIRMED');
  assert.ok(queueUpdates.some(row => row.patch.status === 'RUNNING'));
  assert.ok(queueUpdates.some(row => row.patch.status === 'COMPLETED'));

  const progression = new RevenueCrmProgressionService({ rootDir: root, crm });
  const qualifiedProgression = progression.runOnce({ calendlyPipeline: {} });
  assert.strictEqual(qualifiedProgression.qualifiedReplyProgression.progressed, 1);
  assert.strictEqual(crm.getByIdentity({ email: prospectEmail }).stage, 'Qualified');

  const startTime = new Date(Date.now() + 86400000).toISOString();
  const calendlyPipeline = {
    upcomingMeetings: [{
      eventUri: 'https://api.calendly.com/scheduled_events/e2e-1',
      eventName: 'Federal Strategy Call',
      startTime,
      endTime: new Date(Date.now() + 88200000).toISOString(),
      eventStatus: 'active',
      inviteeUri: 'https://api.calendly.com/scheduled_events/e2e-1/invitees/i1',
      inviteeName: 'Prospect Example',
      inviteeEmail: prospectEmail,
      canceled: false
    }],
    recentMeetings: []
  };
  const meetingProgression = progression.runOnce({ calendlyPipeline });
  assert.strictEqual(meetingProgression.calendlyProgression.meetingSetProgressed, 1);
  assert.strictEqual(crm.getByIdentity({ email: prospectEmail }).stage, 'Meeting Set');

  const pastOnly = {
    upcomingMeetings: [],
    recentMeetings: [{
      eventUri: 'https://api.calendly.com/scheduled_events/e2e-past',
      eventName: 'Federal Strategy Call',
      startTime: new Date(Date.now() - 86400000).toISOString(),
      eventStatus: 'active',
      inviteeEmail: prospectEmail,
      canceled: false
    }]
  };
  const pastResult = progression.runOnce({ calendlyPipeline: pastOnly });
  assert.strictEqual(pastResult.calendlyProgression.meetingHeldAutoProgressed, 0);
  assert.strictEqual(crm.getByIdentity({ email: prospectEmail }).stage, 'Meeting Set');

  connectorManager.unregister('INSTANTLY');
  if (previousInstantly) connectorManager.register('INSTANTLY', previousInstantly);
  fs.rmSync(root, { recursive: true, force: true });

  console.log('OUTBOUND_TO_MEETING_END_TO_END_TEST=PASS');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  process.exitCode = 1;
});
