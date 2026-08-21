'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-crm-progression-'));
process.env.MILES_ROOT = root;

fs.mkdirSync(path.join(root, 'CONFIG'), { recursive: true });
fs.writeFileSync(path.join(root, 'CONFIG', 'canonical_crm_rules.json'), JSON.stringify({
  version: '1.1.0',
  stages: ['Target','Contacted','Engaged','Qualified','Meeting Set','Meeting Held','Proposal','Negotiation','Won','Lost','Client'],
  identityPriority: ['email','uei','companyDomain','legalName'],
  storageFile: 'DATA/CRM/canonical_crm.json',
  auditFile: 'DATA/CRM/canonical_crm_audit.jsonl',
  allowAutomaticStageRegression: false,
  requireRoutingEventForStageChange: true
}, null, 2));

const crm = require('../SERVICES/CanonicalCrmService');
const RevenueCrmProgressionService = require('../SERVICES/revenue/RevenueCrmProgressionService');

const queueDir = path.join(root, 'DATA', 'runtime', 'revenue', 'replies');
fs.mkdirSync(queueDir, { recursive: true });
fs.writeFileSync(path.join(queueDir, 'qualified_reply_queue.json'), JSON.stringify([
  {
    id: 'QUALIFIED_REPLY_1',
    category: 'MEETING_INTENT',
    qualifiedPositive: true,
    confidence: 0.98,
    contactEmail: 'prospect@example.com',
    campaignId: 'campaign-1',
    leadId: 'lead-1',
    emailId: 'email-1',
    timestamp: '2026-08-20T20:00:00.000Z'
  }
], null, 2));

const service = new RevenueCrmProgressionService({ rootDir: root, crm });
const report = service.runOnce({
  calendlyPipeline: {
    ok: true,
    upcomingMeetings: [{
      eventUri: 'https://api.calendly.com/scheduled_events/1',
      eventName: 'Federal Strategy Call',
      startTime: '2026-08-25T15:00:00.000Z',
      eventStatus: 'active',
      inviteeUri: 'https://api.calendly.com/invitees/1',
      inviteeName: 'Prospect Person',
      inviteeEmail: 'prospect@example.com',
      canceled: false
    }],
    recentMeetings: [{
      eventUri: 'https://api.calendly.com/scheduled_events/past',
      eventName: 'Federal Strategy Call',
      startTime: '2026-08-10T15:00:00.000Z',
      eventStatus: 'active',
      inviteeEmail: 'other@example.com',
      canceled: false
    }]
  }
});

assert.strictEqual(report.ok, true);
assert.strictEqual(report.qualifiedReplyProgression.progressed, 1);
assert.strictEqual(report.calendlyProgression.meetingSetProgressed, 1);
assert.strictEqual(report.calendlyProgression.meetingHeldAutoProgressed, 0);
assert.strictEqual(report.calendlyProgression.pastMeetingEvidence[0].attendanceVerified, false);

let record = crm.getByIdentity({ email: 'prospect@example.com' });
assert.ok(record);
assert.strictEqual(record.stage, 'Meeting Set');
assert.strictEqual(record.replyCategory, 'MEETING_INTENT');
assert.strictEqual(record.calendlyEventUri, 'https://api.calendly.com/scheduled_events/1');

crm.updateStage({ email: 'prospect@example.com' }, 'Proposal', { type: 'PROPOSAL_ISSUED', source: 'TEST' });
service.runOnce({
  calendlyPipeline: {
    ok: true,
    upcomingMeetings: [{
      eventUri: 'https://api.calendly.com/scheduled_events/1',
      eventName: 'Federal Strategy Call',
      startTime: '2026-08-25T15:00:00.000Z',
      eventStatus: 'active',
      inviteeEmail: 'prospect@example.com',
      canceled: false
    }],
    recentMeetings: []
  }
});
record = crm.getByIdentity({ email: 'prospect@example.com' });
assert.strictEqual(record.stage, 'Proposal');

const caps = crm.getCapabilities();
assert.strictEqual(caps.rootDir, root);
assert.strictEqual(caps.crmAdvanceStageAtLeast, true);

const progressionArtifact = path.join(root, 'DATA', 'revenue_pipeline', 'latest_crm_progression.json');
assert.strictEqual(fs.existsSync(progressionArtifact), true);

console.log('REVENUE_CRM_PROGRESSION_TEST=PASS');
