'use strict';

const B12HistoricalUniverseDiscoveryService = require('../SERVICES/revenue/B12HistoricalUniverseDiscoveryService');

function main() {
  const result = new B12HistoricalUniverseDiscoveryService().discover();
  const compact = {
    ok: result.ok === true,
    status: result.status,
    service: result.service,
    mode: result.mode,
    historicalWindow: result.historicalWindow,
    scope: result.scope,
    registry: result.registry,
    inventory: result.inventory,
    duplicateArtifactHashGroups: result.duplicateArtifacts?.length || 0,
    errors: (result.errors || []).slice(0, 25),
    nextGate: result.nextGate,
    outputs: result.outputs,
    safety: result.safety
  };
  console.log('MILES_B12_HISTORICAL_UNIVERSE_DISCOVERY_COMPACT');
  console.log(JSON.stringify(compact, null, 2));
  if (compact.ok !== true) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error('MILES_B12_HISTORICAL_UNIVERSE_DISCOVERY_FAILED');
  console.error(error.stack || error.message);
  process.exitCode = 2;
}
