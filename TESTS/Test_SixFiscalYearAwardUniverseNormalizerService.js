'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Service = require('../SERVICES/revenue/SixFiscalYearAwardUniverseNormalizerService');

class FakeDatabase {
  constructor() { this.keys = new Set(); }
  pragma() {}
  exec() {}
  close() {}
  transaction(fn) { return (...args) => fn(...args); }
  prepare(sql) {
    const db = this;
    if (sql.startsWith('INSERT OR IGNORE INTO award_keys(canonical_key, role, award_id) VALUES')) {
      return { run(key, role, awardId) { db.keys.add(`${key}\t${role}\t${awardId}`); } };
    }
    if (sql.startsWith('INSERT OR IGNORE INTO award_keys(canonical_key, role, award_id) SELECT')) {
      return { run(target, source) {
        for (const value of [...db.keys]) {
          const [key, role, awardId] = value.split('\t');
          if (key === source) db.keys.add(`${target}\t${role}\t${awardId}`);
        }
      } };
    }
    if (sql.startsWith('DELETE FROM award_keys WHERE canonical_key = ?')) {
      return { run(source) {
        for (const value of [...db.keys]) if (value.split('\t')[0] === source) db.keys.delete(value);
      } };
    }
    if (sql.startsWith('SELECT canonical_key, role, COUNT(*) AS c FROM award_keys GROUP BY')) {
      return { iterate() {
        const counts = new Map();
        for (const value of db.keys) {
          const [canonical_key, role] = value.split('\t');
          const key = `${canonical_key}\t${role}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        return [...counts.entries()].map(([key, c]) => {
          const [canonical_key, role] = key.split('\t');
          return { canonical_key, role, c };
        });
      } };
    }
    throw new Error(`UNSUPPORTED_FAKE_SQL:${sql}`);
  }
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-sixfy-normalize-'));
  const out = path.join(root, 'DATA', 'revenue_universe');
  fs.mkdirSync(out, { recursive: true });
  const sourceRoot = path.join(root, 'sources');
  fs.mkdirSync(sourceRoot, { recursive: true });

  function primeFile(year, rows) {
    const file = path.join(sourceRoot, `FY${year}_All_Contracts_Full_${year}1231.csv`);
    const header = 'recipient_uei,recipient_name,recipient_cage_code,company_website,federal_action_obligation,action_date_fiscal_year,action_date,award_id_piid';
    fs.writeFileSync(file, [header, ...rows].join('\n') + '\n', 'utf8');
    return file;
  }
  function subFile(year, rows) {
    const file = path.join(sourceRoot, `FY${year}_subawards.csv`);
    const header = 'Sub-Recipient UEI,Sub-Recipient Name,subawardee_cage_code,company_website,Subaward Amount,subaward_action_date_fiscal_year,subaward_action_date,subaward_id';
    fs.writeFileSync(file, [header, ...rows].join('\n') + '\n', 'utf8');
    return file;
  }

  const validation = { ok:true, status:'SIX_FY_LOCAL_SOURCE_VALIDATION_GREEN', readyForSixFiscalYearNormalization:true, missingRequirements:[], byYear:{} };
  for (const year of [2021,2022,2023,2024,2025,2026]) {
    const pRows = [];
    const sRows = [];
    if (year === 2021) pRows.push('UEI0001,Alpha LLC,CAGE1,alpha.com,100,2021,2021-03-01,P-A1');
    if (year === 2022) {
      // Missing UEI first: this fallback must later merge into the exact UEI record by CAGE.
      pRows.push(',Beta LLC,CAGE2,beta.com,200,2022,2022-04-01,P-B1');
      sRows.push('UEI0001,Alpha LLC,CAGE1,alpha.com,50,2022,2022-05-01,S-A1');
    }
    if (year === 2023) pRows.push('UEI0002,Beta LLC,CAGE2,beta.com,300,2023,2023-06-01,P-B2');
    if (year === 2024) sRows.push(',Gamma LLC,CAGE3,gamma.com,400,2024,2024-07-01,S-G1');
    if (year === 2025) pRows.push('UEI0003,Gamma LLC,CAGE3,gamma.com,500,2025,2025-08-01,P-G1');
    if (year === 2026) {
      pRows.push('UEI0001,Alpha LLC,CAGE1,alpha.com,250,2026,2026-01-01,P-A2');
      sRows.push(',Name Only Co,,,75,2026,2026-02-01,S-N1');
    }
    const pf = primeFile(year, pRows);
    const sf = subFile(year, sRows);
    validation.byYear[String(year)] = {
      prime:{ ready:true, selected:[{file:pf}] },
      subcontract:{ ready:true, selected:[{file:sf}] }
    };
  }

  const master = path.join(root, 'master.csv');
  fs.writeFileSync(master, [
    'uei,company,cage,website',
    'UEI0001,Alpha LLC,CAGE1,alpha.com',
    'UEI0001,Alpha LLC,CAGE1,alpha.com',
    'OTHER001,Other Co,CAGE9,other.com'
  ].join('\n') + '\n', 'utf8');

  const service = new Service({ rootDir:root, outputDir:out, currentMasterPath:master, Database:FakeDatabase });
  const result = await service.run({ sourceValidation:validation });
  assert.strictEqual(result.ok, true, JSON.stringify(result, null, 2));
  assert.strictEqual(result.status, 'SIX_FY_AWARDED_UNIVERSE_NORMALIZED');
  assert.strictEqual(result.metrics.uniqueFy21Fy26PrimeWinners, 3);
  assert.strictEqual(result.metrics.uniqueFy21Fy26SubcontractWinners, 3);
  assert.strictEqual(result.metrics.uniqueAppearingInBoth, 2);
  assert.strictEqual(result.metrics.dedupedAwardedUniverse, 4);
  assert.strictEqual(result.metrics.exactUeiIdentities, 3);
  assert.strictEqual(result.metrics.unresolvedIdentityKeys, 1);
  assert.strictEqual(result.metrics.alreadyRepresentedInCurrent26k, 1);
  assert.strictEqual(result.metrics.missingFromCurrent26k, 3);
  assert.strictEqual(result.acceptance.primeSubRoleArithmeticReconciles, true);
  assert.strictEqual(result.acceptance.everyNormalizedIdentityAccountedInCoverage, true);
  assert.strictEqual(result.safety.emailSent, false);
  assert.strictEqual(result.safety.campaignMutation, false);

  const universe = fs.readFileSync(result.artifacts.contractorCsv, 'utf8');
  assert(universe.includes('UEI0002'));
  assert(universe.includes('UEI0003'));
  assert(universe.includes('UNKNOWN_IDENTITY_KEY'));

  // A source gap must block normalization and expose the exact missing requirement.
  const blockedValidation = JSON.parse(JSON.stringify(validation));
  blockedValidation.readyForSixFiscalYearNormalization = false;
  blockedValidation.missingRequirements = [{year:2021, role:'SUB', blocker:'NO_VALIDATED_LOCAL_SUB_SOURCE_FY2021'}];
  blockedValidation.byYear['2021'].subcontract.ready = false;
  const blocked = await new Service({rootDir:root, outputDir:path.join(root,'blocked'), currentMasterPath:master, Database:FakeDatabase}).run({sourceValidation:blockedValidation});
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.status, 'SIX_FY_SOURCE_GAPS_BLOCK_NORMALIZATION');
  assert.strictEqual(blocked.missingRequirements[0].year, 2021);
  assert.strictEqual(blocked.safety.normalizationPerformed, false);

  console.log('SIX_FISCAL_YEAR_AWARDED_UNIVERSE_NORMALIZER_TEST=GREEN');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
