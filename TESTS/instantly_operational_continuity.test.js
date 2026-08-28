'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const audit = require('../SCRIPTS/AuditInstantlyOperationalContinuity');

assert.strictEqual(audit.bounceRatePct({ emails_sent_count: 1000, bounced_count: 10 }), 1);
assert.strictEqual(audit.bounceStatus({ emails_sent_count: 1000, bounced_count: 10 }), 'GREEN');
assert.strictEqual(audit.bounceStatus({ emails_sent_count: 1000, bounced_count: 25 }), 'WATCH');
assert.strictEqual(audit.bounceStatus({ emails_sent_count: 1000, bounced_count: 30 }), 'RED');
assert.strictEqual(audit.bounceStatus({ emails_sent_count: 50, bounced_count: 10 }), 'INSUFFICIENT_VOLUME');
assert.strictEqual(audit.emailFrom('Name <Person@Example.com>'), 'person@example.com');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'instantly-continuity-'));
  const blockerDir = path.join(root, 'DATA', 'operational_acceptance');
  fs.mkdirSync(blockerDir, { recursive: true });
  const blockerPath = path.join(blockerDir, 'manual_external_blockers.json');
  fs.writeFileSync(blockerPath, JSON.stringify({ blockers: [{ id: 'INSTANTLY_BILLING_PAYMENT_FAILED', system: 'INSTANTLY', status: 'OPEN' }] }));

  const connector = {
    async execute(task) {
      switch (task.action) {
        case 'listCampaigns': return { ok: true, campaigns: [{ id: 'c1', name: 'Campaign 1' }] };
        case 'listAccounts': return { ok: true, accounts: [{ email: 'sender@example.com' }] };
        case 'getCampaignAnalytics': return { ok: true, analytics: [{ campaign_id: 'c1', campaign_name: 'Campaign 1', emails_sent_count: 1000, bounced_count: 10, reply_count: 5 }] };
        case 'listEmails': return { ok: true, emails: [{ id: 'e1', from: 'prospect@example.com', subject: 'Interested', body: { text: 'Interested in learning more' } }] };
        default: throw new Error('unexpected action');
      }
    }
  };
  const suppression = { isSuppressed: () => true };
  const red = await audit.run({ root, connector, suppression, blockerPath, output: path.join(root, 'red.json') });
  assert.strictEqual(red.status, 'RED');
  assert.strictEqual(red.checks.billingContinuity, 'RED');
  assert.strictEqual(red.nextAction, 'RESOLVE_INSTANTLY_BILLING_FAILURE');
  assert.strictEqual(red.safety.providerMutation, false);

  fs.writeFileSync(blockerPath, JSON.stringify({ blockers: [] }));
  const green = await audit.run({ root, connector, suppression, blockerPath, output: path.join(root, 'green.json') });
  assert.strictEqual(green.status, 'GREEN');
  assert.strictEqual(green.checks.billingContinuity, 'GREEN');
  assert.strictEqual(green.checks.campaignBounceHealth, 'GREEN');

  console.log('INSTANTLY_OPERATIONAL_CONTINUITY=PASS');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
