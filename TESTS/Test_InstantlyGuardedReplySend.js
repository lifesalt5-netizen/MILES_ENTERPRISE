'use strict';

const assert = require('assert');

process.env.MILES_DRY_RUN = 'true';
process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'false';
process.env.MILES_CONTROLLED_WRITE_ENABLED = 'false';
process.env.INSTANTLY_WRITE_ENABLED = 'false';

const contracts = require('../CORE/ExecutionActionContracts');
const connector = require('../CONNECTORS/INSTANTLY/connector');

(async () => {
  assert.strictEqual(contracts.normalizeInstantlyAction('replyToEmail'), 'replyToEmail');
  assert.strictEqual(contracts.normalizeInstantlyAction('sendReply'), 'replyToEmail');
  assert.strictEqual(connector.canExecuteAction('sendReply'), true);
  assert(connector.capabilities.includes('INSTANTLY_SEND_REPLY'));

  const result = await connector.execute({
    action: 'sendReply',
    payload: {
      eaccount: 'sender@example.com',
      reply_to_uuid: 'reply-test-uuid',
      subject: 'Re: Government contracting',
      body: { text: 'Thanks for the reply. Here is the next step.' }
    }
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.action, 'replyToEmail');
  assert.strictEqual(result.status, 'DRY_RUN');
  assert.strictEqual(result.mutationExecuted, false);
  assert.strictEqual(result.dryRun, true);
  assert.strictEqual(result.executionTruth, 'NO_EXTERNAL_MUTATION');
  assert.strictEqual(result.wouldExecute.endpoint, '/emails/reply');

  const invalid = await connector.execute({ action: 'replyToEmail', payload: {} });
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.mutationExecuted, false);

  console.log('INSTANTLY_GUARDED_REPLY_SEND_TEST=PASS');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
