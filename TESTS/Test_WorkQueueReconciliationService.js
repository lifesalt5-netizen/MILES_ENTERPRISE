"use strict";

const assert = require("assert");
const WorkQueueReconciliationService = require("../SERVICES/WorkQueueReconciliationService");

class FakeWorkQueue {
  constructor(items) {
    this.items = items;
  }

  load() {}
  getAll() { return this.items; }

  updateStatus(id, status, metadata = {}) {
    const item = this.items.find(x => x.id === id);
    if (!item) return null;
    item.status = status;
    item.metadata = metadata;
    return item;
  }

  markCompleted(id, metadata = {}) {
    return this.updateStatus(id, "Completed", metadata);
  }

  markAwaitingApproval(id, metadata = {}) {
    return this.updateStatus(id, "Awaiting Approval", metadata);
  }
}

class FakeTaskQueue {
  constructor(tasks) {
    this.tasks = tasks;
  }

  list() { return this.tasks; }
}

function workflow(taskIds, workPackageId) {
  return {
    workflowResult: {
      workPackageId,
      queuedTasks: taskIds.map(id => ({ id }))
    },
    workPackageId
  };
}

const workItems = [
  { id: "W-ORPHAN", status: "Queued", metadata: workflow(["T-MISSING"], "WP-1") },
  { id: "W-DONE", status: "Queued", metadata: workflow(["T-DONE"], "WP-2") },
  { id: "W-APPROVAL", status: "Queued", metadata: workflow(["T-APPROVAL"], "WP-3") },
  { id: "W-ACTIVE", status: "Queued", metadata: workflow(["T-ACTIVE"], "WP-4") },
  { id: "W-FAILED", status: "Queued", metadata: workflow(["T-FAILED"], "WP-5") }
];

const coreTasks = [
  { id: "T-DONE", status: "COMPLETED" },
  { id: "T-APPROVAL", status: "AWAITING_APPROVAL" },
  { id: "T-ACTIVE", status: "QUEUED" },
  { id: "T-FAILED", status: "FAILED" }
];

const service = new WorkQueueReconciliationService({
  workQueue: new FakeWorkQueue(workItems),
  taskQueue: new FakeTaskQueue(coreTasks)
});

const result = service.reconcile();

assert.equal(result.examinedQueued, 5);
assert.equal(result.resetToPending, 2);
assert.equal(result.markedCompleted, 1);
assert.equal(result.markedAwaitingApproval, 1);
assert.equal(result.keptQueued, 1);

assert.equal(workItems.find(x => x.id === "W-ORPHAN").status, "Pending");
assert.equal(workItems.find(x => x.id === "W-DONE").status, "Completed");
assert.equal(workItems.find(x => x.id === "W-APPROVAL").status, "Awaiting Approval");
assert.equal(workItems.find(x => x.id === "W-ACTIVE").status, "Queued");
assert.equal(workItems.find(x => x.id === "W-FAILED").status, "Pending");

console.log("WORK_QUEUE_RECONCILIATION_TEST=PASS");
console.log(JSON.stringify(result, null, 2));
