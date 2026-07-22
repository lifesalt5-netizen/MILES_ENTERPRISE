"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WorkQueueService = require("../SERVICES/WorkQueueService");
const AutonomousCOOLoopService = require("../SERVICES/AutonomousCOOLoopService");

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-build037-"));
  const queuePath = path.join(root, "work_queue.json");
  const archivePath = path.join(root, "work_queue_archive.json");

  const q1 = new WorkQueueService({ queuePath, archivePath });
  const item = q1.createWorkItem({
    area: "Sales",
    title: "Build Sales COO pipeline and follow-up operator",
    recommendedAction: "Add sales pipeline provider and recurring follow-up queue.",
    relatedProvider: "SalesProvider",
    requiresKevin: false
  });

  const staleInstance = new WorkQueueService({ queuePath, archivePath });

  const queued = q1.markQueued(item.id, {
    workPackageId: "WP-BUILD037",
    workflowResult: {
      status: "QUEUED",
      workPackageId: "WP-BUILD037",
      queuedTasks: [{ id: "TASK-BUILD037" }]
    }
  });

  assert.strictEqual(queued.status, "Queued");

  staleInstance.createWorkItem({
    area: "ORION",
    title: "Refresh ORION",
    recommendedAction: "Refresh ORION data",
    relatedProvider: "OrionProvider",
    requiresKevin: false
  });

  const verification = new WorkQueueService({ queuePath, archivePath });
  const preserved = verification.getById(item.id);

  assert.ok(preserved);
  assert.strictEqual(preserved.status, "Queued");
  assert.strictEqual(preserved.metadata.workPackageId, "WP-BUILD037");

  const mockWorkQueue = {
    markQueued() {
      return { id: "WORK-1", status: "Pending" };
    },
    updateStatus() {
      return { id: "WORK-1", status: "Pending" };
    },
    load() {},
    getAll() {
      return [{ id: "WORK-1", status: "Pending" }];
    }
  };

  const coo = new AutonomousCOOLoopService({
    workQueue: mockWorkQueue,
    intelligence: {},
    workflowService: {},
    businessBridge: {}
  });

  const persistenceResult = coo.persistQueuedState("WORK-1", {
    workPackageId: "WP-1"
  });

  assert.strictEqual(persistenceResult.status, "Pending");

  console.log(JSON.stringify({
    ok: true,
    build: "037",
    tests: {
      transactionalStatusUpdate: "PASSED",
      staleInstanceCannotOverwriteQueuedState: "PASSED",
      workflowMetadataPreserved: "PASSED",
      persistenceRetryIsNonDestructive: "PASSED"
    }
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
