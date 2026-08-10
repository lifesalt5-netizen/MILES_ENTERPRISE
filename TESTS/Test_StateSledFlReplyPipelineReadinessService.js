'use strict';

const assert = require('assert');
const service = require('../SERVICES/StateSledFlReplyPipelineReadinessService');

(async () => {
  const r = await service.run();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.gate, 'P1.3P_FL_REPLY_PIPELINE_ROUTING_READINESS');
  assert.strictEqual(r.state, 'FL');
  assert.strictEqual(r.campaignName, 'STATE SLED - FL');
  assert.ok(Array.isArray(r.canonicalStages) && r.canonicalStages.length === 11);
  assert.deepStrictEqual(r.replyClasses, ['POSITIVE','NEUTRAL','NEGATIVE','TECHNICAL','OOO']);
  assert.strictEqual(r.safety.sendReplies, false);
  assert.strictEqual(r.safety.moveMailboxMessages, false);
  assert.strictEqual(r.safety.createCalendarEvents, false);
  assert.strictEqual(r.safety.mutateInstantlyCampaigns, false);
  assert.strictEqual(r.mutationAttempted, false);
  console.log('STATE_SLED_FL_REPLY_PIPELINE_READINESS_TEST=PASS');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
