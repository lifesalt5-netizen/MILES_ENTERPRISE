"use strict";

require("dotenv").config();

const taskQueue = require("../CORE/TaskQueue");
const supervisor = require("../CORE/Supervisor");
const executionService = require("../SERVICES/ExecutionService");

const STALE_MS = 15 * 60 * 1000;

async function main() {
  await supervisor.registerConnectors();

  console.log("[FIX] Connectors:", require("../CORE/ConnectorManager").list());

  const running = taskQueue.list("RUNNING");
  const now = Date.now();
  let recovered = 0;

  for (const task of running) {
    const timestamp = new Date(task.updatedAt || task.createdAt || 0).getTime();
    const stale = !Number.isFinite(timestamp) || now - timestamp >= STALE_MS;

    if (!stale) continue;

    taskQueue.update(task.id, {
      status: "QUEUED",
      result: null,
      recovery: {
        reason: "STALE_RUNNING_TASK",
        previousStatus: "RUNNING",
        recoveredAt: new Date().toISOString(),
        recoveredBy: "FixMilesNowRunner"
      }
    });

    recovered++;
    console.log("[FIX] Requeued:", task.id);
  }

  console.log("[FIX] Recovered stale tasks:", recovered);

  let passes = 0;

  while (taskQueue.list("QUEUED").length && passes < 10) {
    passes++;
    console.log(`[FIX] Execution pass ${passes}`);
    const result = await executionService.runNext();
    console.log("[FIX] Result:", JSON.stringify(result, null, 2));
  }

  const status = taskQueue.getStatus();
  console.log("[FIX] Final queue:", JSON.stringify(status, null, 2));

  const remainingRunning = taskQueue.list("RUNNING");
  if (remainingRunning.length) {
    console.error("[FIX] FAIL: RUNNING tasks remain.");
    console.error(JSON.stringify(remainingRunning, null, 2));
    process.exitCode = 2;
    return;
  }

  console.log("[FIX] PASS: stale task recovery and execution completed.");
}

main().catch(error => {
  console.error("[FIX] FATAL:", error);
  process.exitCode = 1;
});