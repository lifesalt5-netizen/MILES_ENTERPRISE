"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const DATA_DIR =
  path.join(
    ROOT,
    "DATA",
    "runtime"
  );

const REPORT_FILE =
  path.join(
    DATA_DIR,
    "build122_revenue_operations_acceptance.json"
  );

const capabilityService =
  require(
    path.join(
      ROOT,
      "SERVICES",
      "CapabilityService"
    )
  );

const taskQueue =
  require(
    path.join(
      ROOT,
      "CORE",
      "TaskQueue"
    )
  );

const executionService =
  require(
    path.join(
      ROOT,
      "SERVICES",
      "ExecutionService"
    )
  );

const OBJECTIVE =
  [
    "Audit Instantly and P2GC segment inventory.",
    "Identify the highest-priority campaign-ready segment.",
    "Create the operational work plan.",
    "Execute every authorized preparation step.",
    "Preserve evidence and route only CEO-protected decisions",
    "to the approval queue."
  ].join(" ");

const ACCEPTANCE_PREFIX =
  "BUILD122";

const MAX_EXECUTION_PASSES =
  Number(
    process.env
      .BUILD122_MAX_EXECUTION_PASSES ||
    30
  );

const PASS_DELAY_MS =
  Number(
    process.env
      .BUILD122_PASS_DELAY_MS ||
    1000
  );

function now() {
  return new Date().toISOString();
}

function ensureDir(directory) {
  fs.mkdirSync(
    directory,
    {
      recursive: true
    }
  );
}

function sleep(milliseconds) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

function status(value) {
  return String(
    value ||
    "UNKNOWN"
  ).toUpperCase();
}

function safeValue(
  ...values
) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return null;
}

function extractOperationalPlan(
  plannerResult
) {
  return (
    plannerResult
      ?.operationalPlan ||
    plannerResult
      ?.plan ||
    plannerResult ||
    {}
  );
}

function extractSteps(
  plannerResult
) {
  const operationalPlan =
    extractOperationalPlan(
      plannerResult
    );

  if (
    Array.isArray(
      operationalPlan.steps
    )
  ) {
    return operationalPlan.steps;
  }

  if (
    Array.isArray(
      plannerResult?.steps
    )
  ) {
    return plannerResult.steps;
  }

  return [];
}

function createAcceptanceId(
  index
) {
  return [
    ACCEPTANCE_PREFIX,
    Date.now(),
    index + 1,
    Math.floor(
      Math.random() *
      100000
    )
  ].join("-");
}

function normalizeStep(
  step,
  index,
  operationalPlan
) {
  const provider =
    safeValue(
      step.provider,
      step.system,
      operationalPlan.provider,
      "MILES"
    );

  const action =
    safeValue(
      step.action,
      step.capability,
      operationalPlan.action,
      "execute"
    );

  const department =
    safeValue(
      step.department,
      operationalPlan.department,
      "Revenue Operations"
    );

  const connector =
    safeValue(
      step.connector,
      step.system,
      operationalPlan.connector,
      provider,
      "MILES"
    );

  const priority =
    Number(
      safeValue(
        step.priority,
        operationalPlan.priority,
        3
      )
    );

  const taskType =
    safeValue(
      step.taskType,
      step.type,
      "WORKFORCE_STEP"
    );

  const taskId =
    createAcceptanceId(
      index
    );

  const plan = {
    ...operationalPlan,

    objective:
      operationalPlan.objective ||
      OBJECTIVE,

    originalCommand:
      operationalPlan.originalCommand ||
      OBJECTIVE,

    provider,
    action,
    department,
    connector,

    steps: [
      {
        ...step,

        provider,
        action,
        department,

        taskType,

        status:
          "QUEUED"
      }
    ]
  };

  return {
    id:
      taskId,

    type:
      taskType,

    status:
      "QUEUED",

    priority,

    title:
      step.title ||
      step.expectedOutput ||
      `${ACCEPTANCE_PREFIX} Revenue Operations Step ${index + 1}`,

    provider,
    action,
    department,
    connector,

    source:
      "Build122RevenueOperationsAcceptance",

    createdAt:
      now(),

    updatedAt:
      now(),

    payload: {
      type:
        taskType,

      provider,
      action,
      department,
      connector,

      system:
        step.system ||
        operationalPlan.system ||
        connector,

      capability:
        step.capability ||
        null,

      assignedTo:
        step.assignedTo ||
        null,

      objective:
        OBJECTIVE,

      expectedOutput:
        step.expectedOutput ||
        null,

      verification:
        step.verification ||
        null,

      dependsOn:
        Array.isArray(
          step.dependsOn
        )
          ? step.dependsOn
          : [],

      acceptanceBuild:
        ACCEPTANCE_PREFIX,

      acceptanceTaskId:
        taskId,

      autonomous:
        true,

      safeToAutoExecute:
        step.safeToAutoExecute !==
        false,

      plan
    },

    plan
  };
}

