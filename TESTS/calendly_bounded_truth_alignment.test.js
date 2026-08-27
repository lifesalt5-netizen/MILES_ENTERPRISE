'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'AUDIT_MILES_CALENDLY_PIPELINE.js'), 'utf8');

assert(src.includes('MILES_CALENDLY_ACCEPTANCE_LOOKBACK_DAYS'));
assert(src.includes('MILES_CALENDLY_ACCEPTANCE_LOOKAHEAD_DAYS'));
assert(src.includes('minStartTime,'));
assert(src.includes('maxStartTime,'));
assert(src.includes("NO_P2GC_BOOKINGS_IN_BOUNDED_REVENUE_WINDOW"));
assert(src.includes("purpose: 'BOUNDED_REVENUE_PIPELINE_TRUTH'"));
assert(src.includes('historical bookings outside the revenue window cannot be mislabeled as current pipeline evidence'));
assert(src.includes('External writes performed: False'));
assert(!src.includes('sendReply'));
assert(!src.includes('publishB12'));

console.log('CALENDLY_BOUNDED_TRUTH_ALIGNMENT=PASS');
