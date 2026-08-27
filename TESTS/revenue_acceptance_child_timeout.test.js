'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sprint = require('../SCRIPTS/RunRevenueAcceptanceSprint');

assert(sprint.AUDIT_TIMEOUT_MS > 0);
assert.strictEqual(typeof sprint.runNode, 'function');

const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunRevenueAcceptanceSprint.js'), 'utf8');
assert(src.includes('MILES_REVENUE_AUDIT_TIMEOUT_MS'));
assert(src.includes('AUDIT_TIMEOUT_AFTER_'));
assert(src.includes('timedOutAuditCount'));
assert(src.includes("finish(124, { timeoutMs })"));
assert(src.includes("child.kill('SIGTERM')"));
assert(src.includes("child.kill('SIGKILL')"));

console.log('REVENUE_ACCEPTANCE_CHILD_TIMEOUT=PASS');
