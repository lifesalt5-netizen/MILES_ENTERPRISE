'use strict';

const assert = require('assert');
const { InstantlyInboxPlacementTestService } = require('../SERVICES/revenue/InstantlyInboxPlacementTestService');

function clientFor({ accounts = [], options = [], tests = [], created = null } = {}) {
  const calls = [];
  return {
    calls,
    async request(endpoint, req = {}) {
      calls.push({ endpoint, req });
      if (endpoint === '/accounts') return { items: accounts };
      if (endpoint === '/inbox-placement-tests/email-service-provider-options') return { items: options };
      if (endpoint === '/inbox-placement-tests' && req.method === 'GET') return { items: tests };
      if (endpoint === '/inbox-placement-tests' && req.method === 'POST') return created || { id: 'test-123' };
      if (endpoint === '/inbox-placement-tests/test-123') return { id: 'test-123', status: 1, not_sending_status: '' };
      throw new Error(`Unexpected ${req.method || 'GET'} ${endpoint}`);
    }
  };
}

(async () => {
  const providers = [
    { region: 'North America', sub_region: 'US', type: 'Professional', esp: 'Google' },
    { region: 'North America', sub_region: 'US', type: 'Professional', esp: 'Microsoft' },
    { region: 'Europe', sub_region: 'UK', type: 'Professional', esp: 'Google' }
  ];
  const client = clientFor({
    accounts: [
      { email: 'good@pathways2gc.com', status: 1, inbox_placement_test_limit: 2 },
      { email: 'zero@pathways2gc.com', status: 1, inbox_placement_test_limit: 0 },
      { email: 'dead@pathways2gc.com', status: -1, inbox_placement_test_limit: 2 }
    ],
    options: providers
  });
  const svc = new InstantlyInboxPlacementTestService({ client, now: () => new Date('2026-08-26T12:00:00Z') });
  const plan = await svc.buildPlan();
  assert.deepStrictEqual(plan.eligibleSenders, ['good@pathways2gc.com']);
  assert.deepStrictEqual(plan.zeroLimitSenders, ['zero@pathways2gc.com']);
  assert.strictEqual(plan.providerLabels.length, 2);
  assert.strictEqual(plan.ready, true);

  const created = await svc.createControlledBaseline();
  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.created, true);
  assert.strictEqual(created.externalReadbackVerified, true);
  const post = client.calls.find(c => c.endpoint === '/inbox-placement-tests' && c.req.method === 'POST');
  assert(post, 'Expected provider create call');
  assert.strictEqual(post.req.body.type, 1);
  assert.strictEqual(post.req.body.sending_method, 1);
  assert.strictEqual(post.req.body.delivery_mode, 1);
  assert.strictEqual(post.req.body.text_only, true);
  assert.deepStrictEqual(post.req.body.emails, ['good@pathways2gc.com']);
  assert.strictEqual(post.req.body.recipients_labels.length, 2);

  const blockedClient = clientFor({ accounts: [{ email: 'zero@example.com', status: 1, inbox_placement_test_limit: 0 }], options: providers });
  const blocked = await new InstantlyInboxPlacementTestService({ client: blockedClient }).createControlledBaseline();
  assert.strictEqual(blocked.ok, false);
  assert(blocked.plan.blockers.includes('NO_ACTIVE_SENDER_WITH_INBOX_PLACEMENT_CAPACITY'));
  assert.strictEqual(blockedClient.calls.some(c => c.req.method === 'POST'), false);

  const existingClient = clientFor({
    accounts: [{ email: 'good@example.com', status: 1, inbox_placement_test_limit: 1 }],
    options: providers,
    tests: [{ id: 'existing-1', name: 'P2GC Baseline Inbox Placement 2026-08-26', status: 1 }]
  });
  const existingSvc = new InstantlyInboxPlacementTestService({ client: existingClient, now: () => new Date('2026-08-26T12:00:00Z') });
  const reused = await existingSvc.createControlledBaseline();
  assert.strictEqual(reused.ok, true);
  assert.strictEqual(reused.reused, true);
  assert.strictEqual(existingClient.calls.some(c => c.req.method === 'POST'), false);

  const forceClient = clientFor({
    accounts: [{ email: 'good@example.com', status: 1, inbox_placement_test_limit: 1 }],
    options: providers,
    tests: [{ id: 'existing-1', name: 'P2GC Baseline Inbox Placement 2026-08-26', status: 1 }]
  });
  const forceSvc = new InstantlyInboxPlacementTestService({ client: forceClient, now: () => new Date('2026-08-26T12:34:56.789Z') });
  const forced = await forceSvc.createControlledBaseline({ forceNew: true });
  assert.strictEqual(forced.ok, true);
  assert.strictEqual(forced.created, true);
  assert.strictEqual(forced.reused, false);
  assert.strictEqual(forced.plan.existingTest, null);
  assert(forced.plan.name.includes('POST-DMARC'));
  assert(forceClient.calls.some(c => c.endpoint === '/inbox-placement-tests' && c.req.method === 'POST'));

  console.log('INSTANTLY_CONTROLLED_INBOX_PLACEMENT_TEST=PASS');
})().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
