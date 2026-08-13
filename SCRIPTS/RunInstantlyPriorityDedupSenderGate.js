'use strict';

require('dotenv').config();
process.env.MILES_CONTROLLED_WRITE_ENABLED = 'false';
process.env.MILES_DRY_RUN = 'true';
process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'false';

(async () => {
  const service = require('../SERVICES/InstantlyRevenuePriorityDedupSenderCapacityGateService');
  const result = await service.run();
  console.log(JSON.stringify({
    ok: result.ok,
    gate: result.gate,
    totals: result.totals,
    priorityPolicy: result.priorityPolicy,
    candidatePlans: result.candidatePlans,
    senders: result.senders,
    safety: result.safety,
    outputFile: result.outputFile
  }, null, 2));
})().catch(err => {
  console.error(err && (err.stack || err.message) || err);
  process.exitCode = 1;
});
