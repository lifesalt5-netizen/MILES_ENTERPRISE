"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const RevenueMissionSourceService =
  require("../SERVICES/RevenueMissionSourceService");

const BusinessOperationsBridgeService =
  require("../SERVICES/BusinessOperationsBridgeService");

const revenueDir =
  path.join(ROOT, "DATA", "revenue");

const testQueue =
  path.join(revenueDir, "revenue_work_queue.json");

fs.mkdirSync(revenueDir, { recursive: true });

const original =
  fs.existsSync(testQueue)
    ? fs.readFileSync(testQueue, "utf8")
    : null;

const testItem = {
  id: "BUILD130_TEST_INTERESTED_PROSPECT",
  title: "Prepare follow-up for interested prospect",
  objective:
    "Prepare the next response and recommended sales action.",
  revenueStage: "INTERESTED_REPLY",
  provider: "MILES",
  action: "PREPARE_PROSPECT_RESPONSE",
  status: "READY",
  expectedRevenue: 90,
  urgency: 100,
  customerImpact: 90,
  strategicValue: 95,
  executionConfidence: 95,
  requiresKevin: false
};

fs.writeFileSync(
  testQueue,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      operations: [testItem]
    },
    null,
    2
  ),
  "utf8"
);

try {
  const source =
    new RevenueMissionSourceService({
      rootDir: ROOT
    });

  const result = source.readCandidates();

  const found = result.candidates.find(
    (item) =>
      item.id ===
      "BUILD130_TEST_INTERESTED_PROSPECT"
  );

  if (!found) {
    throw new Error(
      "Revenue mission was not discovered."
    );
  }

  if (
    found.revenueStage !==
    "INTERESTED_REPLY"
  ) {
    throw new Error(
      "Revenue stage was not preserved."
    );
  }

  if (found.status !== "READY") {
    throw new Error(
      "Revenue mission was not executable."
    );
  }

  const fakeTaskQueue = {
    tasks: [],
    add(type, payload, priority) {
      const task = {
        id: "BUILD130_TASK_1",
        type,
        payload,
        priority
      };

      this.tasks.push(task);
      return task;
    }
  };

  const bridge =
    new BusinessOperationsBridgeService({
      rootDir: ROOT,
      taskQueue: fakeTaskQueue
    });

  bridge.importRevenueWork();

  const queue = bridge.readQueue();

  const imported =
    queue.operations.find(
      (item) =>
        item.id ===
        "BUILD130_TEST_INTERESTED_PROSPECT"
    );

  if (!imported) {
    throw new Error(
      "Revenue mission was not imported into business queue."
    );
  }

  if (
    imported.expectedRevenue <= 0 ||
    imported.urgency <= 0
  ) {
    throw new Error(
      "Executive scoring signals are missing."
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        build: "BUILD130",
        sourceCandidates:
          result.candidates.length,
        importedMission: {
          id: imported.id,
          title: imported.title,
          revenueStage:
            imported.revenueStage,
          expectedRevenue:
            imported.expectedRevenue,
          urgency: imported.urgency,
          provider: imported.provider,
          action: imported.action,
          status: imported.status
        }
      },
      null,
      2
    )
  );
} finally {
  if (original === null) {
    try {
      fs.unlinkSync(testQueue);
    } catch {}
  } else {
    fs.writeFileSync(
      testQueue,
      original,
      "utf8"
    );
  }
}
