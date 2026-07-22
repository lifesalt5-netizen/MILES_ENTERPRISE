"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const REPORT_DIR =
  path.join(ROOT, "DATA", "runtime");

const REPORT_FILE =
  path.join(
    REPORT_DIR,
    "build125_orion_execution_trace.json"
  );

const taskQueue =
  require(
    path.join(ROOT, "CORE", "TaskQueue")
  );

const ExecutionService =
  require(
    path.join(
      ROOT,
      "SERVICES",
      "ExecutionService"
    )
  );

const OrionProvider =
  require(
    path.join(
      ROOT,
      "PROVIDERS",
      "providers",
      "OrionProvider"
    )
  );

const trace = [];

function now() {
  return new Date().toISOString();
}

function compact(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value !== "object"
  ) {
    return value;
  }

  const output = {
    ok: value.ok,
    status: value.status,
    provider: value.provider,
    action: value.action,
    readOnly: value.readOnly,
    requiresApproval:
      value.requiresApproval,
    approvalRequired:
      value.approvalRequired,
    message: value.message,
    error: value.error,
    authority: value.authority,
    decision: value.decision,
    recommendation:
      value.recommendation,
    exceptions:
      Array.isArray(value.exceptions)
        ? value.exceptions
        : undefined,
    recommendations:
      Array.isArray(value.recommendations)
        ? value.recommendations
        : undefined
  };

  if (value.result) {
    output.result = compact(value.result);
  }

  return output;
}

function record(stage, details = {}) {
  const event = {
    timestamp: now(),
    stage,
    details: compact(details)
  };

  trace.push(event);

  console.log("");
  console.log(
    "========================================"
  );
  console.log(stage);
  console.log(
    "========================================"
  );
  console.log(
    JSON.stringify(event.details, null, 2)
  );
}

function wrapMethod(
  target,
  methodName,
  label
) {
  if (
    !target ||
    typeof target[methodName] !== "function"
  ) {
    return false;
  }

  const original =
    target[methodName];

  target[methodName] =
    async function (...args) {
      record(
        `${label}.${methodName}:ENTER`,
        {
          task: args[0]
            ? {
                id: args[0].id,
                type: args[0].type,
                status: args[0].status,
                provider:
                  args[0].provider ||
                  args[0].payload?.provider,
                action:
                  args[0].action ||
                  args[0].payload?.action,
                capability:
                  args[0].payload?.capability,
                workPackageId:
                  args[0].workPackageId ||
                  args[0].payload
                    ?.workPackageId,
                readOnly:
                  args[0].payload?.readOnly
              }
            : null
        }
      );

      try {
        const result =
          await original.apply(
            this,
            args
          );

        record(
          `${label}.${methodName}:RETURN`,
          result
        );

        return result;
      } catch (error) {
        record(
          `${label}.${methodName}:THROW`,
          {
            error:
              error.stack ||
              error.message ||
              String(error)
          }
        );

        throw error;
      }
    };

  return true;
}

