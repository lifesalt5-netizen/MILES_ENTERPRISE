"use strict";

const EnterpriseScheduler = require("./EnterpriseScheduler");
const registerMarketingWorkflow = require("./MarketingWorkflow");

async function main() {
  const scheduler = new EnterpriseScheduler();

  registerMarketingWorkflow(scheduler);

  const results = await scheduler.runAll();

  console.log("[MILES ENTERPRISE] Marketing Scheduled Workflow");
  console.table(results.map(r => ({
    jobName: r.jobName,
    status: r.status,
    durationMs: r.durationMs,
    readySeen: r.result ? r.result.readySeen : "",
    executed: r.result ? r.result.executed : "",
    failed: r.result ? r.result.failed : ""
  })));

  console.log("Recent Scheduler Runs:");
  console.table(scheduler.recentRuns(10));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
