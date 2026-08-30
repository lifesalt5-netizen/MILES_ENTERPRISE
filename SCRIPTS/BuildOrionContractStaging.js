'use strict';

const path = require('path');
const OrionContractStagingBuildService = require('../SERVICES/orion/OrionContractStagingBuildService');

function explicitOverridePresent() {
  return process.argv.includes('--explicit-full-clone') && String(process.env.ORION_ALLOW_FULL_CLONE || '').trim().toUpperCase() === 'YES';
}

async function main() {
  if (!explicitOverridePresent()) {
    console.error(JSON.stringify({
      ok: false,
      service: 'ORION_CONTRACT_STAGING_BUILD',
      error: 'DEPRECATED_FULL_DATABASE_CLONE_DISABLED_USE_ORION_CONTRACT_SIDECAR_BUILD',
      safety: { productionDatabaseModified:false, fullCloneAttempted:false }
    }, null, 2));
    process.exitCode = 4;
    return;
  }
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

module.exports = { explicitOverridePresent, main };
