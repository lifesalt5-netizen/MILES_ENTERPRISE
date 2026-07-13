"use strict";

const CampaignMonitoringEngine = require("./CampaignMonitoringEngine");

function main() {
  const engine = new CampaignMonitoringEngine();
  const results = engine.run();

  console.log("[MILES ENTERPRISE] Campaign Monitoring complete");
  console.table(results.map(r => ({
    campaign: r.campaignName,
    status: r.status,
    queue: r.uploadQueueItems,
    pending: r.pendingApproval,
    ready: r.readyForUpload,
    executed: r.executed,
    failed: r.failed
  })));
}

main();
