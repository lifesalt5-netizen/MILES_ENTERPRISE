"use strict";

const assert = require("assert");
const AutonomousCOOLoopService =
  require("../SERVICES/AutonomousCOOLoopService");

class FakeWorkQueue {
  constructor() {
    this.items = [
      {
        id: "WORK-1",
        status: "Pending",
        title: "Repair Website: Conversion",
        recommendedAction: "Verify website health",
        requiresKevin: false,
        executionType: "WORKFLOW",
        metadata: {}
      }
    ];
  }

  load() {}

  getAll() {
    return this.items;
  }

  getStats() {
    return {
      total: this.items.length,
      pending: this.items.filter(x => x.status === "Pending").length,
      queued: this.items.filter(x => x.status === "Queued").length
    };
  }

  getAuthorizedPending() {
    return this.items.filter(
      x =>
        x.status === "Pending" &&
        x.requiresKevin !== true &&
        x.executionType !== "APPROVAL_REQUIRED"
    );
  }

  markQueued(id, metadata = {}) {
    const item = this.items.find(x => x.id === id);
    if (!item) return null;
    item.status = "Queued";
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  updateStatus(id, status, metadata = {}) {
    const item = this.items.find(x => x.id === id);
    if (!item) return null;
    item.status = status;
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  save() {}
}

function main() {
  const queue = new FakeWorkQueue();
  let workflowCalls = 0;

  const workflowService = {
    createWorkflow(objective, context) {
      workflowCalls += 1;
      return {
        status: "QUEUED",
        queuedTasks: [{ id: "TASK-1" }],
        workPackage: {
          id: "WP-1"
        }
      };
    }
  };

  const loop = new AutonomousCOOLoopService({
    workQueue: queue,
    workflowService,
    enableExecution: false,
    enableWorkflowQueueing: true
  });

  const first = loop.queueAuthorizedWorkflows();

  assert.strictEqual(workflowCalls, 1);
  assert.strictEqual(queue.items[0].status, "Queued");
  assert.strictEqual(queue.items[0].metadata.workPackageId, "WP-1");
  assert.strictEqual(first.length, 1);
  assert.strictEqual(first[0].persistedStatus, "Queued");

  const second = loop.queueAuthorizedWorkflows();

  assert.strictEqual(
    workflowCalls,
    1,
    "Second authorization pass must not create a duplicate workflow."
  );

  assert.strictEqual(second.length, 0);

  console.log(JSON.stringify({
    ok: true,
    build: "031",
    tests: {
      firstWorkflowCreated: "PASSED",
      originatingWorkItemMarkedQueued: "PASSED",
      workPackagePersisted: "PASSED",
      secondPassSkipsQueuedItem: "PASSED",
      duplicateWorkflowPrevented: "PASSED"
    },
    workItem: queue.items[0],
    workflowCalls
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
