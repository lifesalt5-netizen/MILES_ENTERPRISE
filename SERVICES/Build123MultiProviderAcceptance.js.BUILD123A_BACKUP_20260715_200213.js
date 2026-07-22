"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const REPORT_DIR =
  path.join(
    ROOT,
    "DATA",
    "runtime"
  );

const REPORT_FILE =
  path.join(
    REPORT_DIR,
    "build123_multi_provider_acceptance.json"
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

const SCENARIOS = [
  {
    id: "MARKETING",
    objective:
      "Audit Instantly campaign health, mailbox readiness, deliverability state, and current P2GC segment inventory. Perform read-only preparation and produce verified recommendations.",
    expectedProvider:
      "MarketingProvider",
    allowedActions: [
      "refresh",
      "audit",
      "auditMarketing",
      "auditInstantly"
    ]
  },

  {
    id: "ORION",
    objective:
      "Refresh ORION intelligence and verify current contractor, buyer, opportunity, recompete, recommendation, and persona data availability. Perform read-only intelligence validation.",
    expectedProvider:
      "OrionProvider",
    allowedActions: [
      "refresh",
      "auditIntelligence",
      "getSummary"
    ]
  },

  {
    id: "WEBSITE",
    objective:
      "Audit the P2GC website for availability, HTTPS, links, forms, accessibility indicators, SEO basics, and content drift. Perform read-only verification only.",
    expectedProvider:
      "WebsiteProvider",
    allowedActions: [
      "verifyWebsite",
      "refresh",
      "auditWebsite"
    ]
  },

  {
    id: "GOOGLE_WORKSPACE",
    objective:
      "Audit Google Workspace operational readiness, credentials, Gmail, Calendar, Drive, and connected workspace services. Perform read-only verification only.",
    expectedProvider:
      "GoogleWorkspaceProvider",
    allowedActions: [
      "auditWorkspace",
      "refresh",
      "audit"
    ]
  }
];

function now() {
  return new Date().toISOString();
}

function ensureDirectory(directory) {
  fs.mkdirSync(
    directory,
    {
      recursive: true
    }
  );
}

function upper(value) {
  return String(
    value ||
    "UNKNOWN"
  ).toUpperCase();
}

function firstValue(...values) {
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

function getOperationalPlan(result) {
  return (
    result?.operationalPlan ||
    result?.plan ||
    result ||
    {}
  );
}

function getSteps(result) {
  const plan =
    getOperationalPlan(
      result
    );

  if (
    Array.isArray(
      plan.steps
    )
  ) {
    return plan.steps;
  }

  if (
    Array.isArray(
      result?.steps
    )
  ) {
    return result.steps;
  }

  return [];
}

function buildTask(
  scenario,
  plannerResult,
  step,
  index
) {
  const operationalPlan =
    getOperationalPlan(
      plannerResult
    );

  const provider =
    firstValue(
      step.provider,
      operationalPlan.provider,
      scenario.expectedProvider
    );

  const action =
    firstValue(
      step.action,
      step.capability,
      operationalPlan.action,
      scenario.allowedActions[0]
    );

  const department =
    firstValue(
      step.department,
      operationalPlan.department,
      "Operations"
    );

  const connector =
    firstValue(
      step.connector,
      operationalPlan.connector,
      step.system,
      provider
    );

  const taskType =
    firstValue(
      step.taskType,
      step.type,
      "WORKFORCE_STEP"
    );

  const id =
    [
      "BUILD123",
      scenario.id,
      Date.now(),
      index + 1,
      Math.floor(
        Math.random() *
        100000
      )
    ].join("-");

  const plan = {
    ...operationalPlan,

    objective:
      scenario.objective,

    originalCommand:
      scenario.objective,

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
        connector,
        taskType,
        status:
          "QUEUED"
      }
    ]
  };

  return {
    id,

    type:
      taskType,

    status:
      "QUEUED",

    priority:
      Number(
        step.priority ??
        operationalPlan.priority ??
        3
      ),

    title:
      step.title ||
      step.expectedOutput ||
      `BUILD123 ${scenario.id} acceptance`,

    provider,
    action,
    department,
    connector,

    source:
      "Build123MultiProviderAcceptance",

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

      objective:
        scenario.objective,

      originalCommand:
        scenario.objective,

      expectedOutput:
        step.expectedOutput ||
        null,

      verification:
        step.verification ||
        null,

      assignedTo:
        step.assignedTo ||
        null,

      acceptanceBuild:
        "BUILD123",

      acceptanceScenario:
        scenario.id,

      autonomous:
        true,

      readOnly:
        true,

      safeToAutoExecute:
        true,

      plan
    },

    plan
  };
}

function getTask(id) {
  return taskQueue
    .list()
    .find(
      task =>
        task.id === id
    ) ||
    null;
}

function isMalformed(task) {
  return Boolean(
    task &&
    (
      typeof task.type ===
        "object" ||
      task.provider ===
        "UNKNOWN" ||
      task.action ===
        "[OBJECT OBJECT]" ||
      typeof task.action ===
        "object"
    )
  );
}

