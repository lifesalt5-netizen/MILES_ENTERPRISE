'use strict';

const assert = require('assert');
const service = require('../SERVICES/StateSledFlGovernedReplySendReadinessService');

const result = service.run();

assert.strictEqual(result.ok, true);
assert.strictEqual(result.gate, 'P1.3Z_FL_GOVERNED_REPLY_SEND_READINESS');
assert.strictEqual(result.safety.sendReplies, false);
assert.strictEqual(result.mutationAttempted, false);
assert.ok(Object.prototype.hasOwnProperty.call(result.discoveredCapabilities, 'instantlySendReply'));

console.log('STATE_SLED_FL_GOVERNED_REPLY_SEND_READINESS_TEST=PASS');
