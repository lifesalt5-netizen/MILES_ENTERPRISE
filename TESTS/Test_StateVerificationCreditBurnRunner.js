'use strict';

const assert = require('assert');
const runner = require('../SERVICES/StateVerificationCreditBurnRunner');

assert.strictEqual(typeof runner.run, 'function');
assert.strictEqual(typeof runner.isAuthorized, 'function');

const previous = process.env.MILES_STATE_PIPELINE_PAID_VERIFICATION_AUTH;
delete process.env.MILES_STATE_PIPELINE_PAID_VERIFICATION_AUTH;

(async () => {
  const result = await runner.run({ creditBudget: 5965 });
  assert.strictEqual(result.status, 'AWAITING_APPROVAL');
  assert.strictEqual(result.creditsUsed, 0);
  assert.strictEqual(result.creditsRemaining, 5965);
  console.log('STATE_VERIFICATION_CREDIT_BURN_RUNNER_TEST=PASS');
})().finally(() => {
  if (previous === undefined) delete process.env.MILES_STATE_PIPELINE_PAID_VERIFICATION_AUTH;
  else process.env.MILES_STATE_PIPELINE_PAID_VERIFICATION_AUTH = previous;
});
