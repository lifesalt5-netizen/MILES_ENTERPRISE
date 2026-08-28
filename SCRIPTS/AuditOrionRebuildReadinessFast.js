'use strict';

const fs = require('fs');
const path = require('path');
const OrionRebuildReadinessService = require('../SERVICES/orion/OrionRebuildReadinessService');

function existing(paths) {
  return paths.filter(Boolean).filter(p => {
    try { return fs.existsSync(p); } catch { return false; }
  });
}

(async () => {
  console.log('============================================================');
  console.log('MILES ORION REBUILD READINESS - TARGETED READ ONLY');
  console.log('============================================================');

  try {
    const rootDir = path.resolve(process.env.MILES_ROOT || process.cwd());
    const searchRoots = existing([
      process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads') : null,
      path.join(rootDir, 'DATA', 'orion_refresh'),
      'C:\\P2GC_Intelligence\\Orion Demo 6126',
      'D:\\P2GC_Intelligence\\Orion Demo 6126'
    ]);

    console.log(`Targeted roots: ${searchRoots.length}`);
    for (const root of searchRoots) console.log(`  - ${root}`);

    const result = new OrionRebuildReadinessService({
      rootDir,
      searchRoots,
      dbIntegrityMode: 'SCHEMA_ONLY',
      countRows: false,
      hashCandidates: false
    }).run();
    const s = result.summary || {};
    console.log(`DB inspection profile: ${result.inspection?.dbIntegrityMode || 'UNKNOWN'}`);
    console.log(`Row counts collected: ${Boolean(result.inspection?.rowCountsCollected)}`);
    console.log(`Candidate hashes collected: ${Boolean(result.inspection?.candidateHashesCollected)}`);
    console.log(`Current DB: ${result.current?.path || 'NOT_FOUND'}`);
    console.log(`Current DB readable: ${Boolean(result.current?.ok)}`);
    console.log(`Expected tables missing: ${(result.current?.expectedTablesMissing || []).join(', ') || 'none'}`);
    console.log(`Candidates found: ${s.candidates || 0}`);
    console.log(`Refresh source files found: ${s.sourceFiles || 0}`);
    console.log(`Source files newer than current DB: ${s.newerSourceFiles || 0}`);
    console.log(`Compatible ORION DBs found: ${s.compatibleDatabases || 0}`);
    console.log(`Blockers: ${(s.blockers || []).join(', ') || 'none'}`);
    console.log(`Next step: ${result.reconstructionContract?.nextStep || 'UNKNOWN'}`);
    console.log(`Report: ${path.join(rootDir, 'DATA', 'orion_refresh', 'latest_rebuild_readiness.json')}`);
    console.log('No database or external source was modified by this audit.');
    console.log('Full SQLite integrity validation remains mandatory on staging before any promotion.');
    console.log('RESULT: ORION_REBUILD_READINESS_TARGETED_GREEN');
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    console.log('RESULT: ORION_REBUILD_READINESS_TARGETED_RED');
    process.exitCode = 1;
  }
})();