async function run() {
  fs.mkdirSync(
    REPORT_DIR,
    {
      recursive: true
    }
  );

  console.log("");
  console.log(
    "=============================================="
  );
  console.log(
    " BUILD125 ORION EXECUTION TRACE"
  );
  console.log(
    "=============================================="
  );

  // --------------------------------------------------
  // Trace raw OrionProvider outputs.
  // --------------------------------------------------

  wrapMethod(
    OrionProvider.prototype,
    "refresh",
    "OrionProvider"
  );

  wrapMethod(
    OrionProvider.prototype,
    "auditIntelligence",
    "OrionProvider"
  );

  wrapMethod(
    OrionProvider.prototype,
    "executeTask",
    "OrionProvider"
  );

  // --------------------------------------------------
  // Trace TaskQueue status transitions.
  // --------------------------------------------------

  const originalUpdate =
    taskQueue.update.bind(taskQueue);

  taskQueue.update =
    function (id, patch) {
      const before =
        taskQueue
          .list()
          .find(
            task =>
              task.id === id
          );

      record(
        "TaskQueue.update",
        {
          id,
          beforeStatus:
            before?.status,
          patch,
          afterStatus:
            patch?.status ||
            before?.status
        }
      );

      return originalUpdate(
        id,
        patch
      );
    };

  // --------------------------------------------------
  // Load and instrument workforce services when found.
  // --------------------------------------------------

  const candidates = [
    {
      file:
        path.join(
          ROOT,
          "SERVICES",
          "WorkforceExecutionService.js"
        ),
      label:
        "WorkforceExecutionService"
    },
    {
      file:
        path.join(
          ROOT,
          "SERVICES",
          "WorkforceDecisionService.js"
        ),
      label:
        "WorkforceDecisionService"
    },
    {
      file:
        path.join(
          ROOT,
          "SERVICES",
          "ApprovalService.js"
        ),
      label:
        "ApprovalService"
    },
    {
      file:
        path.join(
          ROOT,
          "SERVICES",
          "GovernanceService.js"
        ),
      label:
        "GovernanceService"
    }
  ];

  const methodsToTrace = [
    "execute",
    "executeTask",
    "executeWorkforceTask",
    "evaluate",
    "evaluateDecision",
    "decide",
    "requiresApproval",
    "routeApproval",
    "requestApproval",
    "createApproval",
    "verify"
  ];

  for (const candidate of candidates) {
    if (
      !fs.existsSync(
        candidate.file
      )
    ) {
      continue;
    }

    try {
      const exported =
        require(candidate.file);

      const targets = [];

      if (exported) {
        targets.push(exported);
      }

      if (
        typeof exported ===
          "function" &&
        exported.prototype
      ) {
        targets.push(
          exported.prototype
        );
      }

      for (
        const target
        of targets
      ) {
        for (
          const method
          of methodsToTrace
        ) {
          wrapMethod(
            target,
            method,
            candidate.label
          );
        }
      }

      record(
        "TRACE_MODULE_LOADED",
        {
          label:
            candidate.label,
          file:
            candidate.file
        }
      );
    } catch (error) {
      record(
        "TRACE_MODULE_LOAD_FAILED",
        {
          label:
            candidate.label,
          file:
            candidate.file,
          error:
            error.message
        }
      );
    }
  }

  // --------------------------------------------------
  // Create one explicit, safe, read-only ORION task.
  // --------------------------------------------------

  const stamp =
    Date.now();

  const task = {
    id:
      `BUILD125-ORION-${stamp}`,

    type:
      "WORKFORCE_STEP",

    status:
      "QUEUED",

    priority:
      1,

    title:
      "BUILD125 ORION read-only execution trace",

    provider:
      "OrionProvider",

    action:
      "auditIntelligence",

    connector:
      "ORION",

    department:
      "Intelligence",

    workPackageId:
      `WP-BUILD125-ORION-${stamp}`,

    source:
      "Build125OrionExecutionTrace",

    createdAt:
      now(),

    updatedAt:
      now(),

    payload: {
      type:
        "WORKFORCE_STEP",

      provider:
        "OrionProvider",

      action:
        "auditIntelligence",

      connector:
        "ORION",

      system:
        "ORION",

      department:
        "Intelligence",

      capability:
        "orion.auditIntelligence",

      workPackageId:
        `WP-BUILD125-ORION-${stamp}`,

      assignedTo:
        "Aden",

      objective:
        "Perform a safe read-only audit of current ORION intelligence availability and database freshness.",

      originalCommand:
        "Audit ORION intelligence in read-only mode.",

      expectedOutput:
        "Verified ORION counts, coverage, database status, warnings, and recommendations.",

      verification:
        "Confirm ORION returned readable intelligence data without modifying the database.",

      readOnly:
        true,

      autonomous:
        true,

      safeToAutoExecute:
        true,

      requiresApproval:
        false,

      plan: {
        objective:
          "Perform a safe read-only audit of current ORION intelligence availability and database freshness.",

        originalCommand:
          "Audit ORION intelligence in read-only mode.",

        provider:
          "OrionProvider",

        action:
          "auditIntelligence",

        connector:
          "ORION",

        system:
          "ORION",

        department:
          "Intelligence",

        capability:
          "orion.auditIntelligence",

        workPackageId:
          `WP-BUILD125-ORION-${stamp}`,

        readOnly:
          true
      }
    }
  };

  const created =
    taskQueue.add(task);

  record(
    "TASK_CREATED",
    created
  );

  let executionResult;

  try {
    executionResult =
      await ExecutionService.execute(
        created
      );

    record(
      "ExecutionService.execute:FINAL_RETURN",
      executionResult
    );
  } catch (error) {
    executionResult = {
      ok: false,
      status:
        "EXECUTION_EXCEPTION",
      error:
        error.stack ||
        error.message
    };

    record(
      "ExecutionService.execute:THROW",
      executionResult
    );
  }

  const persistedTask =
    taskQueue
      .list()
      .find(
        item =>
          item.id === created.id
      );

  record(
    "FINAL_PERSISTED_TASK",
    {
      id:
        persistedTask?.id,

      status:
        persistedTask?.status,

      provider:
        persistedTask?.provider ||
        persistedTask?.payload
          ?.provider,

      action:
        persistedTask?.action ||
        persistedTask?.payload
          ?.action,

      authority:
        persistedTask?.authority,

      decision:
        persistedTask?.decision,

      result:
        persistedTask?.result,

      error:
        persistedTask?.error
    }
  );

  const firstApprovalEvent =
    trace.find(
      event =>
        event.details?.status ===
          "AWAITING_APPROVAL" ||
        event.details?.afterStatus ===
          "AWAITING_APPROVAL" ||
        event.details?.result?.status ===
          "AWAITING_APPROVAL"
    );

  const report = {
    build:
      "BUILD125",

    generatedAt:
      now(),

    taskId:
      created.id,

    rawProviderHealthy:
      trace.some(
        event =>
          event.stage.includes(
            "OrionProvider"
          ) &&
          event.stage.endsWith(
            ":RETURN"
          ) &&
          event.details?.ok ===
            true
      ),

    finalStatus:
      persistedTask?.status ||
      executionResult?.status ||
      null,

    firstApprovalTransition:
      firstApprovalEvent ||
      null,

    executionResult:
      compact(
        executionResult
      ),

    persistedTask:
      compact(
        persistedTask
      ),

    trace
  };

  fs.writeFileSync(
    REPORT_FILE,
    JSON.stringify(
      report,
      null,
      2
    ),
    "utf8"
  );

  console.log("");
  console.log(
    "=============================================="
  );
  console.log(
    " BUILD125 TRACE COMPLETE"
  );
  console.log(
    "=============================================="
  );
  console.log("");
  console.log(
    `Final status: ${report.finalStatus}`
  );
  console.log(
    `Raw provider healthy: ${report.rawProviderHealthy}`
  );
  console.log(
    `Report: ${REPORT_FILE}`
  );
}

run().catch(
  error => {
    console.error("");
    console.error(
      "BUILD125 FAILED"
    );
    console.error(
      error.stack ||
      error.message
    );
    process.exitCode = 1;
  }
);