function queueSnapshot() {
  const tasks =
    taskQueue.list();

  const counts = {};

  for (const task of tasks) {
    const currentStatus =
      status(
        task.status
      );

    counts[currentStatus] =
      (
        counts[currentStatus] ||
        0
      ) + 1;
  }

  return {
    total:
      tasks.length,

    counts,

    malformed:
      tasks.filter(
        task =>
          typeof task.type ===
            "object" ||
          task.provider ===
            "UNKNOWN" ||
          task.action ===
            "[OBJECT OBJECT]" ||
          typeof task.action ===
            "object"
      ).length
  };
}

function acceptanceTasks(
  ids
) {
  const idSet =
    new Set(ids);

  return taskQueue
    .list()
    .filter(
      task =>
        idSet.has(task.id)
    );
}

function summarizeTask(
  task
) {
  return {
    id:
      task.id,

    status:
      status(
        task.status
      ),

    type:
      task.type,

    provider:
      task.provider ||
      task.payload?.provider ||
      null,

    action:
      task.action ||
      task.payload?.action ||
      null,

    department:
      task.department ||
      task.payload?.department ||
      null,

    title:
      task.title ||
      null,

    error:
      task.error ||
      task.result?.error ||
      null,

    authority:
      task.authority ||
      task.result?.authority ||
      null,

    result:
      task.result ||
      null,

    evidence:
      task.evidence ||
      task.result?.evidence ||
      task.result?.evidenceFile ||
      null,

    createdAt:
      task.createdAt ||
      null,

    updatedAt:
      task.updatedAt ||
      null,

    completedAt:
      task.completedAt ||
      null
  };
}

function evaluateAcceptance(
  tasks,
  plannerResult,
  queueAfter
) {
  const statuses =
    tasks.map(
      task =>
        status(
          task.status
        )
    );

  const completed =
    statuses.filter(
      value =>
        value ===
        "COMPLETED"
    ).length;

  const awaitingApproval =
    statuses.filter(
      value =>
        value ===
        "AWAITING_APPROVAL"
    ).length;

  const failed =
    statuses.filter(
      value =>
        value ===
        "FAILED"
    ).length;

  const queued =
    statuses.filter(
      value =>
        value ===
        "QUEUED"
    ).length;

  const running =
    statuses.filter(
      value =>
        value ===
        "RUNNING"
    ).length;

  const correctlyRouted =
    tasks.filter(
      task => {
        const provider =
          task.provider ||
          task.payload?.provider;

        const action =
          task.action ||
          task.payload?.action;

        return Boolean(
          provider &&
          provider !==
            "UNKNOWN" &&
          action &&
          action !==
            "UNKNOWN_ACTION" &&
          action !==
            "[OBJECT OBJECT]"
        );
      }
    ).length;

  const protectedCorrectly =
    tasks.every(
      task => {
        const taskStatus =
          status(
            task.status
          );

        if (
          taskStatus !==
          "AWAITING_APPROVAL"
        ) {
          return true;
        }

        return Boolean(
          task.authority ||
          task.result?.authority ||
          task.payload
            ?.requiresApproval ||
          task.payload
            ?.requiresKevin
        );
      }
    );

  const plannerPassed =
    Boolean(
      plannerResult &&
      extractSteps(
        plannerResult
      ).length > 0
    );

  const queuePassed =
    queueAfter.malformed ===
    0;

  const executionPassed =
    failed === 0 &&
    queued === 0 &&
    running === 0 &&
    completed +
      awaitingApproval ===
      tasks.length;

  return {
    passed:
      plannerPassed &&
      queuePassed &&
      correctlyRouted ===
        tasks.length &&
      protectedCorrectly &&
      executionPassed,

    plannerPassed,

    queuePassed,

    correctlyRouted:
      correctlyRouted ===
      tasks.length,

    protectedActionsHandled:
      protectedCorrectly,

    executionPassed,

    counts: {
      total:
        tasks.length,

      completed,

      awaitingApproval,

      failed,

      queued,

      running,

      correctlyRouted
    }
  };
}

