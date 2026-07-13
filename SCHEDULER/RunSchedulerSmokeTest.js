"use strict";

const EnterpriseScheduler = require("./EnterpriseScheduler");

async function main() {
  const scheduler = new EnterpriseScheduler();

  scheduler.register("scheduler_smoke_test", async () => {
    return {
      ok: true,
      message: "Enterprise Scheduler core is operational.",
      checkedAt: new Date().toISOString()
    };
  });

  const result = await scheduler.runJob("scheduler_smoke_test");

  console.log("[MILES ENTERPRISE] Scheduler Smoke Test");
  console.table(result);

  console.log("Recent Scheduler Runs:");
  console.table(scheduler.recentRuns(5));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
