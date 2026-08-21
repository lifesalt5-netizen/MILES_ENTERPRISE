'use strict';

const assert = require('assert');
const service = require('../SERVICES/StateRevenueDeploymentRunner');
const { inspectCampaignSchedule, inspectSenderCapacity } = require('../SERVICES/revenue/OutboundSendingGovernance');

const seq = service.sequenceForState('TX');
assert(Array.isArray(seq) && seq.length === 4, 'Expected four sequence steps.');
assert(seq[0].variants[0].subject.includes('TX'), 'Expected state-specific subject.');

const payload = service.campaignPayload('VA', ['sender@example.com']);
assert.strictEqual(payload.name, 'STATE SLED - VA');
assert.strictEqual(payload.daily_limit, 25);
assert.strictEqual(payload.stop_on_reply, true);
assert.strictEqual(payload.link_tracking, false);
assert.strictEqual(payload.open_tracking, false);
assert.strictEqual(payload.allow_risky_contacts, false);
assert.deepStrictEqual(payload.email_list, ['sender@example.com']);
assert.strictEqual(inspectCampaignSchedule(payload).compliant, true, 'State campaign must obey Eastern weekday send governance');
assert.strictEqual(inspectSenderCapacity(payload, 1).compliant, true, 'State campaign must obey 25/day/inbox capacity');

const lead = service.leadPayload({ discoveredEmail:'Test@Example.com', legalName:'Example LLC', domain:'example.com', uei:'ABC123' }, 'CID', 'MD');
assert.strictEqual(lead.email, 'test@example.com');
assert.strictEqual(lead.campaign, 'CID');
assert.strictEqual(lead.skip_if_in_workspace, true);
assert.strictEqual(lead.skip_if_in_campaign, true);
assert.strictEqual(lead.verify_leads_on_import, true);
assert.strictEqual(lead.custom_variables.source_segment, 'STATE_SLED_MD');

console.log('STATE_REVENUE_DEPLOYMENT_RUNNER_TEST=PASS');