async function run() {
  ensureDir(
    DATA_DIR
  );

  console.log("");
  console.log(
    "=============================================="
  );

  console.log(
    " BUILD122 REVENUE OPERATIONS ACCEPTANCE"
  );

  console.log(
    "=============================================="
  );

  console.log("");
  console.log(
    `Objective: ${OBJECTIVE}`
  );

  const queueBefore =
    queueSnapshot();

  if (
    queueBefore.malformed >
    0
  ) {
    throw new Error(
      `Acceptance blocked: ${queueBefore.malformed} malformed queue task(s) detected.`
    );
  }

  console.log("");
  console.log(
    "Planning objective..."
  );

  const plannerResult =
    await Promise.resolve(
      capabilityService
        .planObjective(
          OBJECTIVE
        )
    );

  const operationalPlan =
    extractOperationalPlan(
      plannerResult
    );

  const steps =
    extractSteps(
      plannerResult
    );

  if (!steps.length) {
    throw new Error(
      "Planner returned no operational steps."
    );
  }

  console.log(
    `Planner produced ${steps.length} step(s).`
  );

  const queuedTasks =
    steps.map(
      (
        step,
        index
      ) =>
        normalizeStep(
          step,
          index,
          operationalPlan
        )
    );

  console.log("");
  console.log(
    "Queueing acceptance work..."
  );

  const createdTasks =
    [];

  for (
    const task
    of queuedTasks
  ) {
    createdTasks.push(
      taskQueue.add(task)
    );

    console.log(
      [
        "QUEUED",
        task.id,
        task.provider,
        task.action
      ].join(" | ")
    );
  }

  const taskIds =
    createdTasks.map(
      task =>
        task.id
    );

  const passResults = [];

  console.log("");
  console.log(
    "Executing authorized work..."
  );

  for (
    let pass = 1;
    pass <=
      MAX_EXECUTION_PASSES;
    pass += 1
  ) {
    const currentTasks =
      acceptanceTasks(
        taskIds
      );

    const pending =
      currentTasks.filter(
        task =>
          status(
            task.status
          ) ===
            "QUEUED" ||
          status(
            task.status
          ) ===
            "RUNNING"
      );

    if (!pending.length) {
      break;
    }

    const startedAt =
      Date.now();

    let result;

    try {
      result =
        await executionService
          .runNext();
    } catch (error) {
      result = {
        ok: false,
        status:
          "EXECUTION_EXCEPTION",
        error:
          error.stack ||
          error.message
      };
    }

    passResults.push({
      pass,

      durationMs:
        Date.now() -
        startedAt,

      result
    });

    console.log(
      [
        `PASS ${pass}`,
        result?.status ||
          "UNKNOWN",
        result?.provider ||
          "",
        result?.action ||
          "",
        `ok=${result?.ok !== false}`
      ]
        .filter(Boolean)
        .join(" | ")
    );

    await sleep(
      PASS_DELAY_MS
    );
  }

  const finalTasks =
    acceptanceTasks(
      taskIds
    );

  const queueAfter =
    queueSnapshot();

  const acceptance =
    evaluateAcceptance(
      finalTasks,
      plannerResult,
      queueAfter
    );

  const report = {
    build:
      ACCEPTANCE_PREFIX,

    generatedAt:
      now(),

    objective:
      OBJECTIVE,

    queueBefore,

    planner: {
      ok:
        Boolean(
          plannerResult
        ),

      intent:
        operationalPlan.intent ||
        null,

      workflow:
        operationalPlan.workflow ||
        null,

      provider:
        operationalPlan.provider ||
        null,

      action:
        operationalPlan.action ||
        null,

      department:
        operationalPlan.department ||
        null,

      stepCount:
        steps.length,

      result:
        plannerResult
    },

    queuedTaskIds:
      taskIds,

    executionPasses:
      passResults,

    tasks:
      finalTasks.map(
        summarizeTask
      ),

    queueAfter,

    acceptance
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
    acceptance.passed
      ? " BUILD122 PASSED"
      : " BUILD122 FAILED"
  );

  console.log(
    "=============================================="
  );

  console.log("");
  console.log(
    JSON.stringify(
      acceptance,
      null,
      2
    )
  );

  console.log("");
  console.log(
    `Report: ${REPORT_FILE}`
  );

  if (!acceptance.passed) {
    process.exitCode = 1;
  }

  return report;
}

if (
  require.main === module
) {
  run()
    .catch(
      error => {
        console.error("");
        console.error(
          "BUILD122 FAILED"
        );

        console.error(
          error.stack ||
          error.message
        );

        process.exitCode = 1;
      }
    );
}

module.exports = {
  run
};
