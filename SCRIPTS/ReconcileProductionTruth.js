'use strict';

const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.env.MILES_ROOT || path.resolve(__dirname, '..'));
process.env.MILES_ROOT = ROOT;

const ProductionTruthReconciliationService = require('../SERVICES/ProductionTruthReconciliationService');

async function main() {
  console.log('============================================================');
  console.log('MILES PRODUCTION TRUTH RECONCILIATION');
  console.log('============================================================');
  console.log(`Root: ${ROOT}`);

  const service = new ProductionTruthReconciliationService({ rootDir: ROOT });
  const result = await service.run({ auditOrion: true });

  const queue = result.workQueue || {};
  const repo = result.registry?.repository || {};
  const cap = result.registry?.capability || {};
  const freshness = result.orion?.databaseFreshness || {};

  console.log(`Work queue closed archived: ${queue.archival?.archived ?? 0}`);
  console.log(`Work queue open after: ${queue.after?.open ?? 'UNKNOWN'}`);
  console.log(`Work queue failed after: ${queue.after?.failed ?? 'UNKNOWN'}`);
  console.log(`Work queue approval escalations after: ${queue.after?.escalations ?? 'UNKNOWN'}`);
  console.log(`Repository active duplicate risks: ${repo.statistics?.duplicateRisks ?? 'UNKNOWN'}`);
  console.log(`Repository active orphan risks: ${repo.statistics?.orphanRisks ?? 'UNKNOWN'}`);
  console.log(`Repository health: ${repo.health?.score ?? 'UNKNOWN'} / ${repo.health?.status ?? 'UNKNOWN'}`);
  console.log(`Capability gaps: ${cap.statistics?.gaps ?? 'UNKNOWN'}`);
  console.log(`Capability autonomy: ${cap.autonomy?.score ?? 'UNKNOWN'} / ${cap.autonomy?.status ?? 'UNKNOWN'}`);
  console.log(`Company health: ${result.companyState?.health?.score ?? 'UNKNOWN'} / ${result.companyState?.health?.status ?? 'UNKNOWN'}`);
  console.log(`ORION audit status: ${result.orion?.status ?? 'NOT_RUN'}`);
  console.log(`ORION database age hours: ${freshness.ageHours ?? 'UNKNOWN'}`);
  console.log(`ORION database stale: ${freshness.stale ?? 'UNKNOWN'}`);

  if (freshness.stale === true) {
    console.log('ORION_DATASET_REFRESH_REQUIRED=YES');
    console.log('The audit did not falsify freshness. A real source/dataset refresh is still required.');
  } else if (freshness.stale === false) {
    console.log('ORION_DATASET_REFRESH_REQUIRED=NO');
  }

  console.log(`RESULT: ${result.ok ? 'PRODUCTION_TRUTH_RECONCILIATION_GREEN' : 'PRODUCTION_TRUTH_RECONCILIATION_RED'}`);
  process.exitCode = result.ok ? 0 : 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
