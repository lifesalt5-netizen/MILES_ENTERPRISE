"use strict";

const fs = require("fs");
const path = require("path");

class ExecutiveResponseService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.businessQueueFile =
      options.businessQueueFile ||
      path.join(this.rootDir, "state", "business_operations_queue.json");

    this.taskQueueFile =
      options.taskQueueFile ||
      path.join(this.rootDir, "DATA", "runtime", "task_queue.json");
  }

  readJson(file, fallback) {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  }

  getOperation(operationId) {
    const queue = this.readJson(this.businessQueueFile, { operations: [] });
    const operations = Array.isArray(queue.operations) ? queue.operations : [];

    return operations.find((op) => op.id === operationId) || null;
  }

  getMatchingTasks(operation) {
    if (!operation) return [];

    const tasks = this.readJson(this.taskQueueFile, []);
    if (!Array.isArray(tasks)) return [];

    return tasks.filter((task) => {
      const payload = task.payload || {};
      const plan = payload.plan || task.plan || {};

      return (
        payload.operationId === operation.id ||
        payload.sourceOperationId === operation.id ||
        payload.businessOperationId === operation.id ||
        payload.command === operation.command ||
        payload.objective === operation.command ||
        plan.originalCommand === operation.command ||
        plan.objective === operation.command ||
        task.title === operation.title ||
        task.type === operation.action
      );
    });
  }

  summarizeTask(task) {
    if (!task) return null;

    const payload = task.payload || {};
    const result = task.result || payload.result || null;

    return {
      id: task.id,
      status: task.status,
      type: task.type,
      provider:
        task.provider ||
        payload.provider ||
        payload.system ||
        payload.connector ||
        "UNKNOWN",
      connector:
        task.connector ||
        payload.connector ||
        payload.system ||
        payload.provider ||
        "UNKNOWN",
      action:
        task.action ||
        payload.action ||
        payload.intent ||
        task.type ||
        "UNKNOWN_ACTION",
      priority: task.priority,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      result
    };
  }

  buildExecutiveMessage(operation, tasks) {
    if (!operation) {
      return "Miles could not find that operation.";
    }

    if (!tasks.length) {
      return [
        "Accepted.",
        "",
        "Miles planned the command and placed it into the business operations queue.",
        "",
        `Provider: ${operation.provider || "UNKNOWN"}`,
        `Action: ${operation.action || operation.type || "UNKNOWN"}`,
        `Status: ${operation.status || "UNKNOWN"}`,
        "",
        "Waiting for the Business Bridge and ExecutionService to pick up the task."
      ].join("\n");
    }

    const latest = tasks[0];
    const status = latest.status || "UNKNOWN";
    const action = latest.action || latest.type || "UNKNOWN_ACTION";
    const provider = latest.provider || "UNKNOWN";

    if (status === "COMPLETED") {
      return [
        "Complete.",
        "",
        `Provider: ${provider}`,
        `Action: ${action}`,
        "",
        "Miles completed the task and recorded the result.",
        "",
        "Result:",
        JSON.stringify(latest.result || {}, null, 2)
      ].join("\n");
    }

    if (status === "FAILED") {
      return [
        "Failed.",
        "",
        `Provider: ${provider}`,
        `Action: ${action}`,
        "",
        "Miles attempted the task but it failed.",
        "",
        "Failure:",
        JSON.stringify(latest.result || {}, null, 2)
      ].join("\n");
    }

    if (status === "RUNNING") {
      return [
        "Executing.",
        "",
        `Provider: ${provider}`,
        `Action: ${action}`,
        "",
        "Miles is currently running this task."
      ].join("\n");
    }

    if (status === "AWAITING_APPROVAL") {
      return [
        "Waiting for CEO approval.",
        "",
        `Provider: ${provider}`,
        `Action: ${action}`,
        "",
        "Miles cannot continue until approval is granted."
      ].join("\n");
    }

    return [
      "Queued.",
      "",
      `Provider: ${provider}`,
      `Action: ${action}`,
      `Status: ${status}`,
      "",
      "Miles has the task in the execution queue."
    ].join("\n");
  }

  getResponse(operationId) {
    const operation = this.getOperation(operationId);
    const tasks = this.getMatchingTasks(operation).map((task) =>
      this.summarizeTask(task)
    );

    tasks.sort((a, b) => {
      const ad = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bd = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bd - ad;
    });

    const latestTask = tasks[0] || null;

    return {
      ok: Boolean(operation),
      operationId,
      operation,
      latestTask,
      tasks,
      status: latestTask ? latestTask.status : operation ? operation.status : "NOT_FOUND",
      provider:
        latestTask?.provider ||
        operation?.provider ||
        "UNKNOWN",
      action:
        latestTask?.action ||
        operation?.action ||
        operation?.type ||
        "UNKNOWN",
      message: this.buildExecutiveMessage(operation, tasks),
      checkedAt: new Date().toISOString()
    };
  }
}

module.exports = ExecutiveResponseService;