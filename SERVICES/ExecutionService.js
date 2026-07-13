"use strict";

const taskQueue = require("../CORE/TaskQueue");
const connectorManager = require("../CORE/ConnectorManager");
const eventBus = require("../CORE/EventBus");
const { requiresApproval } = require("../CORE/authority");
const { log } = require("../CORE/logger");
const memory = require("./MemoryService");
const workforceExecutionService = require("./WorkforceExecutionService");

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
  "ENGINEERING_REPORT"
]);

function safePublish(eventName, payload = {}) {
  try {
    if (typeof eventBus.publish === "function") {
      return eventBus.publish(eventName, payload);
    }

    if (typeof eventBus.emitEvent === "function") {
      return eventBus.emitEvent(eventName, payload);
    }

    if (typeof eventBus.emit === "function") {
      return eventBus.emit(eventName, payload);
    }

    return null;
  } catch (err) {
    log(
      "ExecutionService",
      "Event publish",
      "Failed",
      err.message
    );

    return null;
  }
}

function getPlan(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};

  return {
    ok: plan.ok !== false,

    intent:
      plan.intent ||
      payload.intent ||
      task.intent ||
      "UNKNOWN_INTENT",

    workflow:
      plan.workflow ||
      payload.workflow ||
      task.workflow ||
      "UNKNOWN_WORKFLOW",

    provider:
      plan.provider ||
      payload.provider ||
      task.provider ||
      "UNKNOWN",

    system:
      plan.system ||
      payload.system ||
      task.system ||
      plan.provider ||
      payload.provider ||
      task.provider ||
      "UNKNOWN",

    connector:
      plan.connector ||
      payload.connector ||
      task.connector ||
      plan.provider ||
      payload.provider ||
      task.provider ||
      "UNKNOWN",

    department:
      plan.department ||
      payload.department ||
      task.department ||
      plan.provider ||
      payload.provider ||
      task.provider ||
      "UNKNOWN",

    action:
      plan.action ||
      payload.action ||
      task.action ||
      task.type ||
      "UNKNOWN_ACTION",

    objective:
      plan.objective ||
      payload.objective ||
      payload.command ||
      task.objective ||
      task.title ||
      "",

    originalCommand:
      plan.originalCommand ||
      payload.command ||
      task.command ||
      "",

    steps:
      Array.isArray(plan.steps)
        ? plan.steps
        : []
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

    type:
      task.type ||
      action,

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

function isWorkforceTask(task = {}) {
  const type =
    String(
      task.type ||
      task.payload?.type ||
      ""
    ).toUpperCase();

  return type === "WORKFORCE_STEP";
}

function classifyFailure(error) {
  const message =
    String(
      error?.message ||
      error ||
      ""
    ).toLowerCase();

  if (
    /execution_plan_invalid|invalid execution plan/.test(
      message
    )
  ) {
    return {
      type: "EXECUTION_PLAN_INVALID",
      retryable: false,
      safeRepair: true,
      recommendedAction:
        "Repair planner output before retrying"
    };
  }

  if (
    /connector not found|does not implement execute|missing execute/.test(
      message
    )
  ) {
    return {
      type: "MISSING_CAPABILITY",
      retryable: false,
      safeRepair: true,
      recommendedAction:
        "Register missing provider or connector"
    };
  }

  if (
    /timeout|navigation|browser|page|selector/.test(
      message
    )
  ) {
    return {
      type: "TRANSIENT_FAILURE",
      retryable: true,
      safeRepair: true,
      recommendedAction:
        "Retry once and escalate if repeated"
    };
  }

  if (
    /auth|credential|unauthorized|forbidden/.test(
      message
    )
  ) {
    return {
      type: "AUTH_FAILURE",
      retryable: false,
      safeRepair: false,
      recommendedAction:
        "Credential review required"
    };
  }

  if (
    /approval|authority|not allowed/.test(
      message
    )
  ) {
    return {
      type: "GOVERNANCE_BLOCK",
      retryable: false,
      safeRepair: false,
      recommendedAction:
        "Route to approval queue"
    };
  }

  return {
    type: "UNKNOWN_FAILURE",
    retryable: false,
    safeRepair: true,
    recommendedAction:
      "Manual classification required"
  };
}

class ExecutionService {
  async execute(task) {
    if (!task) {
      return {
        ok: false,
        message: "No task provided"
      };
    }

    const enrichedTask = normalizeTask(task);

    /*
      WORKFORCE_STEP tasks do not execute through ConnectorManager.

      WorkforceExecutionService owns:
      - workforce execution
      - provider routing
      - provider automation
      - decision evaluation
      - execution planning
      - verification
      - evidence persistence
    */
    if (isWorkforceTask(enrichedTask)) {
      return this.executeWorkforceTask(enrichedTask);
    }

    const plan =
      enrichedTask.payload.plan ||
      {};

    const provider =
      enrichedTask.provider ||
      plan.provider;

    const connectorName =
      enrichedTask.connector ||
      plan.connector;

    const action =
      enrichedTask.action ||
      plan.action;

    if (
      !provider ||
      provider === "UNKNOWN" ||
      !action ||
      action === "UNKNOWN_ACTION"
    ) {
      return this.handleFailure(
        enrichedTask,
        new Error(
          "EXECUTION_PLAN_INVALID: Missing provider or action"
        ),
        provider || "UNKNOWN",
        action || "UNKNOWN_ACTION"
      );
    }

    log(
      "ExecutionService",
      action,
      "Dispatching",
      `${provider}:${connectorName}`
    );

    const authority =
      requiresApproval(
        provider,
        action
      );

    if (!authority.allowed) {
      taskQueue.update(
        enrichedTask.id,
        {
          status: "AWAITING_APPROVAL",
          provider,
          connector: connectorName,
          action,
          authority
        }
      );

      safePublish(
        "TASK_AWAITING_APPROVAL",
        {
          task: enrichedTask,
          authority,
          provider,
          connector: connectorName,
          action
        }
      );

      return {
        ok: false,
        status: "AWAITING_APPROVAL",
        provider,
        connector: connectorName,
        action,
        authority
      };
    }

    if (
      INTERNAL_TASKS.has(action) &&
      !ENGINEERING_ACTIONS.has(action)
    ) {
      return this.executeInternalTask(
        enrichedTask,
        provider,
        action
      );
    }

    return this.executeConnectorTask(
      enrichedTask,
      provider,
      connectorName,
      action
    );
  }

  async executeWorkforceTask(task) {
    const payload =
      task.payload ||
      {};

    const provider =
      payload.provider &&
      payload.provider !== "UNKNOWN"
        ? payload.provider
        : null;

    const department =
      payload.department &&
      payload.department !== "UNKNOWN"
        ? payload.department
        : "Workforce";

    const action =
      payload.action ||
      task.action ||
      "executeWorkforceStep";

    const authority =
      requiresApproval(
        provider ||
        department ||
        "WORKFORCE",
        action
      );

    if (!authority.allowed) {
      taskQueue.update(
        task.id,
        {
          status: "AWAITING_APPROVAL",
          provider,
          connector: "WORKFORCE",
          department,
          action,
          authority
        }
      );

      safePublish(
        "TASK_AWAITING_APPROVAL",
        {
          task,
          authority,
          provider,
          connector: "WORKFORCE",
          department,
          action
        }
      );

      return {
        ok: false,
        status: "AWAITING_APPROVAL",
        provider,
        connector: "WORKFORCE",
        department,
        action,
        authority
      };
    }

    try {
      taskQueue.update(
        task.id,
        {
          status: "RUNNING",
          provider,
          connector: "WORKFORCE",
          department,
          action
        }
      );

      safePublish(
        "TASK_STARTED",
        {
          task,
          provider,
          connector: "WORKFORCE",
          department,
          action
        }
      );

      log(
        "ExecutionService",
        action,
        "Running",
        "WorkforceExecutionService"
      );

      const workforceResult =
        await workforceExecutionService.executeAndVerify(
          task
        );

      const verification =
        workforceResult?.verification ||
        {};

      const awaitingApproval =
        workforceResult?.status ===
          "AWAITING_CEO_APPROVAL" ||
        verification.status ===
          "AWAITING_CEO_APPROVAL";

      const verified =
        workforceResult?.ok === true ||
        verification.verified === true;

      const finalStatus =
        awaitingApproval
          ? "AWAITING_APPROVAL"
          : verified
            ? "COMPLETED"
            : "FAILED";

      const normalizedResult = {
        ok: verified,
        status: finalStatus,
        provider,
        connector: "WORKFORCE",
        department,
        action,
        workforceResult,
        completedAt:
          new Date().toISOString()
      };

      taskQueue.update(
        task.id,
        {
          status: finalStatus,
          provider,
          connector: "WORKFORCE",
          department,
          action,
          error:
            finalStatus === "FAILED"
              ? (
                  workforceResult?.result?.output
                    ?.recommendation ||
                  workforceResult?.status ||
                  "Workforce verification failed"
                )
              : null,
          result: normalizedResult
        }
      );

      memory.remember(
        "execution:last_result",
        task.id,
        normalizedResult
      );

      if (
        operationalMemory &&
        typeof operationalMemory.remember === "function"
      ) {
        try {
          operationalMemory.remember(
            "workforce_execution",
            task.id,
            normalizedResult
          );
        } catch {}
      }

      if (finalStatus === "COMPLETED") {
        safePublish(
          "TASK_COMPLETED",
          {
            task,
            result: normalizedResult,
            provider,
            connector: "WORKFORCE",
            department,
            action
          }
        );

        log(
          "ExecutionService",
          action,
          "Completed",
          "WorkforceExecutionService"
        );
      } else if (
        finalStatus === "AWAITING_APPROVAL"
      ) {
        safePublish(
          "TASK_AWAITING_APPROVAL",
          {
            task,
            result: normalizedResult,
            provider,
            connector: "WORKFORCE",
            department,
            action
          }
        );

        log(
          "ExecutionService",
          action,
          "Awaiting Approval",
          "WorkforceExecutionService"
        );
      } else {
        safePublish(
          "TASK_FAILED",
          {
            task,
            result: normalizedResult,
            provider,
            connector: "WORKFORCE",
            department,
            action
          }
        );

        log(
          "ExecutionService",
          action,
          "Failed",
          "WorkforceExecutionService"
        );
      }

      return normalizedResult;
    } catch (error) {
      return this.handleFailure(
        task,
        error,
        provider || "WORKFORCE",
        action
      );
    }
  }

  async executeInternalTask(
    task,
    provider = "Engineering",
    action = "INTERNAL_TASK"
  ) {
    const plan =
      task.payload?.plan ||
      {};

    const result = {
      ok: true,
      internal: true,
      provider,
      action,
      intent: plan.intent,
      workflow: plan.workflow,
      message:
        "Internal MILES system task executed.",
      steps: plan.steps || [],
      completedAt:
        new Date().toISOString()
    };

    taskQueue.update(
      task.id,
      {
        status: "COMPLETED",
        provider,
        connector: "INTERNAL",
        action,
        result
      }
    );

    memory.remember(
      "execution:last_result",
      task.id,
      result
    );

    safePublish(
      "TASK_COMPLETED",
      {
        task,
        internal: true,
        result,
        provider,
        connector: "INTERNAL",
        action
      }
    );

    log(
      "ExecutionService",
      action,
      "Completed",
      `Internal:${provider}`
    );

    return result;
  }

  async executeConnectorTask(
    task,
    provider,
    connectorName,
    action
  ) {
    if (
      !connectorName ||
      connectorName === "UNKNOWN"
    ) {
      return this.handleFailure(
        task,
        new Error(
          "EXECUTION_PLAN_INVALID: Missing connector"
        ),
        provider,
        action
      );
    }

    const connector =
      connectorManager.get(
        connectorName
      );

    if (!connector) {
      return this.handleFailure(
        task,
        new Error(
          `Connector not found: ${connectorName}`
        ),
        provider,
        action
      );
    }

    if (
      typeof connector.execute !== "function"
    ) {
      return this.handleFailure(
        task,
        new Error(
          `Connector missing execute(): ${connectorName}`
        ),
        provider,
        action
      );
    }

    try {
      taskQueue.update(
        task.id,
        {
          status: "RUNNING",
          provider,
          connector: connectorName,
          action
        }
      );

      safePublish(
        "TASK_STARTED",
        {
          task,
          provider,
          connector: connectorName,
          action
        }
      );

      log(
        "ExecutionService",
        action,
        "Running",
        connectorName
      );

      const result =
        await connector.execute(
          task
        );

      const succeeded =
        result?.ok !== false;

      const normalizedResult = {
        ok: succeeded,
        status:
          succeeded
            ? "COMPLETED"
            : "FAILED",
        provider,
        action,
        connector: connectorName,
        result,
        completedAt:
          new Date().toISOString()
      };

      taskQueue.update(
        task.id,
        {
          status:
            normalizedResult.status,
          provider,
          connector: connectorName,
          action,
          error:
            succeeded
              ? null
              : (
                  result?.error ||
                  result?.message ||
                  "Connector execution returned failure"
                ),
          result: normalizedResult
        }
      );

      memory.remember(
        "execution:last_result",
        task.id,
        normalizedResult
      );

      if (succeeded) {
        safePublish(
          "TASK_COMPLETED",
          {
            task,
            result: normalizedResult,
            provider,
            connector: connectorName,
            action
          }
        );

        log(
          "ExecutionService",
          action,
          "Completed",
          connectorName
        );
      } else {
        safePublish(
          "TASK_FAILED",
          {
            task,
            result: normalizedResult,
            provider,
            connector: connectorName,
            action
          }
        );

        log(
          "ExecutionService",
          action,
          "Failed",
          connectorName
        );
      }

      return normalizedResult;
    } catch (error) {
      return this.handleFailure(
        task,
        error,
        provider,
        action
      );
    }
  }

  handleFailure(
    task,
    error,
    provider = "UNKNOWN",
    action = "UNKNOWN"
  ) {
    const failure =
      classifyFailure(error);

    const result = {
      ok: false,
      status: "FAILED",
      provider,
      action,
      error:
        error.message ||
        String(error),
      failure,
      retryable:
        failure.retryable,
      createdAt:
        new Date().toISOString()
    };

    taskQueue.update(
      task.id,
      {
        status: "FAILED",
        provider,
        action,
        error: result.error,
        failure,
        retryable:
          failure.retryable,
        result
      }
    );

    memory.remember(
      "execution:last_result",
      task.id,
      result
    );

    safePublish(
      "TASK_FAILED",
      {
        task,
        provider,
        action,
        failure
      }
    );

    log(
      "ExecutionService",
      action,
      "Failed",
      provider
    );

    return result;
  }

  async runNext() {
    const queued =
      taskQueue.list("QUEUED");

    if (!queued.length) {
      return {
        ok: true,
        message:
          "No queued tasks"
      };
    }

    const sorted =
      queued.sort(
        (a, b) => {
          const ap =
            Number(
              a.priority ||
              99
            );

          const bp =
            Number(
              b.priority ||
              99
            );

          return ap - bp;
        }
      );

    const task =
      sorted[0];

    const normalizedTask =
      normalizeTask(task);

    log(
      "ExecutionService",
      normalizedTask.action ||
        normalizedTask.type,
      "Dequeued",
      normalizedTask.provider ||
        "UNKNOWN"
    );

    return this.execute(
      normalizedTask
    );
  }
}

module.exports =
  new ExecutionService();
