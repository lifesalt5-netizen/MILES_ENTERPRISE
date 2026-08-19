"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const planner = require("../SERVICES/BusinessWorkPlannerService");
const { BusinessOperationsBridgeService } = require("../SERVICES/BusinessOperationsBridgeService");
const runtime = require("../CORE/RuntimeController");
const taskQueue = require("../CORE/TaskQueue");

function now() {
  return new Date().toISOString();
}

(async () => {
  const testRoot = path.join(ROOT, "DATA", "runtime", "minimum_coo_revenue_read_test");
  fs.mkdirSync(testRoot, { recursive: true });

  const queueFile = path.join(testRoot, "business_operations_queue.json");
  const marketingQueueFile = path.join(testRoot, "marketing_work_queue.json");

  const plan = await planner.plan({
    objective: "Run Minimum COO read-only revenue visibility cycle"
  });

  const selected = plan.workPackages.find(
    item => item.taskType === "REFRESH_CAMPAIGN_INVENTORY"
  );

  if (!selected) {
    throw new Error("REFRESH_CAMPAIGN_INVENTORY work package not found.");
  }

  const operation = {
    id: `MINCOO-REV-${Date.now()}`,
    status: "READY",
    priority: selected.priority,
    title: selected.description,
    objective: "Run Minimum COO read-only revenue visibility cycle",
    provider: selected.provider,
    system: selected.provider,
    department: "Marketing",
    connector: selected.provider,
    action: selected.action,
    capability: selected.capability,
    source: "minimum_coo_revenue_read_test",
    createdAt: now()
  };

  fs.writeFileSync(
    queueFile,
    JSON.stringify({ generatedAt: now(), source: "TEST", operations: [operation] }, null, 2)
  );
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
  const bridgedOperation = businessQueue.operations.find(x => x.id === operation.id);
  const queuedTask = taskQueue.list().find(x => x.id === bridgedOperation?.taskId);

  const execution = queuedTask
    ? await runtime.executeWorkforceStep(queuedTask.id)
    : null;

  const finalTask = queuedTask
    ? taskQueue.list().find(x => x.id === queuedTask.id)
    : null;

  const providerResult =
    execution?.result?.result?.output?.providerResult ||
    execution?.result?.result?.providerResult ||
    null;

  const providerOutput =
    providerResult?.providerOutput ||
    null;

  const metrics =
    providerResult?.metrics ||
    providerOutput?.metrics ||
    {};

  const liveCampaigns = Number(metrics.totalCampaigns || 0);
  const liveAccounts = Number(metrics.totalAccounts || 0);
  const localSegmentLeads = Number(metrics.segmentInventory?.totalLeads || 0);
  const localSegments = Number(metrics.segmentInventory?.totalSegments || 0);

  const readOnly =
    providerOutput?.readOnly === true;

  const writesEnabled =
    providerOutput?.safety?.writesEnabled === true;

  const externalWritesPerformed =
    providerOutput?.externalWritesPerformed === true;

  const segmentInventoryStale =
    liveCampaigns > 0 &&
    liveAccounts > 0 &&
    localSegments > 0 &&
    localSegmentLeads === 0;

  const result = {
    ok: Boolean(
      plan.ok &&
      selected.provider === "Marketing" &&
      selected.action === "auditCampaignHealth" &&
      bridgeResult.ok &&
      queuedTask?.type === "WORKFORCE_STEP" &&
      execution?.ok &&
      execution?.status === "COMPLETED" &&
      finalTask?.status === "COMPLETED" &&
      providerResult &&
      providerResult.provider === "MarketingProvider" &&
      liveCampaigns > 0 &&
      liveAccounts > 0 &&
      readOnly &&
      !writesEnabled &&
      !externalWritesPerformed
    ),
    gate: "MINIMUM_COO_REVENUE_READ_CYCLE",
    planner: {
      provider: selected.provider,
      action: selected.action,
      capability: selected.capability
    },
    bridge: {
      ok: bridgeResult.ok,
      operationsQueued: bridgeResult.operationsQueued
    },
    queuedTask: queuedTask ? {
      id: queuedTask.id,
      type: queuedTask.type,
      provider: queuedTask.payload?.provider,
      action: queuedTask.payload?.action,
      capability: queuedTask.payload?.capability
    } : null,
    execution: execution ? {
      ok: execution.ok,
      status: execution.status,
      taskId: execution.taskId
    } : null,
    provider: providerResult ? {
      provider: providerResult.provider,
      action: providerResult.action,
      status: providerResult.status,
      readOnly,
      writesEnabled,
      externalWritesPerformed,
      metrics,
      evidenceFile: providerOutput?.evidenceFile || providerResult.evidenceFile || null
    } : null,
    diagnostics: {
      liveCampaigns,
      liveAccounts,
      localSegments,
      localSegmentLeads,
      segmentInventoryStale,
      nextAction: segmentInventoryStale
        ? "REFRESH_SEGMENT_INVENTORY_FROM_ACCEPTED_ORION_BASELINE"
        : "COMPARE_SEGMENTS_TO_CAMPAIGNS"
    },
    finalTask: finalTask ? {
      id: finalTask.id,
      status: finalTask.status
    } : null
  };

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
})().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    gate: "MINIMUM_COO_REVENUE_READ_CYCLE",
    error: error.stack || error.message
  }, null, 2));
  process.exitCode = 1;
});
