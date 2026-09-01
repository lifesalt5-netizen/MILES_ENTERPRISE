'use strict';

const Fy2026AwardedUniverseCoverageService = require('../SERVICES/revenue/Fy2026AwardedUniverseCoverageService');

async function main() {
  const result = await new Fy2026AwardedUniverseCoverageService().run();
  const compact = {
    ok: result?.ok === true,
    status: result?.status || null,
    generatedAt: result?.generatedAt || null,
    scope: result?.scope || null,
    currentMaster: result?.currentMaster || null,
    awardedUniverse: result?.awardedUniverse || null,
    sourceIntegrity: result?.sourceIntegrity || null,
    exactness: result?.exactness || null,
    safety: result?.safety || null,
    artifacts: result?.artifacts || null,
    error: result?.error || null
  };
  console.log('MILES_FY2026_AWARDED_UNIVERSE_COVERAGE_COMPACT');
  console.log(JSON.stringify(compact, null, 2));
  if (compact.ok !== true) process.exitCode = 2;
}

main().catch(error => {
  console.error('MILES_FY2026_AWARDED_UNIVERSE_COVERAGE_FAILED');
  console.error(error.stack || error.message);
  process.exitCode = 2;
});
