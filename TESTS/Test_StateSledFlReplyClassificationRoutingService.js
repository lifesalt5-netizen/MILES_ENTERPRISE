'use strict';

const assert = require('assert');
const s = require('../SERVICES/StateSledFlReplyClassificationRoutingService');

assert.equal(s.classifyReply({ body: 'Yes, I am interested. Send me times.' }).replyClass, 'POSITIVE');
assert.equal(s.classifyReply({ body: 'Please remove me from your list.' }).replyClass, 'NEGATIVE');
assert.equal(s.classifyReply({ body: 'Automatic reply: I am out of office until Monday.' }).replyClass, 'OOO');
assert.equal(s.classifyReply({ body: '550 mailbox unavailable' }).replyClass, 'TECHNICAL');
assert.equal(s.classifyReply({ body: 'Thanks for reaching out.' }).replyClass, 'NEUTRAL');
assert.equal(s.normalizeEmail({ from_address: ' Test@Example.COM ' }), 'test@example.com');

console.log('STATE_SLED_FL_REPLY_CLASSIFICATION_ROUTING_TEST=PASS');
