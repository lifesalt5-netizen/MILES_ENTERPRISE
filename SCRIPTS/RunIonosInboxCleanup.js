'use strict';

require('dotenv').config();
const path = require('path');
const IonosInboxCleanupService = require('../SERVICES/revenue/IonosInboxCleanupService');

async function main() {
  const root = path.resolve(process.env.MILES_ROOT || process.cwd());
  const execute = process.argv.includes('--execute');
  const service = new IonosInboxCleanupService({ root });
  const result = await service.run({ execute });
  console.log(JSON.stringify(result, null, 2));
  console.log(result.ok
    ? (execute ? 'IONOS_INBOX_CLEANUP_EXECUTE_GREEN' : 'IONOS_INBOX_CLEANUP_PLAN_GREEN')
    : (execute ? 'IONOS_INBOX_CLEANUP_EXECUTE_RED' : 'IONOS_INBOX_CLEANUP_PLAN_RED'));
  process.exitCode = result.ok ? 0 : 2;
}

if (require.main === module) main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
