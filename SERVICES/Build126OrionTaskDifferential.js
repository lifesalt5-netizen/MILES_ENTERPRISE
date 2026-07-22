"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const taskQueue =
  require(
    path.join(
      ROOT,
      "CORE",
      "TaskQueue"
    )
  );

const REPORT_DIR =
  path.join(
    ROOT,
    "DATA",
    "runtime"
  );

const REPORT_FILE =
  path.join(
    REPORT_DIR,
    "build126_orion_task_differential.json"
  );

function now() {
  return new Date().toISOString();
}

function status(value) {
  return String(
    value ||
    "UNKNOWN"
  ).toUpperCase();
}

function findLatest(prefix) {
  return taskQueue
    .list()
    .filter(
      task =>
        String(
          task.id ||
          ""
        ).startsWith(prefix)
    )
    .sort(
      (a, b) =>
        new Date(
          b.updatedAt ||
          b.createdAt ||
          0
        ).getTime() -
        new Date(
          a.updatedAt ||
          a.createdAt ||
          0
        ).getTime()
    )[0] ||
    null;
}

function normalizeValue(value) {
  if (
    value === undefined
  ) {
    return "__UNDEFINED__";
  }

  if (
    value === null ||
    typeof value !== "object"
  ) {
    return value;
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      normalizeValue
    );
  }

  const output = {};

  for (
    const key
    of Object.keys(value).sort()
  ) {
    if (
      [
        "result",
        "metrics",
        "counts",
        "contractors",
        "buyers",
        "opportunities",
        "recompetes",
        "recommendations",
        "personas",
        "details",
        "evidence"
      ].includes(key)
    ) {
      continue;
    }

    output[key] =
      normalizeValue(
        value[key]
      );
  }

  return output;
}

function selectTaskFields(task) {
  if (!task) {
    return null;
  }

  const payload =
    task.payload ||
    {};

  const plan =
    payload.plan ||
    task.plan ||
    {};

  const step =
    Array.isArray(
      plan.steps
    )
      ? plan.steps[0] || {}
      : {};

  return {
    id:
      task.id,

    status:
      status(
        task.status
      ),

    type:
      task.type,

    priority:
      task.priority,

    title:
      task.title,

    provider:
      task.provider,

    action:
      task.action,

    connector:
      task.connector,

    system:
      task.system,

    department:
      task.department,

    source:
      task.source,

    workPackageId:
      task.workPackageId,

    requiresApproval:
      task.requiresApproval,

    approvalRequired:
      task.approvalRequired,

    requiresKevin:
      task.requiresKevin,

    safeToAutoExecute:
      task.safeToAutoExecute,

    readOnly:
      task.readOnly,

    autonomous:
      task.autonomous,

    authority:
      task.authority,

    decision:
      task.decision,

    payload: {
      type:
        payload.type,

      provider:
        payload.provider,

      action:
        payload.action,

      connector:
        payload.connector,

      system:
        payload.system,

      department:
        payload.department,

      capability:
        payload.capability,

      assignedTo:
        payload.assignedTo,

      workPackageId:
        payload.workPackageId,

      requiresApproval:
        payload.requiresApproval,

      approvalRequired:
        payload.approvalRequired,

      requiresKevin:
        payload.requiresKevin,

      safeToAutoExecute:
        payload.safeToAutoExecute,

      readOnly:
        payload.readOnly,

      autonomous:
        payload.autonomous,

      objective:
        payload.objective,

      originalCommand:
        payload.originalCommand,

      expectedOutput:
        payload.expectedOutput,

      verification:
        payload.verification
    },

    plan: {
      provider:
        plan.provider,

      action:
        plan.action,

      connector:
        plan.connector,

      system:
        plan.system,

      department:
        plan.department,

      capability:
        plan.capability,

      assignedTo:
        plan.assignedTo,

      workPackageId:
        plan.workPackageId,

      requiresApproval:
        plan.requiresApproval,

      approvalRequired:
        plan.approvalRequired,

      requiresKevin:
        plan.requiresKevin,

      safeToAutoExecute:
        plan.safeToAutoExecute,

      readOnly:
        plan.readOnly,

      autonomous:
        plan.autonomous,

      intent:
        plan.intent,

      workflow:
        plan.workflow,

      objective:
        plan.objective,

      originalCommand:
        plan.originalCommand
    },

    step: {
      provider:
        step.provider,

      action:
        step.action,

      connector:
        step.connector,

      system:
        step.system,

      department:
        step.department,

      capability:
        step.capability,

      assignedTo:
        step.assignedTo,

      taskType:
        step.taskType,

      status:
        step.status,

      requiresApproval:
        step.requiresApproval,

      approvalRequired:
        step.approvalRequired,

      requiresKevin:
        step.requiresKevin,

      safeToAutoExecute:
        step.safeToAutoExecute,

      readOnly:
        step.readOnly,

      autonomous:
        step.autonomous,

      registryMetadata:
        normalizeValue(
          step.registryMetadata
        )
    }
  };
}

