"use strict";

const capabilityDispatcher =
    require("./CapabilityDispatcherService");
const taskQueue = require("../CORE/TaskQueue");
const connectorManager = require("../CORE/ConnectorManager");
const eventBus = require("../CORE/EventBus");
const { requiresApproval } = require("../CORE/authority");
const { log } = require("../CORE/logger");
const memory = require("./MemoryService");
const workforceExecutionService = require("./WorkforceExecutionService");
const constitutionalGuardian = require("./governance/ConstitutionalGuardianService");
const governanceAudit = require("./governance/GovernanceAuditService");

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

  const taskType = String(
    task.type ||
    payload.type ||
    ""
  ).toUpperCase();

  const existingProvider =
    payload.provider ||
    task.provider ||
    plan.provider;

  const existingAction =
    payload.action ||
    task.action ||
    plan.action ||
    task.type;

  const existingConnector =
    payload.connector ||
    task.connector ||
    plan.connector;

  const existingDepartment =
    payload.department ||
    task.department ||
    plan.department;

  /*
    WORKFORCE_STEP tasks are already routed by WorkflowService.
    Preserve their provider, action, department, and identity exactly.
    WorkforceExecutionService owns the provider execution path.
  */
  if (
    taskType === "WORKFORCE_STEP" &&
    existingProvider &&
    existingProvider !== "UNKNOWN" &&
    existingAction &&
    existingAction !== "UNKNOWN_ACTION"
  ) {
    const preservedPlan = {
      ...plan,
      provider: existingProvider,
      system:
        payload.system ||
        task.system ||
        plan.system ||
        existingProvider,
      connector:
        existingConnector &&
        existingConnector !== "UNKNOWN"
          ? existingConnector
          : "WORKFORCE",
      department:
        existingDepartment &&
        existingDepartment !== "UNKNOWN"
          ? existingDepartment
          : "Workforce",
      action: existingAction
    };

    return {
      ...task,
      capabilityDispatch: {
        ok: true,
        resolved: true,
        mode: "WORKFORCE",
        action: existingAction,
        provider: existingProvider,
        system: preservedPlan.system,
        connector: "WORKFORCE",
        department: preservedPlan.department,
        serviceName: null,
        reason: "Preserved already-routed WORKFORCE_STEP task."
      },
      type: task.type || "WORKFORCE_STEP",
      action: existingAction,
      intent: preservedPlan.intent,
      workflow: preservedPlan.workflow,
      provider: existingProvider,
      system: preservedPlan.system,
      connector: "WORKFORCE",
      department: preservedPlan.department,
      payload: {
        ...payload,
        provider: existingProvider,
        system: preservedPlan.system,
        connector: "WORKFORCE",
        department: preservedPlan.department,
        action: existingAction,
        intent: preservedPlan.intent,
        workflow: preservedPlan.workflow,
        objective: preservedPlan.objective,
        originalCommand: preservedPlan.originalCommand,
        plan: preservedPlan
      }
    };
  }

  const dispatch =
    capabilityDispatcher.resolve(
      {
        ...task,
        action: existingAction,
        provider: existingProvider,
        connector: existingConnector,
        department: existingDepartment,
        payload: {
          ...payload,
          action: existingAction,
          provider: existingProvider,
          connector: existingConnector,
          department: existingDepartment,
          plan
        }
      },
      {
        action: existingAction,
        workflow: plan.workflow,
        capability:
          payload.capability ||
          task.capability ||
          plan.capability,
        provider: existingProvider,
        connector: existingConnector,
        department: existingDepartment,
        plan
      }
    );

  const provider =
    dispatch?.provider ||
    existingProvider ||
    "UNKNOWN";

  const connector =
    dispatch?.connector ||
    existingConnector ||
    provider ||
    "UNKNOWN";

  const department =
    dispatch?.department ||
    existingDepartment ||
    provider ||
    "UNKNOWN";

  const action =
    dispatch?.action ||
    existingAction ||
    "UNKNOWN_ACTION";

  const normalizedPlan = {
    ...plan,
    provider,
    system:
      dispatch?.system ||
      plan.system ||
      provider,
    connector,
    department,
    action,
    capabilityDispatch: dispatch
  };

  return {
    ...task,
    capabilityDispatch: dispatch,
    type: task.type || action,
    action,
    intent: normalizedPlan.intent,
    workflow: normalizedPlan.workflow,
    provider,
    system: normalizedPlan.system,
    connector,
    department,
    payload: {
      ...payload,
      provider,
      system: normalizedPlan.system,
      connector,
      department,
      action,
      intent: normalizedPlan.intent,
      workflow: normalizedPlan.workflow,
      objective: normalizedPlan.objective,
      originalCommand: normalizedPlan.originalCommand,
      plan: normalizedPlan
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

    const guardian =
      constitutionalGuardian.guard(
        enrichedTask,
        {
          actor:
            enrichedTask.actor ||
            enrichedTask.payload?.actor ||
            "MILES",
          role:
            enrichedTask.role ||
            enrichedTask.payload?.role ||
            process.env.MILES_ACTOR_ROLE ||
            "MILES"
        }
      );

    enrichedTask.governance = {
      ...(enrichedTask.governance || {}),
      policy: guardian.policy,
      approval: guardian.approval,
      guardian
    };

    enrichedTask.payload = {
      ...(enrichedTask.payload || {}),
      governance:
        enrichedTask.governance
    };

    if (!guardian.allowed) {
      const blockedStatus =
        guardian.status ===
          "AWAITING_APPROVAL"
          ? "AWAITING_APPROVAL"
          : "BLOCKED";

      taskQueue.update(
        enrichedTask.id,
        {
          status: blockedStatus,
          governance:
            enrichedTask.governance,
          error:
            guardian.reason
        }
      );

      safePublish(
        blockedStatus ===
          "AWAITING_APPROVAL"
          ? "TASK_AWAITING_APPROVAL"
          : "TASK_GOVERNANCE_BLOCKED",
        {
          task: enrichedTask,
          governance:
            enrichedTask.governance
        }
      );

      const blockedResult = {
        ok: false,
        status: blockedStatus,
        governance:
          enrichedTask.governance,
        reason:
          guardian.reason
      };

      governanceAudit.executionResult(
        enrichedTask,
        blockedResult
      );

      return blockedResult;
    }
    /*
----------------------------------------------------------
Capability Dispatcher

Execute local MILES services before connector routing.
----------------------------------------------------------
*/

if (
      enrichedTask.capabilityDispatch &&
      enrichedTask.capabilityDispatch.mode === "SERVICE"
    ) {
      const route =
        enrichedTask.capabilityDispatch;

      const serviceProvider =
        route.provider ||
        route.serviceName ||
        enrichedTask.provider ||
        "MILES_SERVICE";

      const serviceAction =
        route.action ||
        enrichedTask.action ||
        enrichedTask.type ||
        "SERVICE_EXECUTION";

      try {
        taskQueue.update(
          enrichedTask.id,
          {
            status: "RUNNING",
            provider: serviceProvider,
            connector: "LOCAL_SERVICE",
            department:
              route.department ||
              enrichedTask.department ||
              "Engineering",
            action: serviceAction,
            startedAt:
              new Date().toISOString()
          }
        );

        safePublish(
          "TASK_STARTED",
          {
            task: enrichedTask,
            provider: serviceProvider,
            connector: "LOCAL_SERVICE",
            action: serviceAction
          }
        );

        const serviceResult =
          await capabilityDispatcher.executeService(
            route,
            enrichedTask
          );

        const awaitingApproval =
          serviceResult?.status ===
            "AWAITING_APPROVAL" ||
          serviceResult?.status ===
            "AWAITING_CEO_APPROVAL";

        const succeeded =
          serviceResult?.ok !== false;

        const finalStatus =
          awaitingApproval
            ? "AWAITING_APPROVAL"
            : succeeded
              ? "COMPLETED"
              : "FAILED";

        const normalizedResult = {
          ...(serviceResult || {}),
          ok:
            finalStatus === "COMPLETED",
          status: finalStatus,
          taskId: enrichedTask.id,
          provider: serviceProvider,
          connector: "LOCAL_SERVICE",
          action: serviceAction,
          completedAt:
            new Date().toISOString()
        };

        taskQueue.update(
          enrichedTask.id,
          {
            status: finalStatus,
            provider: serviceProvider,
            connector: "LOCAL_SERVICE",
            department:
              route.department ||
              enrichedTask.department ||
              "Engineering",
            action: serviceAction,
            error:
              finalStatus === "FAILED"
                ? serviceResult?.error ||
                  serviceResult?.message ||
                  "Local service execution failed."
                : null,
            result: normalizedResult
          }
        );

        memory.remember(
          "execution:last_result",
          enrichedTask.id,
          normalizedResult
        );

        safePublish(
          finalStatus === "COMPLETED"
            ? "TASK_COMPLETED"
            : finalStatus === "AWAITING_APPROVAL"
              ? "TASK_AWAITING_APPROVAL"
              : "TASK_FAILED",
          {
            task: enrichedTask,
            provider: serviceProvider,
            connector: "LOCAL_SERVICE",
            action: serviceAction,
            result: normalizedResult
          }
        );

        log(
          "ExecutionService",
          serviceAction,
          finalStatus,
          serviceProvider
        );

        return normalizedResult;
      } catch (error) {
        return this.handleFailure(
          enrichedTask,
          error,
          serviceProvider,
          serviceAction
        );
      }
    }

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
    const retryCount =
      Number(task.retryCount || 0);
    const maxRetries =
      Math.max(
        0,
        Number(
          task.maxRetries ??
          task.payload?.maxRetries ??
          1
        )
      );
    const retryDelayMs =
      Math.max(
        0,
        Number(
          task.retryDelayMs ??
          task.payload?.retryDelayMs ??
          process.env.MILES_QUEUE_RETRY_DELAY_MS ??
          5000
        )
      );
    const failedAt =
      new Date().toISOString();
    const nextRetryAt =
      failure.retryable &&
      retryCount < maxRetries
        ? new Date(
            Date.now() + retryDelayMs
          ).toISOString()
        : null;

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
      retryCount,
      maxRetries,
      nextRetryAt,
      createdAt:
        failedAt
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
        retryCount,
        maxRetries,
        failedAt,
        nextRetryAt,
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
    /*
     * Gate 3 claims the next dependency-ready task atomically. The claim
     * path also recovers stale RUNNING tasks and due retryable failures.
     */
    const task =
      typeof taskQueue.claimNextExecutableTask ===
        "function"
        ? taskQueue.claimNextExecutableTask({
            recoveredBy:
              "ExecutionService.runNext",
            claimedBy:
              "ExecutionService.runNext"
          })
        : taskQueue
            .list("QUEUED")
            .slice()
            .sort(
              (a, b) =>
                Number(a.priority || 99) -
                Number(b.priority || 99)
            )[0] || null;

    if (!task) {
      return {
        ok: true,
        message:
          "No queued task ready for execution"
      };
    }

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

