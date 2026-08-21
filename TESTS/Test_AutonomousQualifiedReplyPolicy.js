'use strict';

const assert = require('assert');
const { evaluateQualifiedReplyForAutonomy } = require('../SERVICES/revenue/AutonomousQualifiedReplyPolicy');

const eligible = evaluateQualifiedReplyForAutonomy({
  category: 'MEETING',
  confidence: 0.98,
  reply_to_uuid: 'uuid-1',
  eaccount: 'sender@example.com'
});
assert.strictEqual(eligible.eligible, true);
assert.strictEqual(eligible.action, 'PREPARE_GOVERNED_REPLY');

const ooo = evaluateQualifiedReplyForAutonomy({
  category: 'OOO',
  confidence: 0.99,
  reply_to_uuid: 'uuid-2',
  eaccount: 'sender@example.com'
});
assert.strictEqual(ooo.eligible, false);

const suppressed = evaluateQualifiedReplyForAutonomy({
  category: 'INTERESTED',
  confidence: 0.99,
  reply_to_uuid: 'uuid-3',
  eaccount: 'sender@example.com',
  unsubscribe: true
});
assert.strictEqual(suppressed.eligible, false);

const lowConfidence = evaluateQualifiedReplyForAutonomy({
  category: 'PRICING',
  confidence: 0.7,
  reply_to_uuid: 'uuid-4',
  eaccount: 'sender@example.com'
});
assert.strictEqual(lowConfidence.eligible, false);

console.log('AUTONOMOUS_QUALIFIED_REPLY_POLICY_TEST=PASS');
