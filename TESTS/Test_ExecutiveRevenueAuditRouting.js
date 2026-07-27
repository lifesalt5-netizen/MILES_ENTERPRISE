"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  EXECUTION_ID,
  ROUTES,
  inspectTasks,
  repairTasks
} = require(
  "../SCRIPTS/RepairExecutiveRevenueAuditQueue"
);

const BusinessWorkPlannerService =
  require(
    "../SERVICES/BusinessWorkPlannerService"
  );

const BusinessOperationsBridgeService =
  require(
    "../SERVICES/BusinessOperationsBridgeService"
  );

async function run() {
  const plan =
    await BusinessWorkPlannerService.plan({
      objective:
        "Complete the Executive Revenue Audit."
    });

  assert.strictEqual(
    plan.workPackageCount,
    8,
    "Expected eight revenue-audit work packages."
  );

  const expectedActions = [
    "campaign_audit",
    "capacity_audit",
    "segment_audit",
    "plan_marketing_actions",
    "plan_marketing_actions",
    "capacity_audit",
    "segment_audit",
    "plan_marketing_actions"
  ];

  plan.workPackages.forEach((work, index) => {
    assert.strictEqual(
      work.provider,
      "MarketingProvider"
    );
    assert.strictEqual(
      work.connector,
      "WORKFORCE"
    );
    assert.strictEqual(
      work.action,
      expectedActions[index]
    );
    assert.ok(
      ["AUDIT", "PLAN"].includes(
        work.governanceIntent
      )
    );
    assert.strictEqual(
      work.requiresKevin,
      false
    );
  });

  const tempRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "miles-revenue-routing-"
      )
    );

  try {
    const bridge =
      new BusinessOperationsBridgeService({
        rootDir: tempRoot,
        taskQueue: {
          add() {
            throw new Error(
              "Test does not enqueue."
            );
          }
        },
        revenueMissionSource: {
          readCandidates() {
            return {
              candidates: [],
              sourceSummary: []
            };
          }
        }
      });

    plan.workPackages.forEach(work => {
      const parts =
        bridge.buildTaskParts({
          ...work,
          id: `TEST-${work.priority}`,
          objective: work.description,
          status: "READY",
          plan: {
            ...work
          }
        });

      assert.strictEqual(
        parts.type,
        "WORKFORCE_STEP"
      );
      assert.strictEqual(
        parts.payload.provider,
        "MarketingProvider"
      );
      assert.strictEqual(
        parts.payload.connector,
        "WORKFORCE"
      );
      assert.strictEqual(
        parts.payload.plan.governanceIntent,
        work.governanceIntent
      );
    });
  } finally {
    fs.rmSync(
      tempRoot,
      {
        recursive: true,
        force: true
      }
    );
  }

  const sampleTasks =
    Object.entries(ROUTES).map(
      ([id], index) => ({
        id,
        type:
          index % 2 === 0
            ? "LIST_CAMPAIGNS"
            : "QUEUE_WORK",
        status:
          index % 2 === 0
            ? "FAILED"
            : "AWAITING_APPROVAL",
        error:
          "Old routing failure",
        payload: {
          sourceExecutionId:
            EXECUTION_ID,
          provider:
            index % 2 === 0
              ? "Instantly"
              : "Revenue",
          connector:
            index % 2 === 0
              ? "Instantly"
              : "Revenue",
          action:
            index % 2 === 0
              ? "LIST_CAMPAIGNS"
              : "QUEUE_WORK",
          error:
            "Old bridge failure",
          bridgeFailedAt:
            "2026-07-27T15:00:00.000Z",
          plan: {
            provider: "Revenue",
            connector: "Revenue",
            action: "QUEUE_WORK"
          }
        }
      })
    );

  const repaired =
    repairTasks(
      sampleTasks,
      "2026-07-27T21:00:00.000Z"
    );

  assert.strictEqual(
    repaired.changed.length,
    8
  );

  const verification =
    inspectTasks(repaired.tasks);

  assert.ok(
    verification.every(
      item => item.alreadyRepaired
    ),
    "All eight tasks must match the permanent WORKFORCE route."
  );

  for (const task of repaired.tasks) {
    assert.strictEqual(
      task.type,
      "WORKFORCE_STEP"
    );
    assert.strictEqual(
      task.status,
      "QUEUED"
    );
    assert.strictEqual(
      task.payload.provider,
      "MarketingProvider"
    );
    assert.strictEqual(
      task.payload.connector,
      "WORKFORCE"
    );
    assert.strictEqual(
      task.error,
      null
    );
    assert.strictEqual(
      task.payload.error,
      undefined
    );
    assert.strictEqual(
      task.payload.bridgeFailedAt,
      undefined
    );
  }

  console.log(
    "EXECUTIVE_REVENUE_AUDIT_ROUTING_TEST_PASS 8/8"
  );
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
