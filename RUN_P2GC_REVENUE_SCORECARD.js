'use strict';

const RevenueWeightedCampaignScorecardService = require('./SERVICES/revenue/RevenueWeightedCampaignScorecardService');

async function main() {
  const service = new RevenueWeightedCampaignScorecardService();
  const result = await service.run();
  console.log(JSON.stringify({
    ok: result.ok,
    service: result.service,
    generatedAt: result.generatedAt,
    totals: result.totals,
    topCampaigns: result.campaigns.slice(0, 10).map(row => ({
      rank: row.rank,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      decisionClass: row.decisionClass,
      recommendation: row.recommendation,
      verifiedRevenueUsd: row.verifiedRevenueUsd,
      revenuePer1000Delivered: row.revenuePer1000Delivered,
      qualifiedReplyCount: row.qualifiedReplyCount,
      meetingBookedCount: row.meetingBookedCount,
      meetingHeldCount: row.meetingHeldCount,
      proposalCount: row.proposalCount,
      wonCount: row.wonCount
    })),
    outputJson: result.outputJson,
    outputCsv: result.outputCsv
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
