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

const ENGINEERING_ACTIONS = new Set([
  "ENGINEERING_IMPROVEMENT",
  "ENGINEERING_ANALYZE",
  "ENGINEERING_PLAN",
  "ENGINEERING_IMPLEMENT",
  "ENGINEERING_VALIDATE",
  "ENGINEERING_REPORT",
  
]);

function safePublish(eventName, payload = {}) {
  try {
    if (typeof eventBus.publish === "function") return eventBus.publish(eventName, payload);
    if (typeof eventBus.emitEvent === "function") return eventBus.emitEvent(eventName, payload);
    return eventBus.emit(eventName, payload);
  } catch (err) {
    log("ExecutionService", "Event publish", "Failed", err.message);
    return null;
  }
}

function getPlan(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};

  return {
    ok: plan.ok !== false,
    intent: plan.intent || payload.intent || task.intent || "UNKNOWN_INTENT",
    workflow: plan.workflow || payload.workflow || task.workflow || "UNKNOWN_WORKFLOW",
    provider: plan.provider || payload.provider || task.provider || "UNKNOWN",
    system: plan.system || payload.system || task.system || plan.provider || payload.provider || task.provider || "UNKNOWN",
    connector: plan.connector || payload.connector || task.connector || plan.provider || payload.provider || task.provider || "UNKNOWN",
    department: plan.department || payload.department || task.department || plan.provider || payload.provider || task.provider || "UNKNOWN",
    action: plan.action || payload.action || task.action || task.type || "UNKNOWN_ACTION",
    objective: plan.objective || payload.objective || payload.command || task.objective || task.title || "",
    originalCommand: plan.originalCommand || payload.command || task.command || "",
    steps: Array.isArray(plan.steps) ? plan.steps : []
  };
}

function normalizeTask(task = {}) {
  const payload = task.payload || {};
  const plan = getPlan(task);

  let action = plan.action;
  let provider = plan.provider;
  let connector = plan.connector;

  if (ENGINEERING_ACTIONS.has(action)) {
    provider = "MILES";
    connector = "MILES";
    plan.provider = "MILES";
    plan.system = "MILES";
    plan.connector = "MILES";
    plan.department = "MILES";
  }

  return {
    ...task,
    type: task.type || action,
    action,
    intent: plan.intent,
    workflow: plan.workflow,
    provider,
    system: plan.system,
    connector,
    department: plan.department,
    payload: {
      ...payload,
      provider,
      system: plan.system,
      connector,
      department: plan.department,
      action,
      intent: plan.intent,
      workflow: plan.workflow,
      objective: plan.objective,
      originalCommand: plan.originalCommand,
      plan
    }
  };
}

function classifyFailure(error) {
  const message = String(error?.message || error || "").toLowerCase();

  if (/execution_plan_invalid|invalid execution plan/.test(message)) {
    return {
      type: "EXECUTION_PLAN_INVALID",
      retryable: false,
      safeRepair: true,
      recommendedAction: "Repair planner output before retrying"
    };
  }

  if (/connector not found|does not implement execute|missing execute/.test(message)) {
    return {
      type: "MISSING_CAPABILITY",
      retryable: false,
      safeRepair: true,
      recommendedAction: "Register missing provider or connector"
    };
  }

  if (/timeout|navigation|browser|page|selector/.test(message)) {
    return {
      type: "TRANSIENT_FAILURE",
      retryable: true,
      safeRepair: true,
      recommendedAction: "Retry once and escalate if repeated"
    };
  }

  if (/auth|credential|unauthorized|forbidden/.test(message)) {
    return {
      type: "AUTH_FAILURE",
      retryable: false,
      safeRepair: false,
      recommendedAction: "Credential review required"
    };
  }

  if (/approval|authority|not allowed/.test(message)) {
    return {
      type: "GOVERNANCE_BLOCK",
      retryable: false,
      safeRepair: false,
      recommendedAction: "Route to approval queue"
    };
  }

  return {
    type: "UNKNOWN_FAILURE",
    retryable: false,
    safeRepair: true,
    recommendedAction: "Manual classification required"
  };
}

