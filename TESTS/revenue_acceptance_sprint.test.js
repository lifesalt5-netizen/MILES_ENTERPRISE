'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mod = require('../SCRIPTS/RunRevenueAcceptanceSprint');

const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunRevenueAcceptanceSprint.js'), 'utf8');

assert.strictEqual(mod.DEFAULT_TEST_ID, '01a040ce-dbf7-7872-8938-f1501647af92');
assert(mod.SAFE_AUDITS.length >= 8, 'Expected batched read-only acceptance coverage');
assert.strictEqual(mod.MIN_ANALYTICS_ROWS, 27);
assert.strictEqual(mod.MIN_SENDER_EVIDENCE, 9);
assert.strictEqual(mod.REQUIRED_STABLE_POLLS, 2);
assert.strictEqual(mod.MIN_PLATEAU_ROWS, 18);
assert.strictEqual(mod.REQUIRED_PLATEAU_POLLS, 4);
assert.deepStrictEqual(mod.parsePlacement('Analytics rows: 9\nSenders with evidence: 9\nAUTH WATCH: maya@pathwaysgovcon.com\n'), {
  rows: 9,
  senders: 9,
  authWatchSenders: ['maya@pathwaysgovcon.com']
});
assert.deepStrictEqual(mod.parsePlacement('Analytics rows: 44\nSenders with evidence: 9\n'), {
  rows: 44,
  senders: 9,
  authWatchSenders: []
});
assert.strictEqual(
  mod.placementFingerprint({ rows: 18, senders: 9, authWatchSenders: ['maya@pathwaysgovcon.com', 'evan@pathwaysgovcon.com'] }),
  mod.placementFingerprint({ rows: 18, senders: 9, authWatchSenders: ['evan@pathwaysgovcon.com', 'maya@pathwaysgovcon.com'] })
);
assert(src.includes('SAFE READ-ONLY BATCH'));
assert(src.includes("'--test-id'"));
assert(src.includes('MILES_PLACEMENT_POLL_MS'));
assert(src.includes('MILES_PLACEMENT_MAX_WAIT_MS'));
assert(src.includes('MILES_PLACEMENT_MIN_ANALYTICS_ROWS'));
assert(src.includes('MILES_PLACEMENT_MIN_SENDER_EVIDENCE'));
assert(src.includes('MILES_PLACEMENT_REQUIRED_STABLE_POLLS'));
assert(src.includes('MILES_PLACEMENT_MIN_PLATEAU_ROWS'));
assert(src.includes('MILES_PLACEMENT_REQUIRED_PLATEAU_POLLS'));
assert(src.includes('STABLE_PROVIDER_PLATEAU_BELOW_CONFIGURED_ROW_TARGET'));
assert(src.includes('plateau never overrides AUTH WATCH'));
assert(src.includes('POST_DMARC_PLACEMENT_STABLE_WITH_AUTH_WATCH'));
assert(src.includes('sendsRealProspects: false'));
assert(src.includes('deletesEmail: false'));
assert(src.includes('publishesB12: false'));
assert(src.includes('changesDNS: false'));
assert(src.includes('startsSoak: false'));
assert(!src.includes('CreateControlledInstantlyInboxPlacementTest.js'), 'Sprint must not create another test');
assert(!src.includes('RemediateNamecheapDmarc.js'), 'Sprint must not mutate DNS');

console.log('REVENUE_ACCEPTANCE_SPRINT_SAFETY=PASS');
