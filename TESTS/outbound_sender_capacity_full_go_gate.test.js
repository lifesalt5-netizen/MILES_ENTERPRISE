'use strict';

const assert = require('assert');
const { parse } = require('../SCRIPTS/RunOutboundSenderCapacityFullGoGate');

const green = parse(`
Zero-cost paid-seat target: 13
Zero-cost target connected: 13
Zero-cost target governed ACTIVE: 13
Zero-cost target missing from Instantly: NONE
ZERO_COST_SENDER_CAPACITY_FULL_GO=YES
`);
assert.strictEqual(green.marker, 'YES');
assert.strictEqual(green.target, 13);
assert.strictEqual(green.connected, 13);
assert.strictEqual(green.governedActive, 13);
assert.strictEqual(green.missing, 'NONE');

const redMissing = parse(`
Zero-cost paid-seat target: 13
Zero-cost target connected: 9
Zero-cost target governed ACTIVE: 9
Zero-cost target missing from Instantly: chris@pathwaysgsa.com, jake@pathwaysgsa.com
ZERO_COST_SENDER_CAPACITY_FULL_GO=NO
`);
assert.strictEqual(redMissing.marker, 'NO');
assert.strictEqual(redMissing.connected, 9);
assert.strictEqual(redMissing.governedActive, 9);

const unproven = parse('Zero-cost paid-seat target: 13\n');
assert.strictEqual(unproven.marker, 'MISSING');
assert.strictEqual(unproven.connected, null);

console.log('OUTBOUND_SENDER_CAPACITY_FULL_GO_GATE_TEST=PASS');
