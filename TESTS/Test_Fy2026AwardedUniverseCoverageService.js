'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Fy2026AwardedUniverseCoverageService = require('../SERVICES/revenue/Fy2026AwardedUniverseCoverageService');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-fy2026-awards-'));
  fs.mkdirSync(path.join(root, 'DATA', 'orion_refresh'), { recursive: true });
  fs.mkdirSync(path.join(root, 'DATA', 'revenue_universe'), { recursive: true });
  fs.mkdirSync(path.join(root, 'DATA', 'staging', 'government_data', 'usaspending_aggregation', 'fake', 'extracted'), { recursive: true });
  const sidecar = path.join(root, 'sidecar.db');
  fs.writeFileSync(sidecar, 'fake');
  fs.writeFileSync(path.join(root, 'master.csv'), 'fake');
  fs.writeFileSync(path.join(root, 'DATA', 'orion_refresh', 'latest_contract_sidecar_build.json'), JSON.stringify({
    ok: true,
    sidecarDb: sidecar,
    source: { updatedDate: null, archive: 'FY2026_All_Contracts_Full_20260831.zip' },
    validation: { ok: true, summaryRows: 3 },
    safety: { productionDatabaseModified: false, sidecarOnly: true }
  }));
  return root;
}

class FakeDatabase {
  constructor() {}
  prepare(sql) {
    if (sql.includes("sqlite_master")) return { get: () => ({ name: 'orion_contractor_fy2026_summary' }) };
    if (sql.includes('FROM orion_contractor_fy2026_summary')) return { all: () => [{ uei: 'A' }, { uei: 'B' }, { uei: 'C' }] };
    if (sql.includes('FROM orion_source_refresh_manifest')) return { all: () => [{ source_family: 'USAspending', source_scope: 'FY2026', source_updated_date: null, source_archive: 'FY2026_All_Contracts_Full_20260831.zip', contractor_summary_rows: 3, imported_at: '2026-09-01T00:00:00Z' }] };
    throw new Error(`UNEXPECTED_SQL:${sql}`);
  }
  close() {}
}

function makeCoverageFactory(root, subawardRows = 2) {
  return () => ({
    resolveMasterFile: () => path.join(root, 'master.csv'),
    buildMasterIdentityIndex: () => ({ rows: [{}, {}, {}, {}], uei: new Set(['B', 'C']), names: new Set() }),
    collectIdentitySets: async () => ({
      prime: new Map(),
      sub: new Map([
        ['UEI:B', { uei: 'B', name: 'B CO' }],
        ['UEI:D', { uei: 'D', name: 'D CO' }]
      ]),
      counters: {
        primeAwardRows: 0,
        subawardRows,
        rowsWithoutCanonicalIdentity: 0,
        primeRowsWithoutCanonicalIdentity: 0,
        subawardRowsWithoutCanonicalIdentity: 0
      }
    })
  });
}

async function run() {
  const root = makeRoot();
  const aggregationReport = path.join(root, 'DATA', 'staging', 'government_data', 'usaspending_aggregation', 'fake', 'aggregation_report.json');
  fs.writeFileSync(aggregationReport, '{}');
  const common = {
    rootDir: root,
    Database: FakeDatabase,
    stagingFactory: () => ({ refresh: async () => ({ manifestPath: path.join(root, 'subaward-manifest.json') }) }),
    aggregationFactory: () => ({ run: async () => ({ ok: true, reportPath: aggregationReport, aggregatePath: path.join(root, 'aggregate.jsonl') }) })
  };

  const green = await new Fy2026AwardedUniverseCoverageService({ ...common, coverageFactory: makeCoverageFactory(root, 2) }).run();
  assert.strictEqual(green.ok, true);
  assert.strictEqual(green.scope.endDate, '2026-08-31');
  assert.strictEqual(green.scope.primeSourceDateAuthority.authority, 'VALIDATED_SOURCE_ARCHIVE_FILENAME_DATE');
  assert.strictEqual(green.awardedUniverse.exactUniquePrimeAwardedUeis, 3);
  assert.strictEqual(green.awardedUniverse.exactUniqueSubcontractAwardedUeis, 2);
  assert.strictEqual(green.awardedUniverse.exactPrimeAndSubUeiOverlap, 1);
  assert.strictEqual(green.awardedUniverse.exactUniqueAwardedUeisEitherRole, 4);
  assert.strictEqual(green.awardedUniverse.exactAwardedUeisInCurrentMaster, 2);
  assert.strictEqual(green.awardedUniverse.exactAwardedUeisMissingFromCurrentMaster, 2);
  assert.strictEqual(green.awardedUniverse.currentMasterCoveragePercentOfAwardedUniverse, 50);

  const capped = await new Fy2026AwardedUniverseCoverageService({ ...common, coverageFactory: makeCoverageFactory(root, 500000) }).run();
  assert.strictEqual(capped.ok, false);
  assert.match(capped.error, /SUBAWARD_SOURCE_REACHED_500K_CAP/);

  console.log('FY2026_AWARDED_UNIVERSE_COVERAGE_TEST: GREEN');
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
