"use strict";

require("dotenv").config();

const AutonomousCOOLoopService = require("./SERVICES/AutonomousCOOLoopService");

function boolFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function intFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {
  const mode = process.argv.includes("--loop") ? "loop" : "once";
  const execute = boolFromEnv("MILES_AUTONOMOUS_EXECUTE", true);
  const queueWorkflows = boolFromEnv("MILES_AUTONOMOUS_QUEUE_WORKFLOWS", true);
  const maxExecutionPasses = intFromEnv("MILES_AUTONOMOUS_EXECUTION_PASSES", 5);
  const intervalMs = intFromEnv("MILES_AUTONOMOUS_INTERVAL_MS", 5 * 60 * 1000);

  const loop = new AutonomousCOOLoopService({
    enableExecution: execute,
    enableWorkflowQueueing: queueWorkflows,
    maxExecutionPasses,
    intervalMs,
    maxCycles: mode === "once" ? 1 : null
  });

  if (mode === "loop") {
    console.log("[MILES] Autonomous COO loop starting.");
    console.log(`[MILES] Execution: ${execute ? "enabled" : "disabled"}`);
    console.log(`[MILES] Workflow queueing: ${queueWorkflows ? "enabled" : "disabled"}`);
    console.log(`[MILES] Interval: ${intervalMs}ms`);
    const result = await loop.start();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("[MILES] Running one autonomous COO cycle.");
  const result = await loop.runOnce();
  console.log(JSON.stringify({
    ok: result.ok,
    cycleId: result.cycleId,
    autonomy: result.autonomy,
    businessHealth: result.businessHealth,
    healthScore: result.health?.overallScore,
    missionPriorities: result.mission?.priorities?.length || 0,
    workCreated: result.workCreated?.total || 0,
    workflowsQueued: result.workflowResults?.length || 0,
    executionPasses: result.executionResults?.length || 0,
    outputs: {
      executive: "DATA/executive/latest_coo_cycle.md",
      mission: "DATA/executive/latest_mission_plan.json",
      health: "DATA/executive/latest_universal_health.json",
      repair: "DATA/autonomous_repair/latest_repair_plan.json",
      backlog: "DATA/capability_backlog/latest_capability_backlog.json",
      cycle: "DATA/runtime/latest_coo_cycle.json"
    }
  }, null, 2));
}

main().catch(err => {
  console.error("[MILES] Autonomous COO failed:", err.stack || err.message);
  process.exitCode = 1;
});
