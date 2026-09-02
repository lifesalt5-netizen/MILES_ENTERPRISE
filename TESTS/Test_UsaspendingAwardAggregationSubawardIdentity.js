'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const UsaspendingAwardAggregationService = require('../SERVICES/orion/UsaspendingAwardAggregationService');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-usaspending-subagg-'));
  const file = path.join(root, 'subawards.csv');
  fs.writeFileSync(file, [
    'Sub-Recipient UEI,Subaward Amount,Subaward ID,Prime Award ID,Awarding Agency',
    'SUBUEI001,125000,SUB-1,PRIME-1,DEPARTMENT OF DEFENSE',
    'SUBUEI002,75000,SUB-2,PRIME-2,DEPARTMENT OF ENERGY'
  ].join('\n'), 'utf8');

  const service = new UsaspendingAwardAggregationService({ rootDir: root });
  const totals = new Map();
  const agencies = new Map();
  const counters = { rows: 0, primeAwardRows: 0, subawardRows: 0, rowsWithoutUei: 0 };
  await service.aggregateCsv(file, totals, agencies, counters);

  assert.strictEqual(counters.rows, 2);
  assert.strictEqual(counters.subawardRows, 2);
  assert.strictEqual(counters.primeAwardRows, 0);
  assert.strictEqual(counters.rowsWithoutUei, 0);
  assert.strictEqual(totals.size, 2);
  assert.strictEqual(totals.get('SUBUEI001').subawardObligations, 125000);
  assert.strictEqual(totals.get('SUBUEI001').primeFederalObligations, 0);
  assert.strictEqual(totals.get('SUBUEI002').subawardObligations, 75000);

  const aliases = UsaspendingAwardAggregationService.recipientUeiAliases('SUBAWARD');
  assert(aliases.includes('sub_recipient_uei'));
  assert(aliases.includes('Sub-Recipient UEI'));
  assert(aliases.includes('subawardee_uei'));

  console.log('USASPENDING_SUBAWARD_IDENTITY_AGGREGATION: GREEN');
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
