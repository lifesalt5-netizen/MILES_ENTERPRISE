'use strict';

require('dotenv').config();
const InstantlyLifecycleProofService = require('../SERVICES/revenue/InstantlyLifecycleProofService');

(async () => {
  const execute = process.argv.includes('--execute');
  const result = await new InstantlyLifecycleProofService().run({ execute });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 2;
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
