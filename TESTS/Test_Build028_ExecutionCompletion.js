"use strict";

const assert = require("assert");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const {
  RuntimeWorkerSupervisor
} = require("../StartProductionSystem");

class FakeTaskQueue {
  constructor() {
    this.tasks = [{
      id: "TASK-1",
      type: "WORKFORCE_STEP",
      priority: 1,
      status: "COMPLETED",
      payload: {
        workPackageId: "WP-1"
      }
    }, {
      id: "TASK-2",
      type: "WORKFORCE_STEP",
      priority: 2,
      status: "FAILED",
      error: "Provider failed",
      payload: {
        workPackageId: "WP-2"
      }
    }, {
      id: "TASK-3",
      type: "WORKFORCE_STEP",
      priority: 3,
      status: "QUEUED",
      payload: {
        workPackageId: "WP-3"
      }
    }];
  }

  list(status = null) {
    return status
      ? this.tasks.filter(
          task => task.status === status
        )
      : this.tasks;
  }

  update(id, patch) {
    const task =
      this.tasks.find(
        row => row.id === id
      );

    Object.assign(task, patch);
    return task;
  }

  getStatus() {
    return {
      total: this.tasks.length,
      pending: this.tasks.filter(
        task => task.status === "QUEUED"
      ).length,
      running: 0,
      completed: this.tasks.filter(
        task => task.status === "COMPLETED"
      ).length,
      failed: this.tasks.filter(
        task => task.status === "FAILED"
      ).length,
      healthScore: 100
    };
  }
}

class FakeWorkQueue {
  constructor() {
    this.items = [{
      id: "WORK-1",
      status: "Queued",
      source: "ExecutiveCOO",
      metadata: {
        workflowResult: {
          workPackage: {
            id: "WP-1"
          }
        }
      }
    }, {
      id: "WORK-2",
      status: "Queued",
      source: "ExecutiveCOO",
      metadata: {
        workflowResult: {
          workPackage: {
            id: "WP-2"
          }
        }
      }
    }, {
      id: "WORK-3",
      status: "Queued",
      source: "ExecutiveCOO",
      metadata: {
        workflowResult: {
          workPackage: {
            id: "WP-3"
          }
        }
      }
    }, {
      id: "WORK-4",
      status: "Queued",
      source: "CapabilityBacklog",
      area: "Website COO",
      title: "Build Website COO live audit and repair operator",
      metadata: {
        workflowResult: {
          workPackage: {
            id: "WP-4"
          }
        }
      }
    }];
  }

  load() {}

  getOpen() {
    return this.items.filter(item =>
      [
        "Pending",
        "Queued",
        "In Progress",
        "Blocked",
        "Awaiting Approval"
      ].includes(item.status)
    );
  }

  markCompleted(id, metadata = {}) {
    const item =
      this.items.find(row => row.id === id);
    item.status = "Completed";
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  markFailed(id, metadata = {}) {
    const item =
      this.items.find(row => row.id === id);
    item.status = "Failed";
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  markAwaitingApproval(id, metadata = {}) {
    const item =
      this.items.find(row => row.id === id);
    item.status = "Awaiting Approval";
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  markRunning(id, metadata = {}) {
    const item =
      this.items.find(row => row.id === id);
    item.status = "In Progress";
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  markQueued(id, metadata = {}) {
    const item =
      this.items.find(row => row.id === id);
    item.status = "Queued";
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  getStats() {
    return {
      total: this.items.length,
      completed: this.items.filter(
        item => item.status === "Completed"
      ).length,
      failed: this.items.filter(
        item => item.status === "Failed"
      ).length
    };
  }

  archiveClosed() {
    const closed =
      this.items.filter(item =>
        [
          "Completed",
          "Failed",
          "Cancelled",
          "Archived"
        ].includes(item.status)
      );

    this.items =
      this.items.filter(item =>
        !closed.includes(item)
      );

    return {
      ok: true,
      archived: closed.length
    };
  }
}

async function main() {
  const taskQueue =
    new FakeTaskQueue();

  const workQueue =
    new FakeWorkQueue();

  const runtime =
    new RuntimeWorkerSupervisor({
      taskQueue,
      workQueue,
      executionService: {
        async runNext() {
          return {
            ok: true,
            message: "No queued tasks"
          };
        }
      },
      supervisor: {
        async start() {}
      },
      eventBus: {
        emit() {}
      },
      ExecutiveBriefService: class {
        generate() {
          return {
            businessHealth: "Healthy",
            businessHealthScore: 100,
            authorizedWork: [],
            executiveDecisionsNeeded: []
          };
        }

        toMarkdown() {
          return "# Brief";
        }
      },
      executiveState: {},
      providerRouter: {
        status() {
          return {
            registeredProviders: [
              "WebsiteProvider",
              "SalesProvider",
              "MarketingProvider",
              "OrionProvider",
              "GoogleWorkspaceProvider"
            ]
          };
        }
      },
      workPackageService: {
        get(id) {
          return {
            id,
            status: "QUEUED"
          };
        }
      },
      executionIntervalMs: 999999,
      heartbeatMs: 999999,
      briefIntervalMs: 999999,
      reconciliationIntervalMs: 999999,
      archiveIntervalMs: 999999
    });

  const result =
    runtime.reconcileWorkQueue();

  assert.strictEqual(
    workQueue.items.find(
      item => item.id === "WORK-1"
    ).status,
    "Completed"
  );

  assert.strictEqual(
    workQueue.items.find(
      item => item.id === "WORK-2"
    ).status,
    "Failed"
  );

  assert.strictEqual(
    workQueue.items.find(
      item => item.id === "WORK-3"
    ).status,
    "Queued"
  );

  assert.strictEqual(
    workQueue.items.find(
      item => item.id === "WORK-4"
    ).status,
    "Completed"
  );

  assert.strictEqual(
    result.suppressed.length,
    1
  );

  const archive =
    runtime.archiveClosedWork();

  assert.strictEqual(
    archive.archived,
    3
  );

  assert.strictEqual(
    workQueue.items.length,
    1
  );

  const status =
    runtime.persistStatus();

  assert.ok(
    status.metrics.workItemsCompleted >= 0,
    "Runtime metrics initialized."
  );

  assert.strictEqual(
    status.metrics.workItemsFailed,
    1
  );

  assert.strictEqual(
    status.metrics.staleCapabilityWorkSuppressed,
    1
  );

  console.log(JSON.stringify({
    ok: true,
    build: "028",
    tests: {
      taskToWorkItemReconciliation: "PASSED",
      completedWorkClosure: "PASSED",
      failedWorkClosure: "PASSED",
      queuedWorkPreservation: "PASSED",
      staleCapabilitySuppression: "PASSED",
      closedWorkArchiving: "PASSED",
      boundedQueueCompatibility: "PASSED",
      throughputMetrics: "PASSED",
      residentRuntimeCompatibility: "PASSED"
    },
    reconciliation: result,
    archive,
    runtimeMetrics:
      status.metrics,
    remainingWorkItems:
      workQueue.items
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

