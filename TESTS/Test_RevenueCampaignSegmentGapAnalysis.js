"use strict";

const service = require("../SERVICES/RevenueCampaignSegmentGapService");

(async () => {
  const result = await service.run();

  const ok = Boolean(
    result &&
    result.ok === true &&
    result.gate === "REVENUE_CAMPAIGN_SEGMENT_GAP_ANALYSIS" &&
    result.readOnly === true &&
    result.liveCampaignsMutated === false &&
    result.summary &&
    result.summary.liveCampaigns > 0 &&
    result.summary.segments === 10 &&
    result.summary.totalSegmentLeads > 0 &&
    Array.isArray(result.prioritizedGaps)
  );

  console.log(JSON.stringify({
    ok,
    gate: "REVENUE_CAMPAIGN_SEGMENT_GAP_ANALYSIS",
    summary: result.summary,
    nextAction: result.nextAction,
    prioritizedGaps: result.prioritizedGaps,
    orphanCampaignCount: Array.isArray(result.orphanCampaigns) ? result.orphanCampaigns.length : null,
    outFile: result.outFile
  }, null, 2));

  if (!ok) process.exitCode = 1;
})().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    gate: "REVENUE_CAMPAIGN_SEGMENT_GAP_ANALYSIS",
    error: error.stack || error.message
  }, null, 2));
  process.exitCode = 1;
});
