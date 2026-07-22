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

const DATA_DIR =
  path.join(
    ROOT,
    "DATA",
    "runtime"
  );

const QUEUE_FILE =
  path.join(
    DATA_DIR,
    "task_queue.json"
  );

const ARCHIVE_DIR =
  path.join(
    DATA_DIR,
    "queue_archives"
  );

const REPORT_FILE =
  path.join(
    DATA_DIR,
    "build117_production_stabilization.json"
  );

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(
    dir,
    {
      recursive: true
    }
  );
}

function statusUpper(value) {
  return String(
    value || ""
  ).toUpperCase();
}

function isMalformed(task) {
  return Boolean(
    task &&
    (
      typeof task.type === "object" ||
      task.provider === "UNKNOWN" ||
      task.action === "[OBJECT OBJECT]" ||
      typeof task.action === "object"
    )
  );
}

function extractEmbeddedTask(task) {
  if (
    task &&
    typeof task.type === "object" &&
    task.type !== null &&
    !Array.isArray(task.type)
  ) {
    return task.type;
  }

  return null;
}

function normalizeMalformedTask(task) {
  const embedded =
    extractEmbeddedTask(task) ||
    {};

  const embeddedPayload =
    embedded.payload &&
    typeof embedded.payload === "object"
      ? embedded.payload
      : {};

  const provider =
    embedded.provider ||
    embeddedPayload.provider ||
    task.provider ||
    "MILES";

  const action =
    embedded.action ||
    embeddedPayload.action ||
    "ARCHIVED_LEGACY_TASK";

  const type =
    typeof embedded.type === "string"
      ? embedded.type
      : typeof task.type === "string"
        ? task.type
        : "WORKFORCE_STEP";

  const payload = {
    ...embeddedPayload,

    provider,
    action,

    originalMalformedTaskId:
      task.id,

    archivedMalformedWrapper: true,

    archivalReason:
      "Malformed task wrapper created before TaskQueue object-task compatibility was installed."
  };

  return {
    type,
    payload,

    provider,
    action,

    connector:
      embedded.connector ||
      embeddedPayload.connector ||
      task.connector ||
      provider,

    department:
      embedded.department ||
      embeddedPayload.department ||
      task.department ||
      "Operations",

    title:
      embedded.title ||
      task.title ||
      "Archived malformed historical task",

    priority:
      Number(
        embedded.priority ??
        task.priority ??
        50
      ),

    previousStatus:
      task.status,

    status:
      "ARCHIVED",

    archivedAt:
      now(),

    archiveReason:
      "BUILD117_MALFORMED_HISTORICAL_TASK",

    legacyWrapperSnapshot: {
      wrapperId:
        task.id,

      wrapperCreatedAt:
        task.createdAt ||
        null,

      wrapperUpdatedAt:
        task.updatedAt ||
        null,

      wrapperError:
        task.error ||
        null,

      embeddedTaskId:
        embedded.id ||
        null,

      embeddedCreatedAt:
        embedded.createdAt ||
        null
    },

    updatedAt:
      now()
  };
}

function fingerprint(task) {
  const payload =
    task.payload &&
    typeof task.payload === "object"
      ? task.payload
      : {};

  return [
    task.provider ||
      payload.provider ||
      "",

    task.action ||
      payload.action ||
      "",

    payload.autonomousWorkFingerprint ||
      payload.workPackageId ||
      "",

    payload.capability ||
      ""
  ].join("|");
}

function isStaleRunning(task) {
  if (
    statusUpper(task.status) !==
    "RUNNING"
  ) {
    return false;
  }

  const timestamp =
    Date.parse(
      task.updatedAt ||
      task.startedAt ||
      task.createdAt ||
      ""
    );

  return (
    Number.isFinite(timestamp) &&
    Date.now() - timestamp >
      15 * 60 * 1000
  );
}

function backupQueue() {
  ensureDir(
    ARCHIVE_DIR
  );

  if (
    !fs.existsSync(
      QUEUE_FILE
    )
  ) {
    return null;
  }

  const stamp =
    now()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 14);

  const backup =
    path.join(
      ARCHIVE_DIR,
      `task_queue_before_build117_${stamp}.json`
    );

  fs.copyFileSync(
    QUEUE_FILE,
    backup
  );

  return backup;
}

