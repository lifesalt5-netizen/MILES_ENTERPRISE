'use strict';

const assert = require('assert');
const policyEngine = require('../SERVICES/governance/PolicyEngineService');
const approvalGate = require('../SERVICES/governance/ApprovalGateService');

function task(overrides = {}) {
  return {
    id: 'qualified-reply-test',
    type: 'replyToEmail',
    action: 'replyToEmail',
    provider: 'INSTANTLY',
    connector: 'INSTANTLY',
    payload: {
      action: 'replyToEmail',
      capability: 'INSTANTLY_SEND_REPLY',
      provider: 'INSTANTLY',
      connector: 'INSTANTLY',
      source: 'qualified_replies',
      category: 'MEETING_INTENT',
      confidence: 0.98,
      autonomy: { eligible: true, confidence: 0.98, suppressed: false },
      reply_to_uuid: 'email-uuid-1',
      eaccount: 'sender@outreach.example',
      subject: 'Re: Government contracting',
      body: { text: 'Happy to connect. Choose a time here: https://calendly.com/example' },
      ...overrides
    }
  };
}

const governed = policyEngine.evaluate(task());
assert.strictEqual(governed.decision, 'ALLOW');
assert.strictEqual(governed.approvalRequired, false);
assert.strictEqual(governed.matches.governedQualifiedReply, true);
assert.strictEqual(approvalGate.evaluate(task(), governed).allowed, true);

const missingEvidence = policyEngine.evaluate(task({ reply_to_uuid: '' }));
assert.strictEqual(missingEvidence.decision, 'REQUIRE_APPROVAL');
assert.strictEqual(missingEvidence.approvalRequired, true);
assert.strictEqual(missingEvidence.matches.governedQualifiedReply, false);

const suppressed = policyEngine.evaluate(task({ autonomy: { eligible: true, confidence: 0.99, suppressed: true } }));
assert.strictEqual(suppressed.decision, 'REQUIRE_APPROVAL');
assert.strictEqual(suppressed.matches.governedQualifiedReply, false);

const ordinaryManualReply = policyEngine.evaluate({
  type: 'replyToEmail',
  action: 'replyToEmail',
  provider: 'INSTANTLY',
  connector: 'INSTANTLY',
  payload: {
    action: 'replyToEmail',
    provider: 'INSTANTLY',
    connector: 'INSTANTLY',
    reply_to_uuid: 'uuid',
    eaccount: 'sender@outreach.example',
    body: { text: 'manual reply' }
  }
});
assert.strictEqual(ordinaryManualReply.decision, 'REQUIRE_APPROVAL');
assert.strictEqual(ordinaryManualReply.approvalRequired, true);

console.log('GOVERNED_QUALIFIED_REPLY_APPROVAL_TEST=PASS');
