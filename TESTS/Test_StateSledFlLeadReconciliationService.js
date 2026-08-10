'use strict';

const assert = require('assert');
const service = require('../SERVICES/StateSledFlLeadReconciliationService');

assert.strictEqual(service.normalizeEmail(' Test@Example.COM '), 'test@example.com');
assert.deepStrictEqual(service.unwrapItems([{ id: 1 }]), [{ id: 1 }]);
assert.deepStrictEqual(service.unwrapItems({ items: [{ id: 2 }] }), [{ id: 2 }]);
assert.deepStrictEqual(service.unwrapItems({ data: [{ id: 3 }] }), [{ id: 3 }]);
assert.deepStrictEqual(service.unwrapItems({}), []);

console.log('STATE_SLED_FL_LEAD_RECONCILIATION_TEST=PASS');
