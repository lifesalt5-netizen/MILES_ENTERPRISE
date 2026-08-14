'use strict';

const assert = require('assert');
const audit = require('../SERVICES/revenue/LeadSupplyChainAuditService');

assert.strictEqual(audit.health(5000), 'HEALTHY');
assert.strictEqual(audit.health(2500), 'MODERATE');
assert.strictEqual(audit.health(1000), 'REPLENISH');
assert.strictEqual(audit.health(500), 'HIGH_PRIORITY');
assert.strictEqual(audit.health(100), 'CRITICAL');
assert.strictEqual(audit.health(99), 'EMERGENCY');

const unique = audit.uniqueSourceSummary([
  { file: 'a.csv', exactRows: 100, name: 'A' },
  { file: 'a.csv', exactRows: 90, name: 'A older' },
  { file: 'b.csv', estimatedRows: 50, name: 'B' }
]);
assert.strictEqual(unique.length, 2);
assert.strictEqual(unique[0].rows, 100);
assert.strictEqual(unique[1].rows, 50);

const result = audit.run();
assert.strictEqual(result.gate, 'P0_LEAD_SUPPLY_CHAIN_AUDIT');
assert.ok(Array.isArray(result.defects));
assert.ok(result.sourceRegistry.registeredEntries > 0);
assert.ok(result.sourceRegistry.nonUniqueRowSum > 0);
assert.ok(result.canonicalRegistry.mappedSegments > 0);

console.log('LEAD_SUPPLY_CHAIN_AUDIT_SERVICE_TEST=PASS');
