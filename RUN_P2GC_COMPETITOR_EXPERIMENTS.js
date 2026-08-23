'use strict';

require('dotenv').config();
const P2GCCompetitorExperimentService = require('./SERVICES/revenue/P2GCCompetitorExperimentService');

function main() {
  const service = new P2GCCompetitorExperimentService();
  const result = service.run();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
