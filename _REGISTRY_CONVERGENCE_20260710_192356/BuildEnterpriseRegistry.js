'use strict';

const path = require('path');
const EnterpriseComponentRegistryService = require('./SERVICES/registry/EnterpriseComponentRegistryService');
const EnterpriseCapabilityRegistryService = require('./SERVICES/registry/EnterpriseCapabilityRegistryService');

async function main() {
  const rootDir = process.env.MILES_ROOT
    ? path.resolve(process.env.MILES_ROOT)
    : __dirname;

  console.log('============================================================');
  console.log('MILES ENTERPRISE REGISTRY BUILD');
  console.log('============================================================');
  console.log(`Root: ${rootDir}`);

  const componentRegistry = new EnterpriseComponentRegistryService({ rootDir });
  const componentResult = componentRegistry.scan();

  console.log('');
  console.log('Component Registry');
  console.log(`- Components: ${componentResult.componentCount}`);
  console.log(`- Supported actions discovered: ${componentResult.supportedActionCount}`);
  console.log(`- Added: ${componentResult.changes.added.length}`);
  console.log(`- Changed: ${componentResult.changes.changed.length}`);
  console.log(`- Removed: ${componentResult.changes.removed.length}`);

  const capabilityRegistry = new EnterpriseCapabilityRegistryService({ rootDir });
  const capabilityResult = capabilityRegistry.build();

  console.log('');
  console.log('Capability Registry');
  console.log(`- Capabilities: ${capabilityResult.capabilityCount}`);
  console.log(`- Provider assignments: ${capabilityResult.providerAssignmentCount}`);
  console.log(`- High risk: ${capabilityResult.highRiskCapabilityCount}`);
  console.log(`- Medium risk: ${capabilityResult.mediumRiskCapabilityCount}`);
  console.log(`- Low risk: ${capabilityResult.lowRiskCapabilityCount}`);

  console.log('');
  console.log('Registry output:');
  console.log(path.join(rootDir, 'runtime', 'enterprise_registry'));
  console.log('');
  console.log('STATUS: ENTERPRISE REGISTRY READY');
}

main().catch(error => {
  console.error('ENTERPRISE REGISTRY BUILD FAILED');
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
