"use strict";

const WorkQueueService = require("./WorkQueueService");
const taskQueue = require("../CORE/TaskQueue");

function now() {
  return new Date().toISOString();
}

class WorkQueueReconciliationService {
  constructor(options = {}) {
    this.workQueue = options.workQueue || new WorkQueueService();
    this.taskQueue = options.taskQueue || taskQueue;
  }

  getWorkItems() {
    if (this.workQueue && typeof this.workQueue.load === "function") {
      this.workQueue.load();
    }

    if (this.workQueue && typeof this.workQueue.getAll === "function") {
      return this.workQueue.getAll() || [];
    }

    if (this.workQueue && typeof this.workQueue.list === "function") {
      return this.workQueue.list() || [];
    }

    return [];
  }

  getCoreTasks() {
    if (!this.taskQueue || typeof this.taskQueue.list !== "function") {
      return [];
    }

    return this.taskQueue.list() || [];
  }

  storedTaskIds(item = {}) {
    const workflowResult = item.metadata?.workflowResult || {};
    const queuedTasks = Array.isArray(workflowResult.queuedTasks)
      ? workflowResult.queuedTasks
      : [];

    return queuedTasks
      .map(task => (typeof task === "string" ? task : task?.id))
      .filter(Boolean)
      .map(String);
  }

  updateStatus(id, status, metadata, reason) {
    if (!this.workQueue || typeof this.workQueue.updateStatus !== "function") {
      throw new Error("WorkQueueService.updateStatus is unavailable.");
    }

    return this.workQueue.updateStatus(id, status, metadata, reason);
  }

  reconcile() {
    const workItems = this.getWorkItems();
    const coreTasks = this.getCoreTasks();
    const coreById = new Map(coreTasks.map(task => [String(task.id), task]));

    const summary = {
      ok: true,
      generatedAt: now(),
      examinedQueued: 0,
      resetToPending: 0,
      markedCompleted: 0,
      markedAwaitingApproval: 0,
      keptQueued: 0,
      unchanged: 0,
      items: []
    };

    for (const item of workItems) {
      if (!item || String(item.status || "").toUpperCase() !== "QUEUED") {
        continue;
      }

      summary.examinedQueued += 1;

      const workflowResult = item.metadata?.workflowResult || {};
      const workPackageId =
        workflowResult?.workPackage?.id ||
        workflowResult?.workPackageId ||
        item.metadata?.workPackageId ||
        null;

      const storedIds = this.storedTaskIds(item);
      const surviving = storedIds
        .map(id => coreById.get(id))
        .filter(Boolean);

      if (surviving.length === 0) {
        this.updateStatus(
          item.id,
          "Pending",
          {
            ...(item.metadata || {}),
            reconciledAt: now(),
            reconciledReason: "Queued WorkQueue item has no surviving CORE tasks.",
            staleWorkPackageId: workPackageId,
            previousWorkflowResult: workflowResult,
            workflowResult: null,
            workPackageId: null
          },
          "Recovered stale queued WorkQueue item with no surviving CORE task; reset to Pending for autonomous regeneration."
        );

        summary.resetToPending += 1;
        summary.items.push({ id: item.id, from: "Queued", to: "Pending", reason: "NO_SURVIVING_CORE_TASK" });
        continue;
      }

      const statuses = surviving.map(task => String(task.status || "UNKNOWN").toUpperCase());

      if (statuses.every(status => status === "COMPLETED")) {
        if (typeof this.workQueue.markCompleted === "function") {
          this.workQueue.markCompleted(item.id, {
            reconciledAt: now(),
            reconciledReason: "All surviving CORE tasks completed.",
            coreTaskIds: surviving.map(task => task.id)
          });
        } else {
          this.updateStatus(
            item.id,
            "Completed",
            {
              ...(item.metadata || {}),
              reconciledAt: now(),
              reconciledReason: "All surviving CORE tasks completed.",
              coreTaskIds: surviving.map(task => task.id)
            },
            "Reconciled WorkQueue item from CORE completion state."
          );
        }

        summary.markedCompleted += 1;
        summary.items.push({ id: item.id, from: "Queued", to: "Completed", reason: "CORE_COMPLETED" });
        continue;
      }

      if (statuses.some(status => status === "AWAITING_APPROVAL")) {
        if (typeof this.workQueue.markAwaitingApproval === "function") {
          this.workQueue.markAwaitingApproval(item.id, {
            reconciledAt: now(),
            reconciledReason: "Surviving CORE task awaits approval.",
            coreTaskIds: surviving.map(task => task.id)
          });
        } else {
          this.updateStatus(
            item.id,
            "Awaiting Approval",
            {
              ...(item.metadata || {}),
              reconciledAt: now(),
              reconciledReason: "Surviving CORE task awaits approval.",
              coreTaskIds: surviving.map(task => task.id)
            },
            "Reconciled WorkQueue item to approval state from CORE task state."
          );
        }

        summary.markedAwaitingApproval += 1;
        summary.items.push({ id: item.id, from: "Queued", to: "Awaiting Approval", reason: "CORE_AWAITING_APPROVAL" });
        continue;
      }

      const activeStatuses = new Set(["QUEUED", "RUNNING", "IN_PROGRESS", "PENDING"]);
      if (statuses.some(status => activeStatuses.has(status))) {
        summary.keptQueued += 1;
        summary.items.push({ id: item.id, from: "Queued", to: "Queued", reason: "ACTIVE_CORE_TASK" });
        continue;
      }

      this.updateStatus(
        item.id,
        "Pending",
        {
          ...(item.metadata || {}),
          reconciledAt: now(),
          reconciledReason: `Surviving CORE tasks are terminal/non-executable: ${statuses.join(",")}`,
          previousWorkflowResult: workflowResult,
          workflowResult: null,
          workPackageId: null,
          previousCoreTaskIds: surviving.map(task => task.id),
          previousCoreTaskStatuses: statuses
        },
        "Recovered queued WorkQueue item whose surviving CORE tasks are no longer executable; reset to Pending for autonomous regeneration."
      );

      summary.resetToPending += 1;
      summary.items.push({ id: item.id, from: "Queued", to: "Pending", reason: "NON_EXECUTABLE_CORE_STATE", statuses });
    }

    return summary;
  }
}

module.exports = WorkQueueReconciliationService;
module.exports.WorkQueueReconciliationService = WorkQueueReconciliationService;
