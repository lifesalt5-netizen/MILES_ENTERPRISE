'use strict';

require('dotenv').config();
const IonosAllFolderReconciliationService = require('../SERVICES/revenue/IonosAllFolderReconciliationService');

(async () => {
  const execute = process.argv.includes('--execute');
  const result = await new IonosAllFolderReconciliationService().run({ execute });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 2;
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
