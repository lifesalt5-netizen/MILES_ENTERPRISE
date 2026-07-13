"use strict";

const EnterpriseSchedulerLoader = require("./EnterpriseSchedulerLoader");

async function main() {
  const loader = new EnterpriseSchedulerLoader();
  const result = await loader.runEnabledJobs();

  console.log("[MILES ENTERPRISE] Data-Driven Scheduler Run");

  console.log("Loaded Jobs:");
  console.table(result.loaded);

  console.log("Run Results:");
  console.table(result.results.map(r => ({
    jobName: r.jobName,
    status: r.status,
    durationMs: r.durationMs,
    error: r.error || null
  })));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
