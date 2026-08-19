"use strict";

require("dotenv").config();

process.env.MILES_REHEARSAL_MODE = "true";
process.env.MILES_CONTROLLED_WRITE_ENABLED = "false";
process.env.INSTANTLY_WRITE_ENABLED = "false";
process.env.MILES_AUTONOMOUS_EXECUTE = "false";
process.env.MILES_AUTONOMOUS_QUEUE_WORKFLOWS = "false";

const { RuntimeWorkerSupervisor } = require("./StartProductionSystem");

async function main() {
  require("./API/server");

  const runtime = new RuntimeWorkerSupervisor();

  runtime.startExecutionLoop = function startExecutionLoopRehearsal() {
    this.executionTimer = null;
    console.log("[MILES REHEARSAL] Worker task execution DISABLED.");
  };

  runtime.startAutonomousWorkLoop = function startAutonomousWorkLoopRehearsal() {
    this.workGenerationTimer = null;
    console.log("[MILES REHEARSAL] Autonomous work generation DISABLED.");
  };

  let shutdownStarted = false;
  async function shutdown(signal) {
    if (shutdownStarted) return;
    shutdownStarted = true;
    await runtime.shutdown(signal);
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT").catch(() => process.exit(1)));
  process.on("SIGTERM", () => shutdown("SIGTERM").catch(() => process.exit(1)));

  console.log("[MILES REHEARSAL] Starting governed worker runtime in zero-execution mode.");
  await runtime.boot();
}

if (require.main === module) {
  main().catch(error => {
    console.error("[MILES REHEARSAL] Worker runtime failed:", error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { main };
