'use strict';

const path = require('path');
const OrionContractStagingBuildService = require('../SERVICES/orion/OrionContractStagingBuildService');

async function main() {
  const rootDir = path.resolve(process.argv[2] || process.env.MILES_ROOT || path.resolve(__dirname, '..'));
  const service = new OrionContractStagingBuildService({ rootDir });
  const result = await service.run();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ ok:false, service:'ORION_CONTRACT_STAGING_BUILD', error:error.message, stack:error.stack }, null, 2));
    process.exitCode = 2;
  });
}
