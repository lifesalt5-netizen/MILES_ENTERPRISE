'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ReplyIntelligenceProductionLoopService = require('../SERVICES/revenue/ReplyIntelligenceProductionLoopService');
const RevenueMissionSourceService = require('../SERVICES/RevenueMissionSourceService');
const BusinessOperationsBridgeService = require('../SERVICES/BusinessOperationsBridgeService');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-qualified-reply-'));
  const rawEmail = {
    id: 'email-uuid-1',
    eaccount: 'sender@outreach.example',
    from_address_email: 'prospect@example.com',
    campaign_id: 'campaign-1',
    lead_id: 'lead-1',
    subject: 'Re: Government contracting growth',
    body: { text: "Yes, let's schedule a call." },
    timestamp_created: new Date().toISOString()
  };

  const emailSource = {
    async listEmails() { return { items: [rawEmail], next_starting_after: null }; }
  };
  const suppression = { get() { return null; }, upsert() {}, filePath: path.join(root, 'suppression.json') };
  const surfacePolicy = {
    queuePath: path.join(root, 'executive.json'),
    apply(row) { return { ...row, surfaceToExecutiveInbox: Boolean(row.qualifiedPositive) }; }
  };
  const replacementRecovery = { detect() { return null; } };

  const loop = new ReplyIntelligenceProductionLoopService({ rootDir: root, emailSource, suppression, surfacePolicy, replacementRecovery });
  const report = await loop.runOnce();
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.governedRepliesReady, 1);

  const qualifiedPath = path.join(root, 'DATA', 'runtime', 'revenue', 'replies', 'qualified_reply_queue.json');
  const qualified = JSON.parse(fs.readFileSync(qualifiedPath, 'utf8'));
  assert.strictEqual(qualified.length, 1);
  assert.strictEqual(qualified[0].status, 'READY');
  assert.strictEqual(qualified[0].action, 'replyToEmail');
  assert.strictEqual(qualified[0].capability, 'INSTANTLY_SEND_REPLY');
  assert.strictEqual(qualified[0].reply_to_uuid, 'email-uuid-1');
  assert.strictEqual(qualified[0].eaccount, 'sender@outreach.example');
  assert.ok(qualified[0].body.text.includes('calendly.com/kevin-pathways2gc/30min'));

  const source = new RevenueMissionSourceService({ rootDir: root });
  const read = source.readCandidates();
  const replyCandidate = read.candidates.find(row => row.id === qualified[0].id);
  assert.ok(replyCandidate);
  assert.strictEqual(replyCandidate.status, 'READY');
  assert.strictEqual(replyCandidate.provider, 'INSTANTLY');
  assert.strictEqual(replyCandidate.action, 'replyToEmail');

  const queued = [];
  const taskQueue = { add(type, payload, priority) { const task = { id: 'task-1', type, payload, priority }; queued.push(task); return task; } };
  const commandPreflight = { evaluate() { return { ok: true, allowedToQueue: true, status: 'READY', blockers: [] }; } };
  const bridge = new BusinessOperationsBridgeService({ rootDir: root, taskQueue, commandPreflight, revenueMissionSource: source });
  const result = await bridge.runOnce();
  assert.strictEqual(result.operationsQueued, 1);
  assert.strictEqual(queued.length, 1);
  assert.strictEqual(queued[0].type, 'replyToEmail');
  assert.strictEqual(queued[0].payload.action, 'replyToEmail');
  assert.strictEqual(queued[0].payload.reply_to_uuid, 'email-uuid-1');
  assert.strictEqual(queued[0].payload.eaccount, 'sender@outreach.example');

  const reviewOnly = {
    ...qualified[0],
    id: 'QUALIFIED_REPLY_REVIEW_ONLY',
    reply_to_uuid: '',
    action: 'REVIEW_QUALIFIED_REPLY',
    type: 'REVIEW_QUALIFIED_REPLY',
    capability: 'REVIEW_QUALIFIED_REPLY',
    status: 'REVIEW_REQUIRED',
    owner: 'KEVIN'
  };
  fs.writeFileSync(qualifiedPath, JSON.stringify([reviewOnly], null, 2));
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-qualified-reply-review-'));
  fs.mkdirSync(path.join(root2, 'DATA', 'runtime', 'revenue', 'replies'), { recursive: true });
  fs.writeFileSync(path.join(root2, 'DATA', 'runtime', 'revenue', 'replies', 'qualified_reply_queue.json'), JSON.stringify([reviewOnly], null, 2));
  const queued2 = [];
  const bridge2 = new BusinessOperationsBridgeService({
    rootDir: root2,
    taskQueue: { add(type, payload, priority) { queued2.push({ type, payload, priority }); return { id: 'task-x' }; } },
    commandPreflight,
    revenueMissionSource: new RevenueMissionSourceService({ rootDir: root2 })
  });
  const result2 = await bridge2.runOnce();
  assert.strictEqual(result2.operationsQueued, 0);
  assert.strictEqual(queued2.length, 0);

  console.log('QUALIFIED_REPLY_REVENUE_BRIDGE_TEST=PASS');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});