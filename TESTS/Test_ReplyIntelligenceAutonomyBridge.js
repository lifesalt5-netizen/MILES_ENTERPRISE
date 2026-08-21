'use strict';

const assert = require('assert');
const ReplyIntelligenceEngine = require('../SERVICES/ReplyIntelligenceEngine');

(async () => {
  const engine = new ReplyIntelligenceEngine();
  const result = await engine.processReplies([
    {
      id: 'reply-email-uuid-1',
      eaccount: 'sender@example.com',
      from_address_email: 'prospect@example.org',
      subject: 'Re: Government contracting',
      body: { text: 'Yes, I am interested. Can we schedule a call?' },
      campaign_id: 'campaign-1',
      lead_id: 'lead-1'
    },
    {
      id: 'reply-email-uuid-2',
      eaccount: 'sender@example.com',
      from_address_email: 'other@example.org',
      subject: 'Automatic reply',
      body: { text: 'I am out of the office this week.' },
      campaign_id: 'campaign-1',
      lead_id: 'lead-2'
    }
  ]);

  assert.strictEqual(result.governedReplyCandidates, 1);
  assert.strictEqual(result.safety.prospectFacingRepliesSent, 0);
  assert.strictEqual(result.safety.governedReplyCandidatesPrepared, 1);

  const candidate = result.processed.find(row => row.autonomy && row.autonomy.eligible);
  assert(candidate);
  assert.strictEqual(candidate.classification.category, 'MEETING_INTENT');
  assert.strictEqual(candidate.autonomy.reply_to_uuid, 'reply-email-uuid-1');
  assert.strictEqual(candidate.autonomy.eaccount, 'sender@example.com');

  const ooo = result.processed.find(row => row.classification.category === 'OOO');
  assert(ooo);
  assert.strictEqual(ooo.autonomy.eligible, false);

  console.log('REPLY_INTELLIGENCE_AUTONOMY_BRIDGE_TEST=PASS');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
