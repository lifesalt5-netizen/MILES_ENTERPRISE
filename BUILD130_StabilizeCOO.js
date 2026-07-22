"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const QUEUE_FILE = path.join(ROOT, "DATA", "runtime", "task_queue.json");
const BACKUP_DIR = path.join(ROOT, "BACKUPS");
const ORPHAN_ID = "TASK-1784240802830-36627";

function stamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "_");
}

function asStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function parseTime(task) {
  const candidate =
    task.updatedAt ||
    task.completedAt ||
    task.startedAt ||
    task.createdAt ||
    task.timestamp;

  const value = Date.parse(candidate || "");
  return Number.isFinite(value) ? value : 0;
}

function approvalRequired(task) {
  const authorityDenied =
    task &&
    task.authority &&
    task.authority.allowed === false;

  return Boolean(
    task.requiresApproval === true ||
    task.requiresCEOApproval === true ||
    task.ceoApprovalRequired === true ||
    authorityDenied
  );
}

function countByStatus(tasks) {
  return tasks.reduce((result, task) => {
    const status = asStatus(task.status) || "UNKNOWN";
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});
}

function main() {
  if (!fs.existsSync(QUEUE_FILE)) {
    throw new Error(`Queue file not found: ${QUEUE_FILE}`);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const backupFile = path.join(
    BACKUP_DIR,
    `task_queue_pre_BUILD130_${stamp()}.json`
  );

  fs.copyFileSync(QUEUE_FILE, backupFile);
  console.log("[BUILD130] Backup:", backupFile);

  const TaskQueue = require(path.join(ROOT, "CORE", "TaskQueue"));
  const before = TaskQueue.list();

  if (!Array.isArray(before)) {
    throw new Error("TaskQueue.list() did not return an array.");
  }

  console.log("[BUILD130] Queue before:", before.length);
  console.log("[BUILD130] Before status:", countByStatus(before));

  const now = new Date();
  const nowIso = now.toISOString();
  const staleRunningCutoff = now.getTime() - 30 * 60 * 1000;

  let staleRecovered = 0;
  let approvalsCorrected = 0;
  let orphanBlocked = 0;
  let malformedBlocked = 0;

  for (const task of before) {
    if (!task || !task.id) {
      continue;
    }

    const status = asStatus(task.status);

    /*
     * Recover work abandoned in RUNNING for more than 30 minutes.
     */
    if (
      status === "RUNNING" &&
      parseTime(task) > 0 &&
      parseTime(task) < staleRunningCutoff
    ) {
      TaskQueue.update(task.id, {
        status: "QUEUED",
        updatedAt: nowIso,
        recoveredAt: nowIso,
        recoveryReason:
          "BUILD130 recovered task abandoned in RUNNING for more than 30 minutes."
      });

      staleRecovered++;
      continue;
    }

    /*
     * Remove approval-gated work from the executable queue.
     */
    if (status === "QUEUED" && approvalRequired(task)) {
      TaskQueue.update(task.id, {
        status: "AWAITING_APPROVAL",
        updatedAt: nowIso,
        approvalReason:
          task.approvalReason ||
          "BUILD130 identified approval-gated work."
      });

      approvalsCorrected++;
      continue;
    }

    /*
     * Isolate the persistent queue orphan discovered during BUILD128.
     */
    if (task.id === ORPHAN_ID && status === "QUEUED") {
      TaskQueue.update(task.id, {
        status: "BLOCKED",
        updatedAt: nowIso,
        requiresReview: true,
        blockedReason:
          "BUILD130 isolated persistent task that remained queued but was never selected."
      });

      orphanBlocked++;
      continue;
    }

    /*
     * Block executable records that cannot be routed.
     */
    if (
      status === "QUEUED" &&
      (!task.provider || !task.action)
    ) {
      TaskQueue.update(task.id, {
        status: "BLOCKED",
        updatedAt: nowIso,
        requiresReview: true,
        blockedReason:
          "BUILD130 blocked malformed queued task missing provider or action."
      });

      malformedBlocked++;
    }
  }

  /*
   * Rewrite through the BUILD128 integrity layer.
   * This normalizes IDs and compacts stale duplicate representations.
   */
  const repaired = TaskQueue.list();
  TaskQueue._write(repaired);

  const after = TaskQueue.list();

  const duplicateIds = [];
  const seen = new Set();

  for (const task of after) {
    if (!task || !task.id) {
      continue;
    }

    if (seen.has(task.id)) {
      duplicateIds.push(task.id);
    }

    seen.add(task.id);
  }

  console.log("");
  console.log("[BUILD130] RESULTS");
  console.log("[BUILD130] Queue before:", before.length);
  console.log("[BUILD130] Queue after :", after.length);
  console.log("[BUILD130] Stale RUNNING recovered:", staleRecovered);
  console.log("[BUILD130] Approval tasks corrected:", approvalsCorrected);
  console.log("[BUILD130] Persistent orphan blocked:", orphanBlocked);
  console.log("[BUILD130] Malformed queued tasks blocked:", malformedBlocked);
  console.log("[BUILD130] Duplicate IDs remaining:", duplicateIds.length);
  console.log("[BUILD130] After status:", countByStatus(after));

  if (duplicateIds.length > 0) {
    throw new Error(
      `Queue still contains duplicate IDs: ${duplicateIds.slice(0, 10).join(", ")}`
    );
  }

  const orphan = after.find(task => task && task.id === ORPHAN_ID);

  if (orphan) {
    console.log(
      "[BUILD130] Persistent task final status:",
      asStatus(orphan.status)
    );
  }

  console.log("");
  console.log("[BUILD130] COO queue stabilization PASSED.");
}

try {
  main();
} catch (error) {
  console.error("[BUILD130] FAILED:", error.stack || error.message);
  process.exit(1);
}
