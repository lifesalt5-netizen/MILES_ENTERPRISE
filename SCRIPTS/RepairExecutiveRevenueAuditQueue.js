"use strict";

const fs = require("fs");
const path = require("path");

const REPAIR_ID = "EXECUTIVE_REVENUE_AUDIT_ROUTING_20260727";
const EXECUTION_ID = "BIZ-1785162740905-rqgotq";

const ROUTES = Object.freeze({
  "TASK-1785162742112-72198": {
    action: "campaign_audit",
    capability: "marketing.campaign.audit",
    governanceIntent: "AUDIT"
  },
  "TASK-1785162746106-84484": {
    action: "capacity_audit",
    capability: "revenue.outbound.capacity.audit",
    governanceIntent: "AUDIT"
  },
  "TASK-1785162748832-1718": {
    action: "segment_audit",
    capability: "revenue.outbound.segment.audit",
    governanceIntent: "AUDIT"
  },
  "TASK-1785163877491-39271": {
    action: "plan_marketing_actions",
    capability: "revenue.outbound.plan",
    governanceIntent: "PLAN"
  },
  "TASK-1785162764771-19266": {
    action: "plan_marketing_actions",
    capability: "revenue.outbound.plan",
    governanceIntent: "PLAN"
  },
  "TASK-1785162769239-42767": {
    action: "capacity_audit",
    capability: "revenue.outbound.capacity.audit",
    governanceIntent: "AUDIT"
  },
  "TASK-1785162778506-88209": {
    action: "segment_audit",
    capability: "revenue.outbound.segment.audit",
    governanceIntent: "AUDIT"
  },
  "TASK-1785162783499-3810": {
    action: "plan_marketing_actions",
    capability: "revenue.outbound.plan",
    governanceIntent: "PLAN"
  }
});

function now() {
  return new Date().toISOString();
}

function cleanRuntimeFailureFields(value = {}) {
  const cleaned = { ...value };

  for (const key of [
    "approval",
    "authority",
    "bridgeFailedAt",
    "error",
    "governance",
    "result",
    "taskQueueStatus"
  ]) {
    delete cleaned[key];
  }

  return cleaned;
}

function buildRepairedTask(task, route, repairedAt = now()) {
  const originalPayload = task.payload || {};
  const originalPlan = originalPayload.plan || {};
  const payload = cleanRuntimeFailureFields(originalPayload);
  const plan = cleanRuntimeFailureFields(originalPlan);

  const routing = {
    provider: "MarketingProvider",
    connector: "WORKFORCE",
    system: "MarketingProvider",
    department: "Revenue Operations",
    assignedTo: "InstantlyExecutiveAdvisor",
    action: route.action,
    capability: route.capability,
    governanceIntent: route.governanceIntent,
    requiresKevin: false
  };

  return {
    ...cleanRuntimeFailureFields(task),
    type: "WORKFORCE_STEP",
    status: "QUEUED",
    ...routing,
    payload: {
      ...payload,
      ...routing,
      executionType: "WORKFORCE_STEP",
      originalAction:
        payload.originalAction ||
        payload.action ||
        task.action ||
        task.type ||
        null,
      originalTaskType:
        payload.originalTaskType ||
        payload.taskType ||
        payload.type ||
        task.type ||
        null,
      status: "READY",
      plan: {
        ...plan,
        ...routing,
        executionType: "WORKFORCE_STEP"
      },
      repairedAt,
      repairId: REPAIR_ID
    },
    repairedAt,
    repairId: REPAIR_ID,
    updatedAt: repairedAt,
    error: null,
    result: null,
    approval: null,
    authority: null,
    governance: null
  };
}

function inspectTasks(tasks) {
  const taskById = new Map(
    (Array.isArray(tasks) ? tasks : [])
      .filter(task => task && task.id)
      .map(task => [task.id, task])
  );

  return Object.entries(ROUTES).map(([id, route]) => {
    const task = taskById.get(id);

    return {
      id,
      found: Boolean(task),
      sourceExecutionId: task?.payload?.sourceExecutionId || null,
      status: task?.status || null,
      type: task?.type || null,
      provider: task?.payload?.provider || task?.provider || null,
      connector: task?.payload?.connector || task?.connector || null,
      action: task?.payload?.action || task?.action || null,
      targetAction: route.action,
      targetIntent: route.governanceIntent,
      alreadyRepaired:
        task?.repairId === REPAIR_ID &&
        task?.type === "WORKFORCE_STEP" &&
        task?.payload?.provider === "MarketingProvider" &&
        task?.payload?.connector === "WORKFORCE" &&
        task?.payload?.action === route.action
    };
  });
}

