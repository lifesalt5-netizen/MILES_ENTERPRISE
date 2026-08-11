'use strict';

const assert = require('assert');
const r = require('../SERVICES/StateVerifiedRevenueDeploymentRunner');

const healthy = r.healthyAccounts({ items: [
  { email: 'good@example.com', status: 1, warmup_status: 1, setup_pending: false, stat_warmup_score: 90 },
  { email: 'bad@example.com', status: 0, warmup_status: 1, setup_pending: false, stat_warmup_score: 95 }
]});
assert.strictEqual(healthy.length, 1);
assert.strictEqual(healthy[0].email, 'good@example.com');

const tx = r.stateSequence('TX');
assert.ok(tx.length >= 4);
assert.ok(JSON.stringify(tx).includes('Texas'));
assert.ok(!JSON.stringify(tx).includes('Florida'));

const payload = r.campaignPayload('CA', 'sender@example.com', 12);
assert.strictEqual(payload.name, 'STATE SLED - CA');
assert.deepStrictEqual(payload.email_list, ['sender@example.com']);
assert.strictEqual(payload.daily_limit, 12);
assert.strictEqual(payload.daily_max_leads, 12);
assert.strictEqual(payload.stop_on_reply, true);
assert.strictEqual(payload.allow_risky_contacts, false);

const lead = r.leadPayload({ discoveredEmail: 'A@EXAMPLE.COM', legalName: 'Acme', domain: 'acme.com', uei: 'ABC123' }, 'cmp1', 'MD');
assert.strictEqual(lead.email, 'a@example.com');
assert.strictEqual(lead.campaign, 'cmp1');
assert.strictEqual(lead.custom_variables.source_segment, 'STATE_SLED_MD');
assert.strictEqual(lead.skip_if_in_campaign, true);

assert.strictEqual(r.authorized({}), false);
console.log('STATE_VERIFIED_REVENUE_DEPLOYMENT_RUNNER_TEST=PASS');
