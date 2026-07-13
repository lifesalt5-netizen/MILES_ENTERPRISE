"use strict";

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
        step.provider ||
        "MILES",
      connector:
        step.connector ||
        "MILES",
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

    if (
      action ===
      "BUSINESS_EXECUTION"
    ) {
      base.attempts = 1;
      base.status =
        "COMPLETED";
      base.result = {
        ok: true,
        action:
          "BUSINESS_EXECUTION",
        orchestrationCheckpoint:
          true,
        objective:
          task.objective,
        message:
          "Executive objective was decomposed into governed provider steps. No recursive execution was invoked."
      };
      base.completedAt = now();
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
      action ===
      "CONTROLLED_WRITE";

    const stepTask = {
      ...task,
      action,
      capability:
        step.capability ||
        action,
      provider:
        step.provider ||
        "MILES",
      connector:
        step.connector ||
        "MILES",
      objective:
        step.objective ||
        task.objective,
      payload: {
        ...(task.payload || {}),
        action,
        capability:
          step.capability ||
          action,
        provider:
          step.provider ||
          "MILES",
        connector:
          step.connector ||
          "MILES",
        objective:
          step.objective ||
          task.objective,
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
        `- Step ${step.step}: ${step.action} â€” ${step.status}`
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

