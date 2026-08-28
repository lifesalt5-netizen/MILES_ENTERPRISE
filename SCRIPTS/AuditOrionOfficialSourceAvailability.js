'use strict';

require('dotenv').config();
const path = require('path');
const OrionOfficialSourceAvailabilityService = require('../SERVICES/orion/OrionOfficialSourceAvailabilityService');

async function main() {
  const rootDir = path.resolve(process.env.MILES_ROOT || process.cwd());
  console.log('============================================================');
  console.log('MILES ORION OFFICIAL SOURCE AVAILABILITY - LIVE READ ONLY');
  console.log('============================================================');

  const result = await new OrionOfficialSourceAvailabilityService({ rootDir }).run();
  console.log(`Fiscal year: FY${result.fiscalYear}`);
  console.log(`Files returned: ${result.summary.filesReturned}`);
  console.log(`Official files: ${result.summary.officialFiles}`);
  console.log(`Current ORION DB: ${result.currentDb.path || 'UNKNOWN'}`);
  console.log(`Current ORION DB mtime: ${result.currentDb.mtime || 'UNKNOWN'}`);

  for (const [kind, row] of Object.entries(result.selected || {})) {
    console.log(`${kind.toUpperCase()}: ${row ? `${row.file_name} | updated=${row.updated_date} | host=${new URL(row.url).hostname}` : 'NOT FOUND'}`);
  }

  console.log(`Official source newer than current DB: ${result.summary.sourceNewerThanCurrentDb}`);
  console.log(`Blockers: ${result.summary.blockers.length ? result.summary.blockers.join(', ') : 'NONE'}`);
  console.log(`Conclusion: ${result.conclusion}`);
  console.log(`Scope: ${result.scopeBoundary.sourceFamily}`);
  console.log(`Proves full ORION freshness: ${result.scopeBoundary.provesFullOrionFreshness}`);
  console.log('No files downloaded. Active ORION database not modified. Provider not mutated.');
  console.log(`Report: ${result.outputPath || path.join(rootDir, 'DATA', 'orion_refresh', 'latest_official_source_availability.json')}`);
  console.log(`RESULT: ${result.ok ? 'ORION_OFFICIAL_SOURCE_AVAILABILITY_GREEN' : 'ORION_OFFICIAL_SOURCE_AVAILABILITY_RED'}`);

  if (!result.ok) process.exitCode = 2;
}

main().catch(error => {
  console.error(error.stack || error.message);
  console.log('RESULT: ORION_OFFICIAL_SOURCE_AVAILABILITY_RED');
  process.exitCode = 1;
});
