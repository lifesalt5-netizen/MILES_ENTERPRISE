'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const QualifiedProspectNurtureService = require('../SERVICES/revenue/QualifiedProspectNurtureService');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2gc-nurture-'));
  const now = new Date('2026-08-23T15:00:00Z');

  writeJson(path.join(root, 'CONFIG', 'p2gc_qualified_nurture_rules.json'), {
    stop_stages: ['Meeting Set','Meeting Held','Proposal','Negotiation','Won','Lost','Client'],
    cadence: {
      NOT_NOW: { additional_days: [30, 60], max_touches: 3 },
      OOO: { additional_days: [7], max_touches: 2 },
      QUALIFIED_NO_MEETING: { first_touch_after_days: 2, additional_days: [7,21], max_touches: 3 }
    },
    content_routes: {
      NOT_NOW: 'REFRESHED_INTELLIGENCE_OR_RELEVANT_CASE_STUDY',
      OOO: 'SHORT_CONTEXT_RESTART',
      QUALIFIED_NO_MEETING: 'SPECIFIC_ORIGINAL_FINDING_PLUS_LOW_FRICTION_NEXT_STEP'
    }
  });

  writeJson(path.join(root, 'DATA', 'runtime', 'revenue', 'replies', 'followup_queue.json'), [
    {
      conversationKey: 'THREAD:not-now',
      category: 'NOT_NOW',
      from: 'notnow@example.com',
      campaignId: 'C1',
      emailId: 'E1',
      subject: 'Original subject',
      followUpAt: '2026-08-23T14:00:00Z'
    },
    {
      conversationKey: 'THREAD:suppressed',
      category: 'NOT_NOW',
      from: 'stop@example.com',
      campaignId: 'C2',
      emailId: 'E2',
      followUpAt: '2026-08-23T14:00:00Z'
    }
  ]);

  writeJson(path.join(root, 'DATA', 'runtime', 'revenue', 'replies', 'qualified_reply_queue.json'), [
    {
      conversationKey: 'THREAD:qualified',
      category: 'INTERESTED',
      contactEmail: 'qualified@example.com',
      campaignId: 'C3',
      reply_to_uuid: 'R3',
      eaccount: 'sender@example.com',
      subject: 'Interested'
    }
  ]);

  writeJson(path.join(root, 'DATA', 'CRM', 'canonical_crm.json'), {
    version: 1,
    records: [
      { id: 'CRM1', email: 'notnow@example.com', campaignId: 'C1', stage: 'Qualified' },
      { id: 'CRM2', email: 'stop@example.com', campaignId: 'C2', stage: 'Qualified' },
      { id: 'CRM3', email: 'qualified@example.com', campaignId: 'C3', stage: 'Qualified', lastQualifiedReplyAt: '2026-08-20T12:00:00Z' },
      { id: 'CRM4', email: 'meeting@example.com', campaignId: 'C4', stage: 'Meeting Set', lastQualifiedReplyAt: '2026-08-20T12:00:00Z' }
    ]
  });

  const suppression = {
    isSuppressed(email) { return email === 'stop@example.com'; }
  };

  const connector = {
    async execute(task) {
      if (task.action === 'getEmail') {
        return { email: { id: task.payload.id, reply_to_uuid: `R-${task.payload.id}`, eaccount: 'sender@example.com', subject: 'Original subject' } };
      }
      if (task.action === 'replyToEmail') {
        return { ok: false, status: 'DRY_RUN', mutationExecuted: false };
      }
      throw new Error(`Unexpected action ${task.action}`);
    }
  };

  const service = new QualifiedProspectNurtureService({ rootDir: root, now: () => now, suppression, connector });
  const report = await service.buildQueue();

  assert.equal(report.ok, true);
  assert.equal(report.dueQueued, 2);
  assert.equal(report.executableNow, 2);
  assert.ok(report.queue.some(x => x.category === 'NOT_NOW' && x.contactEmail === 'notnow@example.com'));
  assert.ok(report.queue.some(x => x.category === 'QUALIFIED_NO_MEETING' && x.contactEmail === 'qualified@example.com'));
  assert.ok(report.skipped.some(x => x.email === 'stop@example.com' && x.reason === 'GLOBAL_SUPPRESSION'));
  assert.equal(report.queue.some(x => x.contactEmail === 'meeting@example.com'), false);
  assert.equal(report.safety.genericColdRecycle, false);

  const execution = await service.executeReady(report);
  assert.equal(execution.attempted, 2);
  assert.equal(execution.executed, 0);
  assert.equal(execution.dryRunOrBlocked, 2);

  console.log('QualifiedProspectNurtureService tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