function summarizeTask(task) {
  if (!task) {
    return null;
  }

  return {
    id:
      task.id,

    status:
      upper(
        task.status
      ),

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

    result:
      task.result ||
      null,

    evidence:
      task.evidence ||
      task.result?.evidence ||
      task.result?.evidenceFile ||
      null,

    error:
      task.error ||
      task.result?.error ||
      task.result?.message ||
      null,

    authority:
      task.authority ||
      task.result?.authority ||
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

async function executeScenario(
  scenario,
  index
) {
  console.log("");
  console.log(
    `===== ${scenario.id} =====`
  );

  console.log(
    `Planning: ${scenario.objective}`
  );

  const plannerResult =
    await Promise.resolve(
      capabilityService
        .planObjective(
          scenario.objective
        )
    );

  const steps =
    getSteps(
      plannerResult
    );

  if (!steps.length) {
    return {
      scenario:
        scenario.id,

      passed:
        false,

      stage:
        "PLANNING",

      error:
        "Planner returned no operational steps.",

      plannerResult
    };
  }

  const task =
    buildTask(
      scenario,
      plannerResult,
      steps[0],
      index
    );

  console.log(
    [
      "PLANNED",
      task.provider,
      task.action,
      task.type
    ].join(" | ")
  );

  const created =
    taskQueue.add(
      task
    );

  console.log(
    [
      "QUEUED",
      created.id,
      created.provider ||
        created.payload?.provider,
      created.action ||
        created.payload?.action
    ].join(" | ")
  );

  let executionResult;

  try {
    executionResult =
      await executionService
        .execute(
          created
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
  }

  const persisted =
    getTask(
      created.id
    );

  const finalStatus =
    upper(
      persisted?.status ||
      executionResult?.status
    );

  const actualProvider =
    persisted?.provider ||
    persisted?.payload?.provider ||
    executionResult?.provider ||
    null;

  const actualAction =
    persisted?.action ||
    persisted?.payload?.action ||
    executionResult?.action ||
    null;

  const terminal =
    [
      "COMPLETED",
      "AWAITING_APPROVAL"
    ].includes(
      finalStatus
    );

  const providerPassed =
    actualProvider ===
    scenario.expectedProvider;

  const actionPassed =
    scenario.allowedActions
      .includes(
        actualAction
      );

  const queuePassed =
    !isMalformed(
      persisted
    );

  const executionPassed =
    executionResult?.ok !==
      false &&
    terminal;

  const passed =
    providerPassed &&
    actionPassed &&
    queuePassed &&
    executionPassed;

  console.log(
    [
      passed
        ? "PASSED"
        : "FAILED",
      finalStatus,
      actualProvider,
      actualAction,
      `ok=${executionResult?.ok !== false}`
    ].join(" | ")
  );

  return {
    scenario:
      scenario.id,

    objective:
      scenario.objective,

    passed,

    checks: {
      plannerProducedSteps:
        steps.length > 0,

      expectedProvider:
        scenario.expectedProvider,

      actualProvider,

      providerPassed,

      allowedActions:
        scenario.allowedActions,

      actualAction,

      actionPassed,

      queuePassed,

      executionPassed,

      terminalStatus:
        terminal
    },

    planner: {
      stepCount:
        steps.length,

      operationalPlan:
        getOperationalPlan(
          plannerResult
        )
    },

    executionResult,

    persistedTask:
      summarizeTask(
        persisted
      )
  };
}

async function run() {
  ensureDirectory(
    REPORT_DIR
  );

  console.log("");
  console.log(
    "=============================================="
  );

  console.log(
    " BUILD123 MULTI-PROVIDER ACCEPTANCE"
  );

  console.log(
    "=============================================="
  );

  const queueBefore =
    taskQueue.list();

  const malformedBefore =
    queueBefore.filter(
      isMalformed
    ).length;

  if (
    malformedBefore >
    0
  ) {
    throw new Error(
      `BUILD123 blocked: ${malformedBefore} malformed task(s) remain.`
    );
  }

  const results = [];

  for (
    let index = 0;
    index < SCENARIOS.length;
    index += 1
  ) {
    results.push(
      await executeScenario(
        SCENARIOS[index],
        index
      )
    );
  }

  const queueAfter =
    taskQueue.list();

  const malformedAfter =
    queueAfter.filter(
      isMalformed
    ).length;

  const passed =
    results.filter(
      result =>
        result.passed
    ).length;

  const failed =
    results.length -
    passed;

  const report = {
    build:
      "BUILD123",

    generatedAt:
      now(),

    summary: {
      total:
        results.length,

      passed,

      failed,

      malformedBefore,

      malformedAfter,

      overallPassed:
        failed === 0 &&
        malformedAfter === 0
    },

    results
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
    report.summary.overallPassed
      ? " BUILD123 PASSED"
      : " BUILD123 FAILED"
  );

  console.log(
    "=============================================="
  );

  console.log("");
  console.log(
    JSON.stringify(
      report.summary,
      null,
      2
    )
  );

  console.log("");
  console.log(
    `Report: ${REPORT_FILE}`
  );

  if (
    !report.summary
      .overallPassed
  ) {
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
          "BUILD123 FAILED"
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
