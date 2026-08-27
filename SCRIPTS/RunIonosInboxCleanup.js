'use strict';

require('dotenv').config();
const path = require('path');
const IonosAllFolderReconciliationService = require('../SERVICES/revenue/IonosAllFolderReconciliationService');

async function main() {
  const root = path.resolve(process.env.MILES_ROOT || process.cwd());
  const execute = process.argv.includes('--execute');
  const service = new IonosAllFolderReconciliationService({ root });
  const result = await service.run({ execute });
  console.log(JSON.stringify(result, null, 2));
  console.log(result.ok
    ? (execute ? 'IONOS_ALL_FOLDER_RECONCILIATION_EXECUTE_GREEN' : 'IONOS_ALL_FOLDER_RECONCILIATION_PLAN_GREEN')
    : (execute ? 'IONOS_ALL_FOLDER_RECONCILIATION_EXECUTE_RED' : 'IONOS_ALL_FOLDER_RECONCILIATION_PLAN_RED'));
  process.exitCode = result.ok ? 0 : 2;
}

if (require.main === module) main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
