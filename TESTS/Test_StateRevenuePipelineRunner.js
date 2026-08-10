'use strict';

const assert = require('assert');
const runner = require('../SERVICES/StateRevenuePipelineRunner');

(async () => {
  delete process.env.MILES_STATE_PIPELINE_PAID_VERIFICATION_AUTH;
  delete process.env.MILES_STATE_PIPELINE_CAMPAIGN_MUTATION_AUTH;
  delete process.env.MILES_STATE_PIPELINE_REPLY_SEND_AUTH;
  delete process.env.MILES_STATE_PIPELINE_CALENDAR_WRITE_AUTH;

  const approvals = runner.approvalState();
  assert.strictEqual(approvals.paidVerificationSpendAuthorized, false);
  assert.strictEqual(approvals.campaignMutationAuthorized, false);
  assert.strictEqual(approvals.liveReplySendAuthorized, false);
  assert.strictEqual(approvals.calendarWriteAuthorized, false);

  console.log('STATE_REVENUE_PIPELINE_RUNNER_TEST=PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
