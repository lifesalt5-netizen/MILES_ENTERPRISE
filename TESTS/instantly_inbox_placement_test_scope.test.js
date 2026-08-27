'use strict';

const assert = require('assert');
const { testIdArg, selectTests } = require('../SCRIPTS/AuditInstantlyInboxPlacement');

assert.strictEqual(testIdArg(['--test-id=abc-123']), 'abc-123');
assert.strictEqual(testIdArg(['--test-id', 'xyz-789']), 'xyz-789');
assert.strictEqual(testIdArg([]), '');

const tests = [{ id: 'old' }, { id: 'new' }];
assert.deepStrictEqual(selectTests(tests, ''), tests);
assert.deepStrictEqual(selectTests(tests, 'new'), [{ id: 'new' }]);
assert.deepStrictEqual(selectTests(tests, 'missing'), []);

console.log('INSTANTLY_INBOX_PLACEMENT_TEST_SCOPE=PASS');
