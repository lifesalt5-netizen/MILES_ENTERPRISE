"use strict";

const taskQueue = require("../CORE/TaskQueue");
const connectorManager = require("../CORE/ConnectorManager");
const eventBus = require("../CORE/EventBus");
const { requiresApproval } = require("../CORE/authority");
const { log } = require("../CORE/logger");
const memory = require("./MemoryService");

let operationalMemory = null;

try {
  operationalMemory = require("./Memory/OperationalMemoryService");
} catch {
  operationalMemory = null;
}

const INTERNAL_TASKS = new Set([
  "SELF_BUILD",
  "SELF_TEST",
  "SELF_ANALYZE",
  "HEALTH_CHECK",
  "BACKUP",
  "RESTART_RUNTIME",
  "GIT_COMMIT",
  "BUILD_CONNECTOR",
  "BUILD_PLAN",
  "ANALYZE_PROJECT"
]);

class ExecutionService {
  async execute(task) {
    if (!task) {
      return { ok: false, message: "No task provided" };
    }

    const system = task.payload?.system || task.payload?.connector || task.type;
    const action = task.payload?.action || task.type;
    const authority = requiresApproval(system, action);

    if (!authority.allowed) {
      taskQueue.update(task.id, {
        status: "AWAITING_APPROVAL",
        authority
      });

      eventBus.publish("TASK_AWAITING_APPROVAL", { task, authority });
      log("ExecutionService", action, "Awaiting Approval", authority.approval);

      return {
        ok: false,
        status: "AWAITING_APPROVAL",
        authority
      };
    }

    if (task.type === "WORKFORCE_STEP") {
      return this.executeWorkforceStep(task);
    }

    if (INTERNAL_TASKS.has(task.type)) {
      return this.executeInternalTask(task);
    }

    return this.executeConnectorTask(task, system, action);
  }

  async executeWorkforceStep(task) {
    const workforceExecution = require("./WorkforceExecutionService");
    const action = task.payload?.action || task.type;

    try {
      taskQueue.update(task.id, { status: "RUNNING" });
      eventBus.publish("TASK_STARTED", task);
      log("ExecutionService", action, "Started", "WorkforceExecutionService");

      const result = await workforceExecution.executeAndVerify(task);
      const finalStatus = result.status === "COMPLETED" ? "COMPLETED" : result.status || "AWAITING_VERIFICATION";

      taskQueue.update(task.id, {
        status: finalStatus,
        result
      });

      memory.remember("execution:last_result", task.id, result);

      if (operationalMemory && result.result) {
        try {
          operationalMemory.record(result.result);
        } catch (err) {
          log("ExecutionService", "Operational memory record", "Failed", err.message);
        }
      }

      eventBus.publish("TASK_COMPLETED", { task, result });
      log("ExecutionService", action, finalStatus, task.payload?.assignedTo || "Workforce");

      return result;
    } catch (error) {
      taskQueue.update(task.id, { status: "FAILED", error: error.message });
      eventBus.publish("TASK_FAILED", { task, error: error.message });
      log("ExecutionService", action, "Failed", error.message);
      return { ok: false, status: "FAILED", error: error.message };
    }
  }

  async executeInternalTask(task) {
    const action = task.payload?.action || task.type;

    const result = {
      internal: true,
      action: task.type,
      message: "Handled by internal runtime.",
      completedAt: new Date().toISOString()
    };

    taskQueue.update(task.id, {
      status: "COMPLETED",
      result
    });

    eventBus.publish("TASK_COMPLETED", { task, internal: true, result });
    log("ExecutionService", action, "Completed", "Internal Runtime");

    return { ok: true, status: "COMPLETED", result };
  }

  async executeConnectorTask(task, system, action) {
    const connectorName = task.payload?.connector || system;
    const connector = connectorManager.get(connectorName);

    if (!connector) {
      taskQueue.update(task.id, {
        status: "FAILED",
        error: `Connector not found: ${connectorName}`
      });

      log("ExecutionService", action, "Failed", `Connector not found: ${connectorName}`);
      eventBus.publish("TASK_FAILED", { task, error: `Connector not found: ${connectorName}` });

      return {
        ok: false,
        status: "FAILED",
        error: `Connector not found: ${connectorName}`
      };
    }

    if (typeof connector.execute !== "function") {
      taskQueue.update(task.id, {
        status: "FAILED",
        error: `Connector ${connectorName} does not implement execute(task)`
      });

      log("ExecutionService", action, "Failed", `Connector ${connectorName} missing execute(task)`);
      eventBus.publish("TASK_FAILED", { task, error: `Connector ${connectorName} missing execute(task)` });

      return {
        ok: false,
        status: "FAILED",
        error: `Connector ${connectorName} missing execute(task)`
      };
    }

    try {
      taskQueue.update(task.id, { status: "RUNNING" });
      eventBus.publish("TASK_STARTED", task);
      log("ExecutionService", action, "Started", connectorName);

      const result = await connector.execute(task);

      taskQueue.update(task.id, {
        status: "COMPLETED",
        result
      });

      memory.remember("execution:last_result", task.id, result);

      eventBus.publish("TASK_COMPLETED", { task, result });
      log("ExecutionService", action, "Completed", connectorName);

      return {
        ok: true,
        status: "COMPLETED",
        result
      };
    } catch (error) {
      taskQueue.update(task.id, {
        status: "FAILED",
        error: error.message
      });

      eventBus.publish("TASK_FAILED", { task, error: error.message });
      log("ExecutionService", action, "Failed", error.message);

      return {
        ok: false,
        status: "FAILED",
        error: error.message
      };
    }
  }

  async runNext() {
    const queued = taskQueue.list("QUEUED");

    if (!queued.length) {
      return {
        ok: true,
        message: "No queued tasks"
      };
    }

    return this.execute(queued[0]);
  }
}

module.exports = new ExecutionService();
