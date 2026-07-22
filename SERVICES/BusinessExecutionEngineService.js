"use strict";
const BusinessWorkPlannerService =
    require("./BusinessWorkPlannerService");

const BusinessOperationsBridgeService =
    require("./BusinessOperationsBridgeService");
const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const OUT_DIR =
  path.join(
    ROOT,
    "DATA",
    "business_execution"
  );

const LATEST_FILE =
  path.join(
    OUT_DIR,
    "latest_business_execution.json"
  );

const HISTORY_FILE =
  path.join(
    OUT_DIR,
    "business_execution_history.jsonl"
  );

const REPORT_FILE =
  path.join(
    OUT_DIR,
    "latest_business_execution.md"
  );

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(
    dir,
    { recursive: true }
  );
}

function writeJsonAtomic(
  file,
  value
) {
  ensureDir(
    path.dirname(file)
  );

  const temp =
    `${file}.tmp_${process.pid}_${Date.now()}`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      value,
      null,
      2
    ),
    "utf8"
  );

  try {
    fs.copyFileSync(
      temp,
      file
    );
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {}
  }
}

function appendJsonLine(
  file,
  value
) {
  ensureDir(
    path.dirname(file)
  );

  fs.appendFileSync(
    file,
    `${JSON.stringify(value)}\n`,
    "utf8"
  );
}

function normalizeTask(task = {}) {
  const payload =
    task.payload ||
    task;

  const plan =
    payload.plan ||
    task.plan ||
    {};

  return {
    ...task,
    payload,
    plan,
    objective:
      plan.objective ||
      payload.objective ||
      payload.command ||
      task.objective ||
      task.command ||
      "",
    originalCommand:
      plan.originalCommand ||
      payload.originalCommand ||
      payload.command ||
      task.command ||
      "",
    steps:
      Array.isArray(plan.steps)
        ? plan.steps
        : []
  };
}

function normalizeResult(
  action,
  result
) {
  if (
    result &&
    typeof result === "object"
  ) {
    return {
      action,
      ...result,
      ok:
        result.ok !== false
    };
  }

  return {
    ok: true,
    action,
    result
  };
}

class BusinessExecutionEngineService {
  constructor(options = {}) {
    this.services = {
      PROVIDER_AUTHORITY:
        options.providerAuthority ||
        require(
          "./ProviderAuthorityRegistryService"
        ),

      PROVIDER_SYNC:
        options.providerSync ||
        require(
          "./ProviderSynchronizationService"
        ),

      INSTANTLY_LIVE:
        options.instantlyLive ||
        require(
          "./InstantlyLiveIntegrationService"
        ),

      CONTROLLED_WRITE:
        options.controlledWrite ||
        require(
          "./ControlledWriteService"
        )
    };

    this.businessOperationsBridge =
      options.businessOperationsBridge ||
      new BusinessOperationsBridgeService({
        rootDir: ROOT
      });

    this.maxStepAttempts =
      Number(
        options.maxStepAttempts ||
        process.env
          .MILES_BUSINESS_STEP_ATTEMPTS ||
        2
      );
  }