function countStatuses(tasks) {
  const counts = {};

  for (const task of tasks) {
    const status =
      statusUpper(
        task.status ||
        "UNKNOWN"
      );

    counts[status] =
      (
        counts[status] ||
        0
      ) + 1;
  }

  return counts;
}

function run() {
  ensureDir(
    DATA_DIR
  );

  console.log("");
  console.log(
    "=============================================="
  );
  console.log(
    " BUILD117 PRODUCTION STABILIZATION"
  );
  console.log(
    "=============================================="
  );

  const backup =
    backupQueue();

  const before =
    taskQueue.list();

  const malformed =
    before.filter(
      isMalformed
    );

  const staleRunning =
    before.filter(
      isStaleRunning
    );

  const activeFingerprints =
    new Map();

  for (const task of before) {
    const status =
      statusUpper(
        task.status
      );

    if (
      status === "QUEUED" ||
      status === "RUNNING" ||
      status === "AWAITING_APPROVAL" ||
      status === "COMPLETED"
    ) {
      const key =
        fingerprint(task);

      if (key !== "|||") {
        const existing =
          activeFingerprints.get(key) ||
          [];

        existing.push(task);

        activeFingerprints.set(
          key,
          existing
        );
      }
    }
  }

  let malformedArchived = 0;
  let staleRequeued = 0;
  let staleArchived = 0;

  for (const task of malformed) {
    taskQueue.update(
      task.id,
      normalizeMalformedTask(task)
    );

    malformedArchived += 1;
  }

  for (const task of staleRunning) {
    if (
      isMalformed(task)
    ) {
      continue;
    }

    const key =
      fingerprint(task);

    const alternatives =
      (
        activeFingerprints.get(key) ||
        []
      ).filter(
        candidate =>
          candidate.id !== task.id &&
          (
            statusUpper(candidate.status) ===
              "QUEUED" ||
            statusUpper(candidate.status) ===
              "RUNNING" ||
            statusUpper(candidate.status) ===
              "COMPLETED" ||
            statusUpper(candidate.status) ===
              "AWAITING_APPROVAL"
          )
      );

    if (alternatives.length > 0) {
      taskQueue.update(
        task.id,
        {
          previousStatus:
            task.status,

          status:
            "ARCHIVED",

          archivedAt:
            now(),

          archiveReason:
            "BUILD117_STALE_DUPLICATE_RUNNING_TASK",

          duplicateOf:
            alternatives[0].id,

          updatedAt:
            now()
        }
      );

      staleArchived += 1;
    } else {
      taskQueue.update(
        task.id,
        {
          previousStatus:
            task.status,

          status:
            "QUEUED",

          recoveredAt:
            now(),

          recoveryReason:
            "BUILD117_STALE_RUNNING_RECOVERY",

          startedAt:
            null,

          updatedAt:
            now()
        }
      );

      staleRequeued += 1;
    }
  }

  const after =
    taskQueue.list();

  const malformedRemaining =
    after.filter(
      isMalformed
    );

  const staleRemaining =
    after.filter(
      isStaleRunning
    );

  const report = {
    build:
      "BUILD117",

    generatedAt:
      now(),

    backup,

    before: {
      total:
        before.length,

      counts:
        countStatuses(before),

      malformed:
        malformed.length,

      staleRunning:
        staleRunning.length
    },

    actions: {
      malformedArchived,
      staleRequeued,
      staleArchived
    },

    after: {
      total:
        after.length,

      counts:
        countStatuses(after),

      malformed:
        malformedRemaining.length,

      staleRunning:
        staleRemaining.length
    },

    success:
      malformedRemaining.length === 0 &&
      staleRemaining.length === 0
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
    "BUILD117 COMPLETE"
  );

  console.log("");
  console.log(
    JSON.stringify(
      report,
      null,
      2
    )
  );

  console.log("");
  console.log(
    `Report: ${REPORT_FILE}`
  );

  console.log(
    `Backup: ${backup}`
  );

  if (!report.success) {
    process.exitCode = 1;
  }

  return report;
}

if (
  require.main === module
) {
  try {
    run();
  } catch (error) {
    console.error(
      "BUILD117 FAILED"
    );

    console.error(
      error.stack ||
      error.message
    );

    process.exitCode = 1;
  }
}

module.exports = {
  run
};