function validatePreconditions(tasks) {
  const inspection = inspectTasks(tasks);
  const missing = inspection.filter(item => !item.found);
  const wrongExecution = inspection.filter(
    item =>
      item.found &&
      item.sourceExecutionId !== EXECUTION_ID
  );

  if (missing.length) {
    throw new Error(
      `Repair stopped: missing task IDs: ${missing
        .map(item => item.id)
        .join(", ")}`
    );
  }

  if (wrongExecution.length) {
    throw new Error(
      `Repair stopped: task IDs do not belong to ${EXECUTION_ID}: ${wrongExecution
        .map(item => item.id)
        .join(", ")}`
    );
  }

  return inspection;
}

function repairTasks(tasks, repairedAt = now()) {
  validatePreconditions(tasks);

  const changed = [];
  const repairedTasks = tasks.map(task => {
    const route = ROUTES[task?.id];

    if (!route) {
      return task;
    }

    const repaired = buildRepairedTask(
      task,
      route,
      repairedAt
    );

    changed.push({
      id: task.id,
      from: {
        type: task.type || null,
        status: task.status || null,
        provider: task.payload?.provider || task.provider || null,
        connector: task.payload?.connector || task.connector || null,
        action: task.payload?.action || task.action || null
      },
      to: {
        type: repaired.type,
        status: repaired.status,
        provider: repaired.payload.provider,
        connector: repaired.payload.connector,
        action: repaired.payload.action,
        governanceIntent:
          repaired.payload.governanceIntent
      }
    });

    return repaired;
  });

  return {
    tasks: repairedTasks,
    changed
  };
}

function applyRepair(options = {}) {
  const root =
    options.root ||
    process.env.MILES_ROOT ||
    process.cwd();

  process.env.MILES_ROOT = root;

  const queuePath = path.join(
    root,
    "DATA",
    "runtime",
    "task_queue.json"
  );

  if (!fs.existsSync(queuePath)) {
    throw new Error(
      `TaskQueue file was not found: ${queuePath}`
    );
  }

  const taskQueue = require(
    path.join(root, "CORE", "TaskQueue")
  );

  const dryRun = options.apply !== true;
  const before = taskQueue.list();
  const inspection = validatePreconditions(before);

  if (dryRun) {
    return {
      ok: true,
      mode: "DRY_RUN",
      queuePath,
      inspection
    };
  }

  const backupDir =
    options.backupDir ||
    process.env.MILES_RECOVERY_QUEUE_BACKUP_DIR ||
    path.join(
      root,
      "DATA",
      "runtime",
      "queue_backups"
    );

  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = now().replace(/[:.]/g, "-");
  const backupPath = path.join(
    backupDir,
    `task_queue_before_${REPAIR_ID}_${stamp}.json`
  );

  fs.copyFileSync(queuePath, backupPath);

  const repairedAt = now();
  let changed = [];

  taskQueue.withLock(() => {
    const current = taskQueue.readJsonDirect();
    const repaired = repairTasks(current, repairedAt);
    changed = repaired.changed;
    taskQueue.writeJsonDirect(repaired.tasks);
  });

  const after = taskQueue.list();
  const verification = inspectTasks(after);
  const failed = verification.filter(
    item => !item.alreadyRepaired
  );

  if (failed.length) {
    throw new Error(
      `Post-repair verification failed for: ${failed
        .map(item => item.id)
        .join(", ")}`
    );
  }

  const report = {
    ok: true,
    mode: "APPLIED",
    repairId: REPAIR_ID,
    executionId: EXECUTION_ID,
    queuePath,
    backupPath,
    changed,
    verification,
    repairedAt
  };

  const reportPath = path.join(
    root,
    "DATA",
    "runtime",
    `revenue_audit_queue_repair_${stamp}.json`
  );

  fs.writeFileSync(
    reportPath,
    JSON.stringify(report, null, 2),
    "utf8"
  );

  return {
    ...report,
    reportPath
  };
}

if (require.main === module) {
  try {
    const apply =
      process.argv.includes("--apply");

    const result = applyRepair({ apply });
    console.log(
      JSON.stringify(result, null, 2)
    );

    if (!apply) {
      console.log(
        "\nDRY RUN ONLY. Re-run with --apply after reviewing the eight records."
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        repairId: REPAIR_ID,
        error: error.message,
        stack: error.stack
      }, null, 2)
    );
    process.exitCode = 1;
  }
}

module.exports = {
  EXECUTION_ID,
  REPAIR_ID,
  ROUTES,
  applyRepair,
  buildRepairedTask,
  inspectTasks,
  repairTasks,
  validatePreconditions
};
