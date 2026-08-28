'use strict';

const path = require('path');
const fs = require('fs');
const { OrionOfficialSourceAvailabilityService } = require('../SERVICES/orion/OrionOfficialSourceAvailabilityService');

async function main() {
  const rootDir = path.resolve(process.env.MILES_ROOT || process.cwd());
  const service = new OrionOfficialSourceAvailabilityService({ rootDir });
  const result = await service.run();

  const outDir = path.join(rootDir, 'DATA', 'orion_refresh');
  const outFile = path.join(outDir, 'latest_official_source_availability.json');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');

  console.log('============================================================');
  console.log('MILES ORION OFFICIAL SOURCE AVAILABILITY - READ ONLY');
  console.log('============================================================');
  console.log(`Source: ${result.source?.name || 'USAspending.gov'}`);
  console.log(`FY: ${result.fiscalYear}`);
  console.log(`Files returned: ${result.files?.length || 0}`);
  console.log(`Latest official updated date: ${result.latestOfficialUpdatedDate || 'NONE'}`);
  console.log(`Current ORION modified: ${result.currentOrionModifiedAt || 'UNKNOWN'}`);
  console.log(`Official source newer than ORION: ${result.officialSourceNewerThanOrion ? 'YES' : 'NO'}`);
  console.log(`Downloads performed: ${result.safety?.downloadsPerformed ? 'YES' : 'NO'}`);
  console.log(`Whole ORION freshness claimed: ${result.safety?.wholeOrionFreshnessClaimed ? 'YES' : 'NO'}`);
  console.log(`Next step: ${result.nextStep}`);
  console.log(`Report: ${outFile}`);
  console.log(`RESULT: ${result.ok ? 'ORION_OFFICIAL_SOURCE_AVAILABILITY_GREEN' : 'ORION_OFFICIAL_SOURCE_AVAILABILITY_RED'}`);

  process.exitCode = result.ok ? 0 : 2;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 2;
});
