"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const BusinessWorkPlanner = require("../SERVICES/BusinessWorkPlannerService");
const { BusinessOperationsBridgeService } = require("../SERVICES/BusinessOperationsBridgeService");
const RuntimeController = require("../CORE/RuntimeController");
const taskQueue = require("../CORE/TaskQueue");

function now() {
  return new Date().toISOString();
}

(async () => {
  const testRoot = path.join(ROOT, "DATA", "runtime", "minimum_coo_e2e_test");
  fs.mkdirSync(testRoot, { recursive: true });

  const queueFile = path.join(testRoot, "business_operations_queue.json");
  const marketingQueueFile = path.join(testRoot, "marketing_work_queue.json");

  const plan = await BusinessWorkPlanner.plan({
    objective: "Validate Minimum COO end-to-end execution"
  });

  const selected = plan.workPackages.find(x => x.action === "QUEUE_WORK") || plan.workPackages[0];

  const operation = {
    id: `MINCOO-${Date.now()}`,
    status: "READY",
    priority: selected.priority || 1,
    title: selected.description || "Minimum COO execution test",
    objective: "Validate Minimum COO end-to-end execution",
    provider: "MILES",
    system: "MILES",
    department: "Operations",
    connector: "MILES",
    action: selected.action || "QUEUE_WORK",
    capability: selected.action || "QUEUE_WORK",
    source: "minimum_coo_e2e_test",
    createdAt: now()
  };

  fs.writeFileSync(queueFile, JSON.stringify({ generatedAt: now(), source: "TEST", operations: [operation] }, null, 2));
  fs.writeFileSync(marketingQueueFile, "[]");

  const bridge = new BusinessOperationsBridgeService({
    rootDir: ROOT,
    queueFile,
    marketingQueueFile,
    revenueMissionSource: {
      readCandidates() {
        return { candidates: [], sourceSummary: [] };
      }
    }
  });

  const bridgeResult = await bridge.runOnce();
  const businessQueue = JSON.parse(fs.readFileSync(queueFile, "utf8"));
  const bridged = businessQueue.operations.find(x => x.id === operation.id);
  const queuedTask = taskQueue.list().find(x => x.id === bridged?.taskId);

  let execution = null;
  if (queuedTask) {
    execution = await RuntimeController.executeWorkforceStep(queuedTask.id);
  }

  const finalTask = queuedTask ? taskQueue.list().find(x => x.id === queuedTask.id) : null;

  const result = {
    ok: Boolean(
      plan.ok &&
      bridgeResult.ok &&
      bridged?.status === "BRIDGED" &&
      queuedTask?.type === "WORKFORCE_STEP" &&
      execution?.ok &&
      finalTask && ["COMPLETED", "FAILED"].includes(finalTask.status)
    ),
    gate: "MINIMUM_COO_END_TO_END",
    planner: {
      ok: plan.ok,
      workPackageCount: plan.workPackageCount,
      selectedAction: selected.action
    },
    bridge: bridgeResult,
    bridgedOperation: bridged || null,
    queuedTask: queuedTask ? {
      id: queuedTask.id,
      type: queuedTask.type,
      status: queuedTask.status,
      action: queuedTask.payload?.action,
      provider: queuedTask.payload?.provider
    } : null,
    execution,
    finalTask: finalTask ? {
      id: finalTask.id,
      type: finalTask.type,
      status: finalTask.status,
      action: finalTask.payload?.action,
      provider: finalTask.payload?.provider
    } : null
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
})().catch(error => {
  console.error(JSON.stringify({ ok: false, gate: "MINIMUM_COO_END_TO_END", error: error.stack || error.message }, null, 2));
  process.exitCode = 1;
});