function flatten(
  value,
  prefix = "",
  output = {}
) {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    output[prefix] =
      value;

    return output;
  }

  if (
    Array.isArray(value)
  ) {
    output[prefix] =
      JSON.stringify(value);

    return output;
  }

  for (
    const [key, child]
    of Object.entries(value)
  ) {
    const next =
      prefix
        ? `${prefix}.${key}`
        : key;

    flatten(
      child,
      next,
      output
    );
  }

  return output;
}

function compare(left, right) {
  const leftFlat =
    flatten(left);

  const rightFlat =
    flatten(right);

  const keys =
    Array.from(
      new Set([
        ...Object.keys(leftFlat),
        ...Object.keys(rightFlat)
      ])
    ).sort();

  return keys
    .filter(
      key =>
        JSON.stringify(
          leftFlat[key]
        ) !==
        JSON.stringify(
          rightFlat[key]
        )
    )
    .map(
      key => ({
        field:
          key,

        build123:
          leftFlat[key] ===
          undefined
            ? "__MISSING__"
            : leftFlat[key],

        build125:
          rightFlat[key] ===
          undefined
            ? "__MISSING__"
            : rightFlat[key]
      })
    );
}

function findApprovalSignals(
  value,
  prefix = "",
  results = []
) {
  if (
    value === null ||
    value === undefined
  ) {
    return results;
  }

  if (
    typeof value !==
    "object"
  ) {
    const key =
      prefix.toLowerCase();

    const text =
      String(value)
        .toLowerCase();

    if (
      key.includes(
        "approval"
      ) ||
      key.includes(
        "authority"
      ) ||
      key.includes(
        "protected"
      ) ||
      key.includes(
        "requireskevin"
      ) ||
      text ===
        "awaiting_approval"
    ) {
      results.push({
        field:
          prefix,

        value
      });
    }

    return results;
  }

  for (
    const [key, child]
    of Object.entries(value)
  ) {
    findApprovalSignals(
      child,
      prefix
        ? `${prefix}.${key}`
        : key,
      results
    );
  }

  return results;
}

function run() {
  fs.mkdirSync(
    REPORT_DIR,
    {
      recursive: true
    }
  );

  const build123 =
    findLatest(
      "BUILD123-ORION-"
    );

  const build125 =
    findLatest(
      "BUILD125-ORION-"
    );

  if (!build123) {
    throw new Error(
      "No BUILD123 ORION task found."
    );
  }

  if (!build125) {
    throw new Error(
      "No BUILD125 ORION task found."
    );
  }

  const build123Selected =
    selectTaskFields(
      build123
    );

  const build125Selected =
    selectTaskFields(
      build125
    );

  const differences =
    compare(
      build123Selected,
      build125Selected
    );

  const report = {
    build:
      "BUILD126",

    generatedAt:
      now(),

    build123Task:
      build123Selected,

    build125Task:
      build125Selected,

    build123ApprovalSignals:
      findApprovalSignals(
        build123Selected
      ),

    build125ApprovalSignals:
      findApprovalSignals(
        build125Selected
      ),

    differences
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
    " BUILD126 ORION TASK DIFFERENTIAL"
  );

  console.log(
    "=============================================="
  );

  console.log("");
  console.log(
    `BUILD123: ${build123.id} | ${build123.status}`
  );

  console.log(
    `BUILD125: ${build125.id} | ${build125.status}`
  );

  console.log("");
  console.log(
    "BUILD123 APPROVAL SIGNALS"
  );

  console.log(
    JSON.stringify(
      report.build123ApprovalSignals,
      null,
      2
    )
  );

  console.log("");
  console.log(
    "BUILD125 APPROVAL SIGNALS"
  );

  console.log(
    JSON.stringify(
      report.build125ApprovalSignals,
      null,
      2
    )
  );

  console.log("");
  console.log(
    "DIFFERENCES"
  );

  console.log(
    JSON.stringify(
      differences,
      null,
      2
    )
  );

  console.log("");
  console.log(
    `Report: ${REPORT_FILE}`
  );
}

try {
  run();
} catch (error) {
  console.error("");
  console.error(
    "BUILD126 FAILED"
  );

  console.error(
    error.stack ||
    error.message
  );

  process.exitCode = 1;
}
