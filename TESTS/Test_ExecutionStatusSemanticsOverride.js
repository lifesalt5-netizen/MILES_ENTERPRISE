'use strict';

const assert = require('assert');
const { normalizeSemanticStatus } = require('../SERVICES/ExecutionStatusSemanticsOverride');

const cases = [
  [{ ok: false, status: 'BLOCKED' }, 'BLOCKED'],
  [{ ok: false, status: 'IN_PROGRESS' }, 'IN_PROGRESS'],
  [{ ok: false, status: 'QUEUED' }, 'QUEUED'],
  [{ ok: false, status: 'RUNNING' }, 'RUNNING'],
  [{ ok: false, status: 'AWAITING_CEO_APPROVAL' }, 'AWAITING_APPROVAL'],
  [{ ok: false, status: 'AWAITING_APPROVAL' }, 'AWAITING_APPROVAL'],
  [{ ok: false, status: 'FAILED' }, 'FAILED'],
  [{ ok: true, status: 'COMPLETED' }, 'COMPLETED'],
  [{ ok: true }, 'COMPLETED'],
  [{ ok: false }, 'FAILED'],
  [{ ok: false, status: 'COMPLETED' }, 'FAILED']
];

for (const [input, expected] of cases) {
  assert.strictEqual(normalizeSemanticStatus(input), expected, JSON.stringify(input));
}

console.log(`EXECUTION_STATUS_SEMANTICS_OVERRIDE_TEST_PASS ${cases.length}/${cases.length}`);
