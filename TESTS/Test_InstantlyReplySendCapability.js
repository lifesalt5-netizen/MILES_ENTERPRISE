'use strict';

process.env.MILES_DRY_RUN = 'true';
process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'false';

const assert = require('assert');
const instantly = require('../CONNECTORS/INSTANTLY/instantly');
const connector = require('../CONNECTORS/INSTANTLY/connector');

(async () => {
  assert(connector.capabilities.includes('INSTANTLY_SEND_REPLY'));

  let missing = null;
  try {
    await instantly.replyToEmail({});
  } catch (error) {
    missing = error;
  }
  assert(missing, 'missing required fields should fail');

  const dryRun = await instantly.replyToEmail({
    eaccount: 'sender@example.com',
    reply_to_uuid: '123e4567-e89b-12d3-a456-426614174000',
    subject: 'Re: Test',
    body: { text: 'Test reply' }
  });

  assert.strictEqual(dryRun.dryRun, true);
  assert.strictEqual(dryRun.mutationExecuted, false);
  assert.strictEqual(dryRun.action, 'replyToEmail');
  assert.strictEqual(dryRun.wouldExecute.endpoint, '/emails/reply');

  console.log('INSTANTLY_REPLY_SEND_CAPABILITY_TEST=PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
