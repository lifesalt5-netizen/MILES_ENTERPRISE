'use strict';

process.env.MILES_DRY_RUN = 'true';
process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'false';
process.env.MILES_CONTROLLED_WRITE_ENABLED = 'false';
process.env.INSTANTLY_WRITE_ENABLED = 'false';

const assert = require('assert');
const connector = require('../CONNECTORS/INSTANTLY/connector');

(async () => {
  const cases = [
    ['createCampaign', { name: 'Execution Truth Test' }],
    ['updateCampaign', { campaignId: 'campaign-test', updates: { name: 'Updated' } }],
    ['pauseCampaign', { campaignId: 'campaign-test', reason: 'test' }],
    ['activateCampaign', { campaignId: 'campaign-test' }],
    ['deleteCampaign', { campaignId: 'campaign-test', confirmation: 'DELETE:campaign-test' }]
  ];

  for (const [action, payload] of cases) {
    const result = await connector.execute({ action, payload });
    assert.strictEqual(result.ok, false, `${action} dry-run must not report success`);
    assert.strictEqual(result.status, 'DRY_RUN', `${action} must preserve DRY_RUN status`);
    assert.strictEqual(result.mutationExecuted, false, `${action} must prove no mutation`);
    assert.strictEqual(result.dryRun, true, `${action} must identify dry-run`);
    assert.strictEqual(result.executionTruth, 'NO_EXTERNAL_MUTATION');
  }

  const reply = await connector.execute({
    action: 'replyToEmail',
    payload: {
      eaccount: 'sender@example.com',
      reply_to_uuid: 'truth-reply-uuid',
      subject: 'Re: Test',
      body: { text: 'Test' }
    }
  });
  assert.strictEqual(reply.ok, false);
  assert.strictEqual(reply.status, 'DRY_RUN');
  assert.strictEqual(reply.mutationExecuted, false);
  assert.strictEqual(reply.executionTruth, 'NO_EXTERNAL_MUTATION');

  console.log('INSTANTLY_MUTATION_EXECUTION_TRUTH_TEST=PASS');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
