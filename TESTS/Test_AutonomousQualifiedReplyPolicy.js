'use strict';

const assert = require('assert');
const { evaluateQualifiedReplyForAutonomy } = require('../SERVICES/revenue/AutonomousQualifiedReplyPolicy');

const eligible = evaluateQualifiedReplyForAutonomy({
  category: 'MEETING_INTENT',
  confidence: 0.98,
  qualifiedPositive: true,
  humanReply: true,
  emailId: 'uuid-1',
  eaccount: 'sender@example.com'
});
assert.strictEqual(eligible.eligible, true);
assert.strictEqual(eligible.category, 'MEETING_INTENT');
assert.strictEqual(eligible.action, 'PREPARE_GOVERNED_REPLY');

const pricingAlias = evaluateQualifiedReplyForAutonomy({
  category: 'PRICING',
  confidence: 0.96,
  qualifiedPositive: true,
  humanReply: true,
  reply_to_uuid: 'uuid-price',
  eaccount: 'sender@example.com'
});
assert.strictEqual(pricingAlias.eligible, true);
assert.strictEqual(pricingAlias.category, 'PRICING_QUESTION');

const ooo = evaluateQualifiedReplyForAutonomy({
  category: 'OOO',
  confidence: 0.99,
  emailId: 'uuid-2',
  eaccount: 'sender@example.com'
});
assert.strictEqual(ooo.eligible, false);

const suppressed = evaluateQualifiedReplyForAutonomy({
  category: 'INTERESTED',
  confidence: 0.99,
  qualifiedPositive: true,
  humanReply: true,
  emailId: 'uuid-3',
  eaccount: 'sender@example.com',
  hardSuppression: true
});
assert.strictEqual(suppressed.eligible, false);

const lowConfidence = evaluateQualifiedReplyForAutonomy({
  category: 'PRICING_QUESTION',
  confidence: 0.7,
  qualifiedPositive: true,
  humanReply: true,
  emailId: 'uuid-4',
  eaccount: 'sender@example.com'
});
assert.strictEqual(lowConfidence.eligible, false);

console.log('AUTONOMOUS_QUALIFIED_REPLY_POLICY_TEST=PASS');
