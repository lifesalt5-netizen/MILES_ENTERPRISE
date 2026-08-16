"use strict";

const assert = require("assert");
const planner = require("../SERVICES/BusinessWorkPlannerService");

const SAFE_READ_ACTIONS = new Set([
  "listCampaigns",
  "listAccounts",
  "getCampaignAnalyticsOverview"
]);

const PROTECTED_WRITES = new Set([
  "sendEmail",
  "replyToEmail",
  "activateCampaign",
  "pauseCampaign",
  "updateCampaign",
  "addLead",
  "addLeadsBulk",
  "moveLead",
  "deleteLead",
  "createEmailVerificationJob"
]);

(async () => {
  const review = await planner.plan({
    objective:
      "Review the current P2GC revenue pipeline and report the top 3 actions. Read-only. Do not send email, modify campaigns, or change external systems."
  });

  assert.strictEqual(review.ok, true);
  assert.strictEqual(review.mode, "READ_ONLY_REVIEW");
  assert.strictEqual(review.readOnly, true);
  assert.strictEqual(review.workPackageCount, 0);
  assert.deepStrictEqual(review.workPackages, []);
  assert.strictEqual(review.recommendationCount, 3);
  assert.strictEqual(review.recommendations.length, 3);

  const execution = await planner.plan({
    objective:
      "Execute the safe outbound operating-data refresh and return the findings to the CEO."
  });

  assert.strictEqual(execution.ok, true);
  assert.strictEqual(execution.mode, "EXECUTION");
  assert.strictEqual(execution.readOnly, false);
  assert.strictEqual(execution.workPackageCount, 3);

  for (const work of execution.workPackages) {
    assert.strictEqual(work.provider, "INSTANTLY");
    assert.strictEqual(work.connector, "INSTANTLY");
    assert.strictEqual(work.system, "INSTANTLY");
    assert.strictEqual(work.readOnly, true);
    assert.strictEqual(work.requiresKevin, false);
    assert.ok(
      SAFE_READ_ACTIONS.has(work.action),
      `Unsupported/non-canonical read action emitted: ${work.action}`
    );
    assert.ok(
      !PROTECTED_WRITES.has(work.action),
      `Generic business planner inferred a protected write: ${work.action}`
    );
    assert.notStrictEqual(
      String(work.connector).toUpperCase(),
      "REVENUE",
      "Revenue is a department/domain, not a connector identity."
    );
  }

  assert.deepStrictEqual(
    execution.workPackages.map(item => item.action),
    ["listCampaigns", "listAccounts", "getCampaignAnalyticsOverview"]
  );

  assert.ok(
    execution.workPackages.every(item => item.taskType !== "BUILD_EXECUTION_QUEUE"),
    "Planner must not recursively create a BUILD_EXECUTION_QUEUE pseudo-task."
  );

  console.log(JSON.stringify({
    ok: true,
    test: "BUSINESS_WORK_PLANNER_EXECUTION_CONTRACT_P0",
    readOnlyRecommendations: review.recommendationCount,
    readOnlyQueuedWork: review.workPackageCount,
    executionPackages: execution.workPackageCount,
    connector: "INSTANTLY",
    actions: execution.workPackages.map(item => item.action)
  }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
