'use strict';

require('dotenv').config();
const LinkedInProspectAssistService = require('./SERVICES/revenue/LinkedInProspectAssistService');

async function main() {
  const service = new LinkedInProspectAssistService();
  const result = await service.run();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
