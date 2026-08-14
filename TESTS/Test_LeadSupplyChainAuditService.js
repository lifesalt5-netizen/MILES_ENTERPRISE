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

assert.strictEqual(
  audit.classifyUniverse({ name: 'P2GC_SEGMENT_IT_SERVICES', category: 'SAM', file: 'D:\\SAM_Registry\\it.csv' }),
  'FEDERAL'
);
assert.strictEqual(
  audit.classifyUniverse({ name: 'STATE SLED - FL', category: 'SEGMENT', file: 'D:\\STATE_SLED\\fl.csv' }),
  'SLED'
);

assert.ok(audit.overlapScore('GSA No Sales', 'GSA_NO_SALES.csv') > 0.9);

const resolution = audit.resolveInventorySource(
  { segmentName: 'GSA No Sales', companyCount: 10 },
  { segments: {} },
  [
    { name: 'GSA_NO_SALES', file: 'D:\\GSA_NO_SALES.csv', rows: 22775 },
    { name: 'SAM_NO_SALES', file: 'D:\\SAM_NO_SALES.csv', rows: 20000 }
  ]
);
assert.strictEqual(resolution.sourceRows, 22775);
assert.strictEqual(resolution.resolution, 'HIGH_CONFIDENCE');

const result = audit.run();
assert.strictEqual(result.gate, 'P0_LEAD_SUPPLY_CHAIN_AUDIT');
assert.ok(Array.isArray(result.defects));
assert.ok(result.sourceRegistry.registeredEntries > 0);
assert.ok(result.sourceRegistry.nonUniqueRowSum > 0);
assert.ok(result.canonicalRegistry.mappedSegments > 0);
assert.ok(result.outputs.federalSourceInventory.endsWith('FED_SOURCE_INVENTORY.csv'));
assert.ok(result.outputs.sledSourceInventory.endsWith('SLED_SOURCE_INVENTORY.csv'));
assert.ok(result.outputs.outboundSegmentSourceResolution.endsWith('OUTBOUND_SEGMENT_SOURCE_RESOLUTION.csv'));

console.log('LEAD_SUPPLY_CHAIN_AUDIT_SERVICE_TEST=PASS');
