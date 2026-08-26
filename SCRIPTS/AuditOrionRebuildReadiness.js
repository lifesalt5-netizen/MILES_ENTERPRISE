'use strict';

const path = require('path');
const OrionRebuildReadinessService = require('../SERVICES/orion/OrionRebuildReadinessService');

(async () => {
  console.log('============================================================');
  console.log('MILES ORION REBUILD READINESS - READ ONLY');
  console.log('============================================================');

  try {
    const rootDir = path.resolve(process.env.MILES_ROOT || process.cwd());
    const result = new OrionRebuildReadinessService({ rootDir }).run();
    const s = result.summary || {};
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
    console.log('RESULT: ORION_REBUILD_READINESS_GREEN');
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    console.log('RESULT: ORION_REBUILD_READINESS_RED');
    process.exitCode = 1;
  }
})();
