'use strict';

require('dotenv').config();
const path = require('path');
const IonosSpamRescueService = require('../SERVICES/revenue/IonosSpamRescueService');

async function main() {
  const root = path.resolve(process.env.MILES_ROOT || process.cwd());
  const execute = process.argv.includes('--execute');
  const result = await new IonosSpamRescueService({ root }).run({ execute });
  console.log(JSON.stringify(result, null, 2));
  console.log(result.ok
    ? (execute ? 'IONOS_SPAM_RESCUE_EXECUTE_GREEN' : 'IONOS_SPAM_RESCUE_PLAN_GREEN')
    : (execute ? 'IONOS_SPAM_RESCUE_EXECUTE_RED' : 'IONOS_SPAM_RESCUE_PLAN_RED'));
  process.exitCode = result.ok ? 0 : 2;
}

if (require.main === module) main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
