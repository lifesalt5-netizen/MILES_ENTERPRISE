'use strict';

require('dotenv').config();

async function main() {
  process.env.MILES_CONTROLLED_WRITE_ENABLED = 'false';
  process.env.MILES_DRY_RUN = 'true';
  process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'false';

  const master = require('../SERVICES/MasterInstantlyRevenueReconciliationService');
  const gap = require('../SERVICES/RevenueCampaignSegmentGapService');

  const masterResult = await master.run();
  const gapResult = await gap.run();

  const output = {
    ok: Boolean(masterResult?.ok && gapResult?.ok),
    mode: 'READ_ONLY',
    liveCampaignsMutated: false,
    master: {
      totals: masterResult?.totals || {},
      byStatus: masterResult?.byStatus || {},
      byFamily: masterResult?.byFamily || {},
      outputFile: masterResult?.outputFile || null,
      csvFile: masterResult?.csvFile || null
    },
    gap: {
      summary: gapResult?.summary || {},
      prioritizedGaps: gapResult?.prioritizedGaps || [],
      orphanCampaigns: gapResult?.orphanCampaigns || [],
      nextAction: gapResult?.nextAction || null,
      outFile: gapResult?.outFile || null
    }
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
