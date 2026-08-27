'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mod = require('../SCRIPTS/RunRevenueAcceptanceSprint');

const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunRevenueAcceptanceSprint.js'), 'utf8');

assert.strictEqual(mod.DEFAULT_TEST_ID, '01a040ce-dbf7-7872-8938-f1501647af92');
assert(mod.SAFE_AUDITS.length >= 8, 'Expected batched read-only acceptance coverage');
assert(src.includes('SAFE READ-ONLY BATCH'));
assert(src.includes("'--test-id'"));
assert(src.includes('MILES_PLACEMENT_POLL_MS'));
assert(src.includes('MILES_PLACEMENT_MAX_WAIT_MS'));
assert(src.includes('sendsRealProspects: false'));
assert(src.includes('deletesEmail: false'));
assert(src.includes('publishesB12: false'));
assert(src.includes('changesDNS: false'));
assert(src.includes('startsSoak: false'));
assert(!src.includes('CreateControlledInstantlyInboxPlacementTest.js'), 'Sprint must not create another test');
assert(!src.includes('RemediateNamecheapDmarc.js'), 'Sprint must not mutate DNS');

console.log('REVENUE_ACCEPTANCE_SPRINT_SAFETY=PASS');
