'use strict';

const assert = require('assert');

process.env.MILES_DRY_RUN = 'true';
process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'false';
process.env.MILES_CONTROLLED_WRITE_ENABLED = 'false';
process.env.INSTANTLY_WRITE_ENABLED = 'false';

const { evaluateQualifiedReplyForAutonomy } = require('../SERVICES/revenue/AutonomousQualifiedReplyPolicy');
const connector = require('../CONNECTORS/INSTANTLY/connector');

(async () => {
  const classified = {
    category: 'INTERESTED',
    confidence: 0.97,
    reply_to_uuid: 'contract-reply-uuid',
    eaccount: 'sender@example.com'
  };

  const decision = evaluateQualifiedReplyForAutonomy(classified);
  assert.strictEqual(decision.eligible, true);

  const execution = await connector.execute({
    action: 'replyToEmail',
    payload: {
      eaccount: classified.eaccount,
      reply_to_uuid: classified.reply_to_uuid,
      subject: 'Re: Your government contracting goals',
      body: { text: 'Thanks for your interest. I can help with the next step.' }
    }
  });

  assert.strictEqual(execution.ok, true);
  assert.strictEqual(execution.mutationExecuted, false);
  assert.strictEqual(execution.status, 'DRY_RUN');
  console.log('GUARDED_REPLY_SEND_END_TO_END_CONTRACT_TEST=PASS');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
