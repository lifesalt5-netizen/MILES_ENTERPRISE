'use strict';
const path = require('path');
const OrionContractSidecarBuildService = require('../SERVICES/orion/OrionContractSidecarBuildService');
async function main() {
  const rootDir = path.resolve(process.argv[2] || process.env.MILES_ROOT || path.resolve(__dirname,'..'));
  const result = await new OrionContractSidecarBuildService({ rootDir }).run();
  process.exitCode = result.ok ? 0 : 2;
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ok:false,service:'ORION_CONTRACT_SIDECAR_BUILD',error:error.message,stack:error.stack},null,2)); process.exitCode=2; });