  async run(task = {}) {
    const normalized =
      normalizeTask(task);

    const executionId =
      `BIZ-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    const startedAt =
      now();

    const steps =
      normalized.steps.length > 0
        ? normalized.steps
        : this.defaultSteps(
            normalized.objective
          );

    const record = {
      ok: true,
      status: "RUNNING",
      service:
        "BusinessExecutionEngineService",
      executionId,
      objective:
        normalized.objective,
      originalCommand:
        normalized.originalCommand,
      startedAt,
      completedAt: null,
      stepCount:
        steps.length,
      completedSteps: 0,
      failedSteps: 0,
      approvalSteps: 0,
      blockedSteps: 0,
      results: [],
      executiveSummary: null
    };

    for (const step of steps) {
      const stepResult =
        await this.executeStep(
          step,
          normalized,
          executionId
        );

      record.results.push(
        stepResult
      );

      if (
        stepResult.status ===
        "COMPLETED"
      ) {
        record.completedSteps += 1;
      }

      if (
        stepResult.status ===
        "FAILED"
      ) {
        record.failedSteps += 1;
      }

      if (
        stepResult.status ===
        "AWAITING_APPROVAL"
      ) {
        record.approvalSteps += 1;
      }

      if (
        stepResult.status ===
        "BLOCKED"
      ) {
        record.blockedSteps += 1;
      }
    }

    record.ok =
      record.failedSteps === 0;

    record.status =
      record.failedSteps > 0
        ? "COMPLETED_WITH_ERRORS"
        : record.approvalSteps > 0
          ? "AWAITING_APPROVAL"
          : "COMPLETED";

    record.completedAt =
      now();

    record.executiveSummary =
      this.buildExecutiveSummary(
        record
      );

    this.save(record);

    return record;
  }

  defaultSteps(objective) {
    return [
      {
        step: 1,
        provider: "MILES",
        connector: "MILES",
        capability:
          "PROVIDER_AUTHORITY",
        action:
          "PROVIDER_AUTHORITY",
        objective:
          "Verify provider authority, credentials, and write permissions."
      },
      {
        step: 2,
        provider: "MILES",
        connector: "MILES",
        capability:
          "PROVIDER_SYNC",
        action:
          "PROVIDER_SYNC",
        objective:
          "Synchronize provider and operating state."
      },
      {
        step: 3,
        provider: "MILES",
        connector: "MILES",
        capability:
          "INSTANTLY_LIVE",
        action:
          "INSTANTLY_LIVE",
        objective:
          "Perform live Instantly operating assessment."
      },
      {
        step: 4,
        provider: "MILES",
        connector: "MILES",
        capability:
          "BUSINESS_EXECUTION",
        action:
          "BUSINESS_EXECUTION",
        objective:
          objective ||
          "Execute the authorized business objective."
      },
      {
        step: 5,
        provider: "MILES",
        connector: "MILES",
        capability:
          "CONTROLLED_WRITE",
        action:
          "CONTROLLED_WRITE",
        objective:
          "Stage protected external changes for approval."
      }
    ];
  }

  async executeStep(
    step = {},
    task = {},
    executionId
  ) {
    const action =
      String(
        step.action ||
        step.capability ||
        ""
      ).toUpperCase();

    const base = {
      step:
        Number(step.step || 0),
      action,
      provider:
    action === "CONTROLLED_WRITE"
        ? "instantly"
        : (step.provider || "MILES"),
      connector:
    action === "CONTROLLED_WRITE"
        ? "instantly"
        : (step.connector || "MILES"),
      objective:
        step.objective ||
        task.objective ||
        "",
      executionId,
      startedAt:
        now(),
      completedAt: null,
      attempts: 0,
      status: "RUNNING",
      result: null,
      error: null
    };
    if (action === "BUSINESS_EXECUTION") {
      base.attempts = 1;

      /*
       * BUILD E005
       *
       * BusinessWorkPlannerService determines what work should exist.
       * BusinessOperationsBridgeService converts that work into TaskQueue
       * tasks for the existing execution runtime.
       */

      const workPlan =
        await BusinessWorkPlannerService.plan({
          objective:
            task.objective,
          payload:
            task.payload || {}
        });

      const workPackages =
        Array.isArray(
          workPlan.workPackages
        )
          ? workPlan.workPackages
          : [];

      if (workPackages.length === 0) {
        base.status = "FAILED";
        base.error =
          "BusinessWorkPlannerService returned no executable work packages.";
        base.completedAt = now();
        return base;
      }

      const bridge =
        this.businessOperationsBridge;

      if (
        !bridge ||
        typeof bridge.readQueue !==
          "function" ||
        typeof bridge.writeQueue !==
          "function" ||
        typeof bridge.runOnce !==
          "function"
      ) {
        base.status = "FAILED";
        base.error =
          "BusinessOperationsBridgeService is unavailable or incomplete.";
        base.completedAt = now();
        return base;
      }

      const queue =
        bridge.readQueue();

      queue.operations =
        Array.isArray(
          queue.operations
        )
          ? queue.operations
          : [];

      const createdOperations =
        workPackages.map(
          (
            workPackage,
            index
          ) => {
            const packageNumber =
              index + 1;

            const packageId =
              `${executionId}-WORK-${String(
                packageNumber
              ).padStart(3, "0")}`;

            const provider =
              workPackage.provider ||
              workPackage.connector ||
              "MILES";

            const actionName =
              workPackage.action ||
              workPackage.taskType ||
              "BUSINESS_OPERATION";

            return {
              id:
                packageId,
              source:
                "BusinessExecutionEngineService",
              sourceExecutionId:
                executionId,
              sourceObjective:
                task.objective,
              department:
                workPackage.department ||
                provider,
              provider,
              connector:
                workPackage.connector ||
                provider,
              system:
                workPackage.system ||
                provider,
              action:
                actionName,
              capability:
                workPackage.capability ||
                actionName,
              type:
                workPackage.taskType ||
                actionName,
              taskType:
                workPackage.taskType ||
                actionName,
              title:
                workPackage.title ||
                workPackage.description ||
                actionName,
              command:
                workPackage.command ||
                workPackage.description ||
                task.objective,
              objective:
                workPackage.objective ||
                workPackage.description ||
                task.objective,
              description:
                workPackage.description ||
                "",
              priority:
                workPackage.priority ||
                packageNumber,
              requiresKevin:
                workPackage.requiresKevin ===
                true,
              status:
                workPackage.requiresKevin ===
                true
                  ? "AWAITING_APPROVAL"
                  : "READY",
              plan: {
                ...workPackage,
                objective:
                  workPackage.objective ||
                  workPackage.description ||
                  task.objective,
                originalCommand:
                  task.originalCommand ||
                  task.objective,
                provider,
                connector:
                  workPackage.connector ||
                  provider,
                action:
                  actionName,
                capability:
                  workPackage.capability ||
                  actionName
              },
              createdAt:
                now(),
              updatedAt:
                now()
            };
          }
        );

      queue.operations.push(
        ...createdOperations
      );

      bridge.writeQueue(
        queue
      );

      const bridgeResult =
        await bridge.runOnce();

      const queuedCount =
        Number(
          bridgeResult.operationsQueued ||
          bridgeResult.bridged ||
          0
        );

      const failedCount =
        Number(
          bridgeResult.operationsFailed ||
          bridgeResult.failed ||
          0
        );

      base.status =
        failedCount > 0
          ? "FAILED"
          : queuedCount > 0
            ? "COMPLETED"
            : "BLOCKED";

      base.result = {
        ok:
          failedCount === 0 &&
          queuedCount > 0,
        action:
          "BUSINESS_EXECUTION",
        objective:
          task.objective,
        planner:
          workPlan.service,
        workPackageCount:
          workPlan.workPackageCount ||
          workPackages.length,
        workPackages,
        operationsCreated:
          createdOperations.length,
        operationsQueued:
          queuedCount,
        operationsFailed:
          failedCount,
        bridgeStatus:
          bridgeResult.status,
        queueFile:
          bridgeResult.queueFile ||
          bridge.queueFile,
        generatedAt:
          workPlan.generatedAt,
        bridgeResult,
        message:
          failedCount > 0
            ? "Business work packages were created, but one or more failed to enter the execution queue."
            : queuedCount > 0
              ? "Business work packages were generated and submitted to the execution queue."
              : "Business work packages were generated, but none entered the execution queue."
      };

      if (base.status === "FAILED") {
        base.error =
          `${failedCount} business operation(s) failed while entering the execution queue.`;
      }

      if (base.status === "BLOCKED") {
        base.error =
          "No business operations entered the execution queue.";
      }

      base.completedAt =
        now();

      return base;
    }

    const service =
      this.services[action];

    if (!service) {
      base.status = "FAILED";
      base.error =
        `No business execution service is registered for action ${action}.`;
      base.completedAt = now();
      return base;
    }

    const protectedWrite =
      action === "CONTROLLED_WRITE";

    const stepTask = {
      ...task,
      action,
      capability:
        step.capability ||
        action,
      provider:
    action === "CONTROLLED_WRITE"
        ? "instantly"
        : (step.provider || "MILES"),
      connector:
    action === "CONTROLLED_WRITE"
        ? "instantly"
        : (step.connector || "MILES"),
      objective:
    step.objective || task.objective,

operation:
    action === "CONTROLLED_WRITE"
        ? "CREATE_TEST_CAMPAIGN"
        : undefined,
      payload: {
        ...(task.payload || {}),
        action,
        capability:
          step.capability ||
          action,
        provider:
    action === "CONTROLLED_WRITE"
        ? "instantly"
        : (step.provider || "MILES"),
        connector:
    action === "CONTROLLED_WRITE"
        ? "instantly"
        : (step.connector || "MILES"),
        objective:
    step.objective || task.objective,

operation:
    action === "CONTROLLED_WRITE"
        ? "CREATE_TEST_CAMPAIGN"
        : undefined,
        originalObjective:
          task.objective,
        executionId,
        dryRun:
          protectedWrite
            ? true
            : Boolean(
                task.payload
                  ?.dryRun
              ),
        stageOnly:
          protectedWrite,
        requiresApproval:
          protectedWrite
      }
    };

    let lastError = null;

    for (
      let attempt = 1;
      attempt <=
      this.maxStepAttempts;
      attempt += 1
    ) {
      base.attempts =
        attempt;

      try {
        const raw =
          await this.invokeService(
            service,
            stepTask
          );

        const result =
          normalizeResult(
            action,
            raw
          );

        base.result =
          result;

        if (
          protectedWrite
        ) {
          base.status =
            "AWAITING_APPROVAL";
          base.completedAt =
            now();
          return base;
        }

        if (
          result.ok !== false
        ) {
          base.status =
            "COMPLETED";
          base.completedAt =
            now();
          return base;
        }

        lastError =
          result.error ||
          result.message ||
          `${action} returned ok=false`;

        const retryable =
          result.retryable ===
            true ||
          result.failure
            ?.retryable ===
            true;

        if (!retryable) {
          break;
        }
      } catch (error) {
        lastError =
          error.stack ||
          error.message;

        if (
          attempt >=
          this.maxStepAttempts
        ) {
          break;
        }
      }
    }

    base.status = "FAILED";
    base.error =
      lastError ||
      `${action} failed.`;
    base.completedAt = now();

    return base;
  }

  async invokeService(
    service,
    task
  ) {
    if (
      service &&
      typeof service.run ===
        "function"
    ) {
      return service.run(task);
    }

    if (
      service &&
      typeof service.execute ===
        "function"
    ) {
      return service.execute(task);
    }

    if (
      typeof service ===
      "function"
    ) {
      return service(task);
    }

    throw new Error(
      "Registered business execution service does not implement run() or execute()."
    );
  }

  buildExecutiveSummary(record) {
    const completed =
      record.results
        .filter(
          item =>
            item.status ===
            "COMPLETED"
        )
        .map(
          item =>
            item.action
        );

    const approvals =
      record.results
        .filter(
          item =>
            item.status ===
            "AWAITING_APPROVAL"
        )
        .map(item => ({
          action:
            item.action,
          objective:
            item.objective,
          result:
            item.result
        }));

    const failures =
      record.results
        .filter(
          item =>
            item.status ===
            "FAILED"
        )
        .map(item => ({
          action:
            item.action,
          error:
            item.error
        }));

    return {
      objective:
        record.objective,
      status:
        record.status,
      completedWork:
        completed,
      activeWork: [],
      blockers:
        failures,
      ceoApprovals:
        approvals,
      message:
        failures.length > 0
          ? "Miles completed available work and recorded blockers."
          : approvals.length > 0
            ? "Miles completed authorized work and staged protected changes for CEO approval."
            : "Miles completed the business objective."
    };
  }

  save(record) {
    ensureDir(OUT_DIR);

    writeJsonAtomic(
      LATEST_FILE,
      record
    );

    appendJsonLine(
      HISTORY_FILE,
      record
    );

    fs.writeFileSync(
      REPORT_FILE,
      this.renderReport(record),
      "utf8"
    );
  }

  renderReport(record) {
    const lines = [];

    lines.push(
      "# MILES Business Execution Report"
    );
    lines.push("");
    lines.push(
      `Execution: ${record.executionId}`
    );
    lines.push(
      `Status: ${record.status}`
    );
    lines.push(
      `Objective: ${record.objective}`
    );
    lines.push(
      `Started: ${record.startedAt}`
    );
    lines.push(
      `Completed: ${record.completedAt}`
    );
    lines.push("");
    lines.push(
      "## Steps"
    );
    lines.push("");

    for (
      const step
      of record.results
    ) {
      lines.push(
        `- Step ${step.step}: ${step.action} Ã¢â‚¬â€ ${step.status}`
      );

      if (step.error) {
        lines.push(
          `  - Error: ${step.error}`
        );
      }
    }

    lines.push("");
    lines.push(
      "## Executive Summary"
    );
    lines.push("");
    lines.push(
      record.executiveSummary
        .message
    );

    if (
      record.executiveSummary
        .ceoApprovals.length >
      0
    ) {
      lines.push("");
      lines.push(
        "### CEO Approvals"
      );

      for (
        const approval
        of record.executiveSummary
          .ceoApprovals
      ) {
        lines.push(
          `- ${approval.action}: ${approval.objective}`
        );
      }
    }

    if (
      record.executiveSummary
        .blockers.length >
      0
    ) {
      lines.push("");
      lines.push(
        "### Blockers"
      );

      for (
        const blocker
        of record.executiveSummary
          .blockers
      ) {
        lines.push(
          `- ${blocker.action}: ${blocker.error}`
        );
      }
    }

    return lines.join("\n");
  }
}

module.exports =
  new BusinessExecutionEngineService();

module.exports.BusinessExecutionEngineService =
  BusinessExecutionEngineService;


