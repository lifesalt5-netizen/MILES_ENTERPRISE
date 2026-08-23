'use strict';

require('dotenv').config();
const P2GCAuthorityContentProductionService = require('./SERVICES/revenue/P2GCAuthorityContentProductionService');

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function main() {
  const service = new P2GCAuthorityContentProductionService();
  const result = service.produce({ horizonDays: intEnv('P2GC_AUTHORITY_HORIZON_DAYS', 30) });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