class ExecutionService {
  async execute(task) {
    if (!task) {
      return { ok: false, message: "No task provided" };
    }

    const enrichedTask = normalizeTask(task);
    const plan = enrichedTask.payload.plan;

    const provider = enrichedTask.provider || plan.provider;
    const connectorName = enrichedTask.connector || plan.connector;
    const action = enrichedTask.action || plan.action;

    if (!provider || provider === "UNKNOWN" || !action || action === "UNKNOWN_ACTION") {
      return this.handleFailure(
        enrichedTask,
        new Error("EXECUTION_PLAN_INVALID: Missing provider or action"),
        provider || "UNKNOWN",
        action || "UNKNOWN_ACTION"
      );
    }

    log("ExecutionService", action, "Dispatching", `${provider}:${connectorName}`);

    const authority = requiresApproval(provider, action);

    if (!authority.allowed) {
      taskQueue.update(enrichedTask.id, {
        status: "AWAITING_APPROVAL",
        provider,
        connector: connectorName,
        action,
        authority
      });

      safePublish("TASK_AWAITING_APPROVAL", {
        task: enrichedTask,
        authority,
        provider,
        connector: connectorName,
        action
      });

      return {
        ok: false,
        status: "AWAITING_APPROVAL",
        provider,
        connector: connectorName,
        action,
        authority
      };
    }

    if (INTERNAL_TASKS.has(action) && !ENGINEERING_ACTIONS.has(action)) {
      return this.executeInternalTask(enrichedTask, provider, action);
    }

    return this.executeConnectorTask(enrichedTask, provider, connectorName, action);
  }

  async executeInternalTask(task, provider = "Engineering", action = "INTERNAL_TASK") {
    const plan = task.payload?.plan || {};

    const result = {
      ok: true,
      internal: true,
      provider,
      action,
      intent: plan.intent,
      workflow: plan.workflow,
      message: "Internal MILES system task executed.",
      steps: plan.steps || [],
      completedAt: new Date().toISOString()
    };

    taskQueue.update(task.id, {
      status: "COMPLETED",
      provider,
      connector: "INTERNAL",
      action,
      result
    });

    memory.remember("execution:last_result", task.id, result);

    safePublish("TASK_COMPLETED", {
      task,
      internal: true,
      result,
      provider,
      connector: "INTERNAL",
      action
    });

    log("ExecutionService", action, "Completed", `Internal:${provider}`);

    return result;
  }

  async executeConnectorTask(task, provider, connectorName, action) {
    if (!connectorName || connectorName === "UNKNOWN") {
      return this.handleFailure(
        task,
        new Error("EXECUTION_PLAN_INVALID: Missing connector"),
        provider,
        action
      );
    }

    const connector = connectorManager.get(connectorName);

    if (!connector) {
      return this.handleFailure(
        task,
        new Error(`Connector not found: ${connectorName}`),
        provider,
        action
      );
    }

    if (typeof connector.execute !== "function") {
      return this.handleFailure(
        task,
        new Error(`Connector missing execute(): ${connectorName}`),
        provider,
        action
      );
    }

    try {
      taskQueue.update(task.id, {
        status: "RUNNING",
        provider,
        connector: connectorName,
        action
      });

      safePublish("TASK_STARTED", {
        task,
        provider,
        connector: connectorName,
        action
      });

      log("ExecutionService", action, "Running", connectorName);

      const result = await connector.execute(task);

      const normalizedResult = {
        ok: true,
        status: "COMPLETED",
        provider,
        action,
        connector: connectorName,
        result,
        completedAt: new Date().toISOString()
      };

      taskQueue.update(task.id, {
        status: "COMPLETED",
        provider,
        connector: connectorName,
        action,
        result: normalizedResult
      });

      memory.remember("execution:last_result", task.id, normalizedResult);

      safePublish("TASK_COMPLETED", {
        task,
        result: normalizedResult,
        provider,
        connector: connectorName,
        action
      });

      log("ExecutionService", action, "Completed", connectorName);

      return normalizedResult;
    } catch (error) {
      return this.handleFailure(task, error, provider, action);
    }
  }

  handleFailure(task, error, provider = "UNKNOWN", action = "UNKNOWN") {
    const failure = classifyFailure(error);

    const result = {
      ok: false,
      status: "FAILED",
      provider,
      action,
      error: error.message || String(error),
      failure,
      retryable: failure.retryable,
      createdAt: new Date().toISOString()
    };

    taskQueue.update(task.id, {
      status: "FAILED",
      provider,
      action,
      error: result.error,
      failure,
      retryable: failure.retryable,
      result
    });

    memory.remember("execution:last_result", task.id, result);

    safePublish("TASK_FAILED", {
      task,
      provider,
      action,
      failure
    });

    log("ExecutionService", action, "Failed", provider);

    return result;
  }

  async runNext() {
    const queued = taskQueue.list("QUEUED");

    if (!queued.length) {
      return { ok: true, message: "No queued tasks" };
    }

    const sorted = queued.sort((a, b) => {
      const ap = Number(a.priority || 99);
      const bp = Number(b.priority || 99);
      return ap - bp;
    });

    const task = sorted[0];
    const normalizedTask = normalizeTask(task);

    log(
      "ExecutionService",
      normalizedTask.action || normalizedTask.type,
      "Dequeued",
      normalizedTask.provider || "UNKNOWN"
    );

    return this.execute(normalizedTask);
  }
}

module.exports = new ExecutionService();