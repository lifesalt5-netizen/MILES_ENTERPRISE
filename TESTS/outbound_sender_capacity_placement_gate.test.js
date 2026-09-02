'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  providerUsable,
  ZERO_COST_PAID_SEAT_TARGET,
  ZERO_COST_TARGET_MAILBOXES
} = require('../SCRIPTS/AUDIT_OUTBOUND_SENDER_CAPACITY_V2');

const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'AUDIT_OUTBOUND_SENDER_CAPACITY_V2.js'), 'utf8');

assert.strictEqual(providerUsable({ email: 'ok@example.com', status: 1 }), true);
assert.strictEqual(providerUsable({ email: 'bad@example.com', status: 'inactive' }), false);
assert(src.includes("placementStatus === 'ACTIVE'"));
assert(src.includes('WATCH or UNVERIFIED senders contribute zero governed capacity'));
assert(src.includes('MILES_PLACEMENT_EVIDENCE_MAX_AGE_HOURS'));
assert(src.includes('providerUsableOutreachMailboxes'));
assert(src.includes('governedDailyCapacity'));
assert(src.includes('externalWritesPerformed: false'));

assert.deepStrictEqual(Object.keys(ZERO_COST_PAID_SEAT_TARGET).sort(), [
  'pathwaysgov.com',
  'pathwaysgovcon.com',
  'pathwaysgsa.com'
].sort());
assert.strictEqual(ZERO_COST_TARGET_MAILBOXES.length, 13);
assert.strictEqual(new Set(ZERO_COST_TARGET_MAILBOXES).size, 13);
assert(ZERO_COST_TARGET_MAILBOXES.includes('cora@pathwaysgovcon.com'));
assert(ZERO_COST_TARGET_MAILBOXES.includes('chris@pathwaysgsa.com'));
assert(ZERO_COST_TARGET_MAILBOXES.includes('aden@pathwaysgov.com'));
assert(!ZERO_COST_TARGET_MAILBOXES.some(email => email.endsWith('@pathways2gc.com')));
assert(src.includes('aliasesCountAsIndependentSenders: false'));
assert(src.includes('newWorkspaceLicensesPurchased: false'));
assert(src.includes('ZERO_COST_SENDER_CAPACITY_FULL_GO='));
assert(src.includes('All already-paid independent outreach mailboxes must be connected to Instantly'));

console.log('OUTBOUND_SENDER_CAPACITY_PLACEMENT_GATE=PASS');
