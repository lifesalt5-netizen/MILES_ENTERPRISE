"use strict";

require("dotenv").config();

process.env.MILES_REHEARSAL_MODE = "true";
process.env.MILES_CONTROLLED_WRITE_ENABLED = "false";
process.env.INSTANTLY_WRITE_ENABLED = "false";
process.env.MILES_AUTONOMOUS_EXECUTE = "false";
process.env.MILES_AUTONOMOUS_QUEUE_WORKFLOWS = "false";

const {
  ProductionBootstrapSupervisor,
  buildProcessPlan
} = require("./StartMilesProduction");

async function main() {
  const processes = buildProcessPlan(process.env).map(proc => {
    if (proc.name !== "Worker Runtime") return proc;
    return {
      ...proc,
      file: "StartProductionSystemRehearsal.js"
    };
  });

  const supervisor = new ProductionBootstrapSupervisor({ processes });

  process.once("SIGINT", () => supervisor.shutdown("SIGINT"));
  process.once("SIGTERM", () => supervisor.shutdown("SIGTERM"));

  console.log("[MILES REHEARSAL] =======================================");
  console.log("[MILES REHEARSAL] CONTROLLED CUTOVER REHEARSAL STARTING");
  console.log("[MILES REHEARSAL] Worker execution: DISABLED");
  console.log("[MILES REHEARSAL] Autonomous workflow queueing: DISABLED");
  console.log("[MILES REHEARSAL] Controlled writes: DISABLED");
  console.log("[MILES REHEARSAL] Instantly writes: DISABLED");
  console.log("[MILES REHEARSAL] =======================================");

  const result = await supervisor.startAll();
  console.log("[MILES REHEARSAL] All candidate runtimes reached readiness.");
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error("[MILES REHEARSAL] STARTUP FAILED");
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
