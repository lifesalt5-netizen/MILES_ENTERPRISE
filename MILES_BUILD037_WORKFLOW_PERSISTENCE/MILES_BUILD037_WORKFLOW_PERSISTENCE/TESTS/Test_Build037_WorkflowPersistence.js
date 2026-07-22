"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WorkQueueService = require("../SERVICES/WorkQueueService");

function main() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "miles-build037-")
  );

  const queuePath = path.join(root, "work_queue.json");
  const archivePath = path.join(root, "work_queue_archive.json");
  const lockPath = path.join(root, "work_queue.lock");

  const options = {
    queuePath,
    archivePath,
    lockPath,
    lockTimeoutMs: 5000,
    staleLockMs: 1000
  };

  const firstProcess = new WorkQueueService(options);
  const secondProcess = new WorkQueueService(options);

  const item = firstProcess.createWorkItem({
    area: "Sales",
    relatedProvider: "SalesProvider",
    title: "Build Sales COO pipeline and follow-up operator",
    recommendedAction:
      "Add sales pipeline provider and recurring follow-up queue.",
    requiresKevin: false
  });

  secondProcess.load();

  const queued = firstProcess.markQueued(item.id, {
    workPackageId: "WP-BUILD037",
    workflowResult: {
      status: "QUEUED",
      workPackage: { id: "WP-BUILD037" },
      queuedTasks: [{ id: "TASK-BUILD037" }]
    }
  });

  assert.strictEqual(queued.status, "Queued");

  const duplicate = secondProcess.createWorkItem({
    area: "Sales",
    relatedProvider: "SalesProvider",
    title: "Build Sales COO pipeline and follow-up operator",
    recommendedAction:
      "Add sales pipeline provider and recurring follow-up queue.",
    requiresKevin: false
  });

  assert.strictEqual(duplicate.id, item.id);
  assert.strictEqual(duplicate.status, "Queued");
  assert.strictEqual(
    duplicate.metadata.workPackageId,
    "WP-BUILD037"
  );

  const verifier = new WorkQueueService(options);
  const persisted = verifier.getById(item.id);

  assert.strictEqual(persisted.status, "Queued");
  assert.strictEqual(
    persisted.metadata.workPackageId,
    "WP-BUILD037"
  );

  console.log(JSON.stringify({
    ok: true,
    build: "037",
    tests: {
      interprocessStatusPreserved: "PASSED",
      staleInstanceCannotOverwriteQueuedState: "PASSED",
      duplicateWorkflowIdentityPreserved: "PASSED",
      workflowMetadataPreserved: "PASSED"
    },
    workItem: {
      id: persisted.id,
      status: persisted.status,
      workPackageId: persisted.metadata.workPackageId
    }
  }, null, 2));

  fs.rmSync(root, { recursive: true, force: true });
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
