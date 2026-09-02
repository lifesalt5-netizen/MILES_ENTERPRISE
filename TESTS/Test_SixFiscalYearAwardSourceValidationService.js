'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Service = require('../SERVICES/revenue/SixFiscalYearAwardSourceValidationService');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-sixfy-source-'));
const data = path.join(root, 'DATA', 'revenue_universe');
fs.mkdirSync(data, { recursive: true });
const primeRoot = path.join(root, 'ORION_CORE', 'USA_Spending', 'ALL_YEARS_PRIME');
const subRoot = path.join(root, 'USA_Spending', 'SUBAWARDS');
const backupRoot = path.join(root, 'backup', 'USA_Spending');
fs.mkdirSync(primeRoot, { recursive: true });
fs.mkdirSync(subRoot, { recursive: true });
fs.mkdirSync(backupRoot, { recursive: true });

function write(file, header, row) {
  fs.writeFileSync(file, header + '\n' + row + '\n', 'utf8');
  return { file, extension: '.csv', bytes: fs.statSync(file).size, modifiedAt: fs.statSync(file).mtime.toISOString() };
}

const inventory = {
  ok: true,
  status: 'LOCAL_AWARD_HISTORY_INVENTORY_COMPLETE',
  rootsSearched: [root],
  filesVisited: 20,
  candidateFiles: 20,
  fiscalYears: {},
  unscopedAwardCandidates: []
};
for (const year of [2021,2022,2023,2024,2025,2026]) {
  const primeOld = write(path.join(primeRoot, `FY${year}_All_Contracts_Full_${year}0101.csv`),
    'recipient_uei,recipient_name,federal_action_obligation,action_date_fiscal_year,action_date',
    `UEI${year},Acme ${year},1000,${year},${year}-01-01`);
  const primeNew = write(path.join(primeRoot, `FY${year}_All_Contracts_Full_${year}1231.csv`),
    'recipient_uei,recipient_name,federal_action_obligation,action_date_fiscal_year,action_date',
    `UEI${year},Acme ${year},2000,${year},${year}-12-31`);
  const sub = write(path.join(subRoot, `FY${year}_subawards.csv`),
    'Sub-Recipient UEI,Sub-Recipient Name,Subaward Amount,subaward_action_date_fiscal_year,subaward_action_date',
    `SUB${year},Sub ${year},500,${year},${year}-06-01`);
  const backup = write(path.join(backupRoot, `FY${year}_All_Contracts_Full_${year}1231.csv`),
    'recipient_uei,recipient_name,federal_action_obligation,action_date_fiscal_year,action_date',
    `BAD${year},Backup ${year},9999,${year},${year}-12-31`);
  inventory.fiscalYears[String(year)] = {
    candidateCount: 4,
    candidates: [
      { ...primeOld, yearHints:[year] },
      { ...primeNew, yearHints:[year] },
      { ...sub, yearHints:[year] },
      { ...backup, yearHints:[year] }
    ]
  };
}

const inventoryPath = path.join(data, 'latest_local_award_history_inventory.json');
fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2), 'utf8');
const service = new Service({ rootDir: root, inventoryPath, outputDir: data });
const result = service.run();

assert.strictEqual(result.ok, true);
assert.strictEqual(result.status, 'SIX_FY_LOCAL_SOURCE_VALIDATION_GREEN');
assert.strictEqual(result.readyForSixFiscalYearNormalization, true);
assert.strictEqual(result.missingRequirements.length, 0);
for (const year of [2021,2022,2023,2024,2025,2026]) {
  const y = result.byYear[String(year)];
  assert.strictEqual(y.prime.ready, true);
  assert.strictEqual(y.subcontract.ready, true);
  assert.strictEqual(y.prime.selected.length, 1, 'dated full snapshots must collapse to newest');
  assert(y.prime.selected[0].file.includes(`${year}1231`));
  assert(!y.prime.selected[0].file.toLowerCase().includes('backup'));
  assert.strictEqual(y.subcontract.selected.length, 1);
  assert.strictEqual(y.subcontract.selected[0].schema.identity.hasUeiColumn, true);
}
assert.strictEqual(result.safety.acquisitionTriggered, false);
assert.strictEqual(result.safety.sourceFilesModified, false);

const inspectedPrime = Service.inspectHeader(['recipient_uei','recipient_name','federal_action_obligation','action_date_fiscal_year']);
assert.strictEqual(inspectedPrime.role, 'PRIME');
assert.strictEqual(inspectedPrime.defensibleIdentity, true);
const inspectedSub = Service.inspectHeader(['Sub-Recipient UEI','Sub-Recipient Name','Subaward Amount']);
assert.strictEqual(inspectedSub.role, 'SUB');
assert.strictEqual(inspectedSub.defensibleIdentity, true);

console.log('SIX_FISCAL_YEAR_AWARD_SOURCE_VALIDATION_TEST=GREEN');
