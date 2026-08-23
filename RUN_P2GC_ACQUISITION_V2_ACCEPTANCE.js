'use strict';

require('dotenv').config();
const P2GCAcquisitionV2AcceptanceService = require('./SERVICES/revenue/P2GCAcquisitionV2AcceptanceService');

function main() {
  const service = new P2GCAcquisitionV2AcceptanceService();
  const result = service.run();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
