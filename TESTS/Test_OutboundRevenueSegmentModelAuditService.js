'use strict';

const assert = require('assert');
const service = require('../SERVICES/revenue/OutboundRevenueSegmentModelAuditService');

const scored = service.scoreHint(
  { name: 'GSA No Sales', sourceHints: ['GSA NO SALES'] },
  { name: 'GSA_NO_SALES', file: 'D:\\leads\\GSA_NO_SALES.csv', rows: 100 }
);
assert.ok(scored.score >= 0.8);

const resolved = service.resolveSegment(
  {
    id: 'state_sled_fl',
    name: 'STATE SLED - FL',
    universe: 'SLED',
    group: 'SLED_STATE',
    assignmentPriority: 900,
    sourceHints: ['STATE SLED FL', 'FLORIDA']
  },
  [
    { name: 'STATE_SLED_FL_VERIFIED', file: 'D:\\STATE_SLED\\FLORIDA.csv', rows: 500 },
    { name: 'STATE_SLED_TX_VERIFIED', file: 'D:\\STATE_SLED\\TEXAS.csv', rows: 600 }
  ]
);
assert.strictEqual(resolved.segment, 'STATE SLED - FL');
assert.strictEqual(resolved.sourceRowsNonUnique, 500);
assert.notStrictEqual(resolved.mappingStatus, 'UNRESOLVED');

const result = service.run();
assert.strictEqual(result.gate, 'OUTBOUND_REVENUE_SEGMENT_MODEL_AUDIT');
assert.ok(result.counts.activeSegments >= 25);
assert.ok(result.counts.federalSegments >= 20);
assert.strictEqual(result.counts.sledSegments, 5);
assert.strictEqual(result.sendingGovernance.timezone, 'America/New_York');
assert.strictEqual(result.sendingGovernance.start, '08:00');
assert.strictEqual(result.sendingGovernance.stop, '18:00');
assert.ok(result.outputs.federalMappingCandidates.endsWith('FED_SEGMENT_MAPPING_CANDIDATES.csv'));
assert.ok(result.outputs.sledMappingCandidates.endsWith('SLED_SEGMENT_MAPPING_CANDIDATES.csv'));

console.log('OUTBOUND_REVENUE_SEGMENT_MODEL_AUDIT_TEST=PASS');
