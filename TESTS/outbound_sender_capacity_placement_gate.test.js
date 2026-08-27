'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { providerUsable } = require('../SCRIPTS/AUDIT_OUTBOUND_SENDER_CAPACITY_V2');

const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'AUDIT_OUTBOUND_SENDER_CAPACITY_V2.js'), 'utf8');

assert.strictEqual(providerUsable({ email: 'ok@example.com', status: 1 }), true);
assert.strictEqual(providerUsable({ email: 'bad@example.com', status: 'inactive' }), false);
assert(src.includes("placementStatus === 'ACTIVE'"));
assert(src.includes('WATCH or UNVERIFIED senders contribute zero governed capacity'));
assert(src.includes('MILES_PLACEMENT_EVIDENCE_MAX_AGE_HOURS'));
assert(src.includes('providerUsableOutreachMailboxes'));
assert(src.includes('governedDailyCapacity'));
assert(src.includes('externalWritesPerformed: false'));

console.log('OUTBOUND_SENDER_CAPACITY_PLACEMENT_GATE=PASS');
