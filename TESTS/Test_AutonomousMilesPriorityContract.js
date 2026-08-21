'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const text = fs.readFileSync(path.join(__dirname, '..', 'AUTONOMOUS_MILES_PRIORITY.md'), 'utf8');
assert(text.includes('qualified lead -> verification/suppression -> campaign ownership -> governed Instantly execution -> reply intelligence -> qualified follow-up -> CRM/pipeline -> Calendly/meeting -> next revenue action'));
assert(text.includes('MONICA and new source discovery remain subordinate/parallel'));
assert(text.includes('without manual queue editing or PowerShell intervention'));
console.log('AUTONOMOUS_MILES_PRIORITY_CONTRACT_TEST=PASS');
