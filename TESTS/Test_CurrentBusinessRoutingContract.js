"use strict";

const assert = require("assert");
const {
  BusinessWorkPlannerService
} = require("../SERVICES/BusinessWorkPlannerService");
const BusinessOperationsBridgeService = require("../SERVICES/BusinessOperationsBridgeService");

(async () => {
  const planner = new BusinessWorkPlannerService();

  const standard = await planner.plan({
    objective: "Execute the current executive revenue audit and refresh campaign state"
  });
  assert.equal(standard.mode, "EXECUTION");
  assert.equal(standard.workPackages.length, 3);
  assert.deepStrictEqual(
    standard.workPackages.map(x => x.connector),
    ["INSTANTLY", "INSTANTLY", "INSTANTLY"]
  );
  assert.deepStrictEqual(
    standard.workPackages.map(x => x.action),
    ["listCampaigns", "listAccounts", "getCampaignAnalyticsOverview"]
  );
  assert.deepStrictEqual(
    standard.workPackages.map(x => x.requiresKevin),
    [false, false, false]
  );
  assert.equal(standard.connectorContract.pseudoConnectorsForbidden.includes("Revenue"), true);
  assert.equal(standard.connectorContract.protectedWritesInferred, false);

  const capture = await planner.plan({
    objective: "Discover companies currently looking for capture help and stage qualified prospects"
  });
  assert.equal(capture.mode, "CAPTURE_REVENUE_EXECUTION");
  assert.equal(capture.captureMission, true);
  assert.equal(capture.workPackages.length, 1);
  assert.equal(capture.workPackages[0].connector, "MILES");
  assert.equal(capture.workPackages[0].provider, "MILES");
  assert.equal(capture.workPackages[0].action, "CAPTURE_CAPACITY_DISCOVERY");
  assert.equal(capture.workPackages[0].activationPolicy, "NEVER_AUTO_ACTIVATE");

  const review = await planner.plan({
    objective: "Read-only review. Do not send, modify, publish, launch, or write anything."
  });
  assert.equal(review.mode, "READ_ONLY_REVIEW");
  assert.equal(review.workPackages.length, 0);

  const bridge = new BusinessOperationsBridgeService({
    taskQueue: { enqueue() { throw new Error("enqueue must not be called by this regression"); } },
    enabled: false,
    commandPreflight: { evaluate: () => ({ ok: true, allowedToQueue: true, blockers: [] }) },
    revenueMissionSource: { read: () => ({}) }
  });

  const instantTask = bridge.buildTaskParts({
    id: "TEST-INSTANTLY",
    priority: 1,
    objective: standard.objective,
    ...standard.workPackages[0]
  });
  assert.equal(instantTask.type, "listCampaigns");
  assert.equal(instantTask.payload.provider, "INSTANTLY");
  assert.equal(instantTask.payload.connector, "INSTANTLY");
  assert.equal(instantTask.payload.action, "listCampaigns");
  assert.equal(instantTask.payload.capability, "READ_CAMPAIGNS");

  const captureTask = bridge.buildTaskParts({
    id: "TEST-CAPTURE",
    priority: 1,
    objective: capture.objective,
    ...capture.workPackages[0]
  });
  assert.equal(captureTask.type, "CAPTURE_CAPACITY_DISCOVERY");
  assert.equal(captureTask.payload.provider, "MILES");
  assert.equal(captureTask.payload.connector, "MILES");
  assert.equal(captureTask.payload.action, "CAPTURE_CAPACITY_DISCOVERY");
  assert.equal(captureTask.payload.plan.connector, "MILES");

  for (const task of [instantTask, captureTask]) {
    assert.notEqual(task.payload.connector, "Revenue");
    assert.notEqual(task.payload.provider, "Revenue");
  }

  console.log("CURRENT_BUSINESS_ROUTING_CONTRACT_TEST=PASS");
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
