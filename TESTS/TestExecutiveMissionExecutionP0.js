"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-exec-mission-"));
process.env.MILES_ROOT = root;
process.chdir(root);

function writeJson(relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

writeJson("DATA/runtime/task_queue.json", []);
writeJson("DATA/runtime/work_queue.json", { metadata: {}, items: [] });
writeJson("DATA/runtime/work_queue_archive.json", { metadata: {}, items: [] });
writeJson("DATA/capability/capability_execution_map.json", { executionMap: {} });
writeJson("DATA/repository/repository_registry.json", { statistics: {}, health: {} });
writeJson("DATA/capability/capability_registry.json", { statistics: {}, autonomy: {} });
writeJson("DATA/latest_executive_state.json", {
  revenue: { goal: 10000, current: 1500, pipeline: 25000, status: "ACTIVE" },
  marketing: { totalCampaigns: 3, activeCampaigns: 2, status: "ACTIVE" },
  clients: { active: 2, status: "ACTIVE" }
});
writeJson("DATA/latest_executive_brief.json", {});
writeJson("DATA/runtime/latest_coo_cycle.json", {});
writeJson("DATA/executive_brain/latest_executive_decision.json", {});

const engine = require("../SERVICES/BusinessExecutionEngineServiceV2");
const taskQueue = require("../CORE/TaskQueue");

(async () => {
  try {
    const command =
      "Review the current P2GC revenue pipeline and report the top 3 actions that should be taken next. Read-only acceptance test. Do not send email, modify campaigns, or change external systems.";

    const result = await engine.run({
      id: "MISSION_TEST_001",
      action: "BUSINESS_EXECUTION",
      payload: {
        command,
        objective: command,
        plan: {
          ok: true,
          intent: "EXECUTIVE_MISSION",
          workflow: "EXECUTIVE_MISSION_PLANNING",
          action: "BUSINESS_EXECUTION",
          provider: "MILES",
          connector: "MILES",
          objective: command,
          originalCommand: command,
          steps: [
            { step: 1, provider: "MILES", connector: "MILES", capability: "COMPANY_STATE", action: "COMPANY_STATE", objective: "Review current business state." },
            { step: 2, provider: "MILES", connector: "MILES", capability: "BUSINESS_EXECUTION", action: "BUSINESS_EXECUTION", objective: "Identify and prioritize the highest-impact actions." },
            { step: 3, provider: "MILES", connector: "MILES", capability: "TASK_ROUTER", action: "TASK_ROUTER", objective: "Route authorized work." },
            { step: 4, provider: "MILES", connector: "MILES", capability: "EXECUTIVE_DASHBOARD", action: "EXECUTIVE_DASHBOARD", objective: "Refresh executive action view." }
          ]
        }
      }
    });

    assert.strictEqual(result.ok, true, JSON.stringify(result.results, null, 2));
    assert.strictEqual(result.status, "COMPLETED");
    assert.strictEqual(result.failedSteps, 0);
    assert.strictEqual(result.completedSteps, 4);
    assert.ok(Array.isArray(result.executiveSummary.topActions));
    assert.ok(result.executiveSummary.topActions.length >= 3);

    const queued = taskQueue.list();
    assert.ok(queued.length >= 8, `Expected planned work in TaskQueue, found ${queued.length}`);
    assert.ok(queued.every(item => item.status === "QUEUED"), "Authorized read-only planning work must enter TaskQueue without false approval state.");

    const latest = JSON.parse(fs.readFileSync(
      path.join(root, "DATA", "business_execution", "latest_business_execution.json"),
      "utf8"
    ));
    assert.strictEqual(latest.executionId, result.executionId);
    assert.strictEqual(latest.ok, true);

    console.log(JSON.stringify({
      ok: true,
      test: "EXECUTIVE_MISSION_EXECUTION_P0",
      completedSteps: result.completedSteps,
      queuedTasks: queued.length,
      topActions: result.executiveSummary.topActions.length
    }, null, 2));
  } finally {
    process.chdir(os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
