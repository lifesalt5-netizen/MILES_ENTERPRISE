"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const WorkQueueService =
  require("./WorkQueueService");

const ROOT =
  process.env.MILES_ROOT ||
  process.cwd();

const OUTPUT_DIR =
  path.join(
    ROOT,
    "DATA",
    "runtime"
  );

const REPORT_FILE =
  path.join(
    OUTPUT_DIR,
    "build105a_work_queue_persistence_audit.json"
  );

function now() {
  return new Date().toISOString();
}

function ensureDir(directory) {
  fs.mkdirSync(directory, {
    recursive: true
  });
}

function safeStat(filePath) {
  try {
    const stat = fs.statSync(filePath);

    return {
      exists: true,
      size: stat.size,
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      modifiedMs: stat.mtimeMs
    };
  } catch (error) {
    return {
      exists: false,
      error: error.message
    };
  }
}

function safeReadJson(filePath) {
  try {
    const raw =
      fs.readFileSync(filePath, "utf8")
        .replace(/^\uFEFF/, "");

    return {
      ok: true,
      value: JSON.parse(raw)
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      value: null
    };
  }
}

function hashFile(filePath) {
  try {
    const content =
      fs.readFileSync(filePath);

    return crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");
  } catch {
    return null;
  }
}

function sleep(milliseconds) {
  return new Promise(resolve =>
    setTimeout(resolve, milliseconds)
  );
}

function normalizeItems(document) {
  if (Array.isArray(document)) {
    return document;
  }

  if (
    document &&
    Array.isArray(document.items)
  ) {
    return document.items;
  }

  return [];
}

function findItem(document, id) {
  return (
    normalizeItems(document)
      .find(item =>
        item &&
        item.id === id
      ) || null
  );
}

function snapshotFile(filePath) {
  const read =
    safeReadJson(filePath);

  return {
    filePath,
    stat: safeStat(filePath),
    hash: hashFile(filePath),
    parseOk: read.ok,
    parseError: read.error || null,
    itemCount:
      read.ok
        ? normalizeItems(read.value).length
        : 0,
    value: read.value
  };
}

function createProbeInput() {
  const token =
    `${Date.now()}-${process.pid}`;

  return {
    priority: 4,
    area: "BUILD105A",
    title:
      `BUILD105A WorkQueue Persistence Probe ${token}`,
    description:
      "Temporary diagnostic work item created to verify WorkQueue persistence, reload behavior, path consistency, locking, and concurrent modification.",
    reason:
      "Diagnose queue persistence failure after workflow creation.",
    source:
      "WorkQueuePersistenceAudit",
    owner:
      "MILES",
    requiresKevin:
      false,
    recommendedAction:
      `Audit queue persistence probe ${token}`,
    expectedImpact:
      "Identify the exact WorkQueue persistence failure.",
    relatedProvider:
      "MILES",
    capability:
      "runtime.workqueue.persistence.audit",
    provider:
      "MILES",
    action:
      "ENGINEERING_ANALYZE",
    executionType:
      "WORKFLOW",
    metadata: {
      build:
        "BUILD105A",
      token,
      diagnostic:
        true
    }
  };
}

async function runAudit() {
  ensureDir(OUTPUT_DIR);

  const queue =
    new WorkQueueService();

  const report = {
    ok: false,
    type:
      "BUILD105A_WORK_QUEUE_PERSISTENCE_AUDIT",
    generatedAt:
      now(),
    pid:
      process.pid,
    cwd:
      process.cwd(),
    milesRoot:
      process.env.MILES_ROOT || null,
    queuePath:
      queue.queuePath,
    archivePath:
      queue.archivePath,
    lockPath:
      queue.lockPath,
    steps: [],
    findings: [],
    cleanup: null
  };

  const record = (
    name,
    data
  ) => {
    report.steps.push({
      name,
      recordedAt: now(),
      ...data
    });
  };

  try {
    record(
      "INITIAL_STATE",
      {
        queueLength:
          queue.getAll().length,
        stats:
          queue.getStats(),
        file:
          snapshotFile(queue.queuePath)
      }
    );

    const probeInput =
      createProbeInput();

    const created =
      queue.createWorkItem(
        probeInput
      );

    record(
      "AFTER_CREATE",
      {
        created,
        inMemory:
          queue.getById(created.id),
        file:
          snapshotFile(queue.queuePath)
      }
    );

    const queued =
      queue.markQueued(
        created.id,
        {
          build:
            "BUILD105A",
          queuedBy:
            "WorkQueuePersistenceAudit",
          queuedAt:
            now(),
          testMarker:
            crypto.randomUUID()
        }
      );

    record(
      "AFTER_MARK_QUEUED",
      {
        returned:
          queued,
        returnedStatus:
          queued?.status || null,
        inMemory:
          queue.getById(created.id),
        file:
          snapshotFile(queue.queuePath)
      }
    );

    await sleep(250);

    const afterDelay =
      snapshotFile(
        queue.queuePath
      );

    record(
      "AFTER_250MS",
      {
        file:
          afterDelay,
        persistedItem:
          findItem(
            afterDelay.value,
            created.id
          )
      }
    );

    queue.load();

    record(
      "AFTER_RELOAD_SAME_INSTANCE",
      {
        inMemory:
          queue.getById(created.id),
        stats:
          queue.getStats(),
        file:
          snapshotFile(queue.queuePath)
      }
    );

    const secondInstance =
      new WorkQueueService({
        queuePath:
          queue.queuePath,
        archivePath:
          queue.archivePath,
        lockPath:
          queue.lockPath
      });

    record(
      "SECOND_INSTANCE_READ",
      {
        inMemory:
          secondInstance.getById(
            created.id
          ),
        stats:
          secondInstance.getStats(),
        file:
          snapshotFile(queue.queuePath)
      }
    );

    await sleep(1000);

    const afterOneSecond =
      snapshotFile(
        queue.queuePath
      );

    record(
      "AFTER_1_SECOND",
      {
        file:
          afterOneSecond,
        persistedItem:
          findItem(
            afterOneSecond.value,
            created.id
          )
      }
    );

    const finalItem =
      findItem(
        afterOneSecond.value,
        created.id
      );

    if (!queued) {
      report.findings.push({
        severity:
          "CRITICAL",
        code:
          "MARK_QUEUED_RETURNED_NULL",
        message:
          "markQueued() returned null. The source item was not found during the update transaction."
      });
    }

    if (
      queued &&
      queued.status !== "Queued"
    ) {
      report.findings.push({
        severity:
          "CRITICAL",
        code:
          "MARK_QUEUED_WRONG_STATUS",
        message:
          `markQueued() returned status ${queued.status}.`
      });
    }

    if (!finalItem) {
      report.findings.push({
        severity:
          "CRITICAL",
        code:
          "ITEM_DISAPPEARED",
        message:
          "The diagnostic work item disappeared from the persisted WorkQueue document."
      });
    } else if (
      finalItem.status !==
      "Queued"
    ) {
      report.findings.push({
        severity:
          "CRITICAL",
        code:
          "STATUS_REVERTED",
        message:
          `The diagnostic item status changed from Queued to ${finalItem.status}.`,
        finalItem
      });
    }

    const initialStep =
      report.steps.find(
        step =>
          step.name ===
          "INITIAL_STATE"
      );

    const finalHash =
      afterOneSecond.hash;

    if (
      initialStep?.file?.hash &&
      initialStep.file.hash ===
        finalHash
    ) {
      report.findings.push({
        severity:
          "WARNING",
        code:
          "QUEUE_FILE_HASH_UNCHANGED",
        message:
          "The queue file hash did not change after creating and queuing the diagnostic work item."
      });
    }

    if (
      path.resolve(queue.queuePath)
        .toLowerCase() !==
      path.resolve(
        ROOT,
        "DATA",
        "runtime",
        "work_queue.json"
      ).toLowerCase()
    ) {
      report.findings.push({
        severity:
          "WARNING",
        code:
          "UNEXPECTED_QUEUE_PATH",
        message:
          "WorkQueueService is not using the expected MILES_ROOT/DATA/runtime/work_queue.json path.",
        actual:
          queue.queuePath,
        expected:
          path.resolve(
            ROOT,
            "DATA",
            "runtime",
            "work_queue.json"
          )
      });
    }

    report.ok =
      report.findings.every(
        finding =>
          finding.severity !==
          "CRITICAL"
      );

    const cleanupQueue =
      new WorkQueueService({
        queuePath:
          queue.queuePath,
        archivePath:
          queue.archivePath,
        lockPath:
          queue.lockPath
      });

    const cleanupItem =
      cleanupQueue.getById(
        created.id
      );

    if (cleanupItem) {
      const cleanupResult =
        cleanupQueue.markCancelled(
          created.id,
          {
            build:
              "BUILD105A",
            diagnosticCleanup:
              true,
            cleanedAt:
              now()
          }
        );

      report.cleanup = {
        attempted:
          true,
        status:
          cleanupResult?.status ||
          null,
        itemId:
          created.id
      };
    } else {
      report.cleanup = {
        attempted:
          false,
        reason:
          "Diagnostic item was no longer present.",
        itemId:
          created.id
      };
    }
  } catch (error) {
    report.ok = false;

    report.findings.push({
      severity:
        "CRITICAL",
      code:
        "AUDIT_EXCEPTION",
      message:
        error.message,
      stack:
        error.stack
    });
  }

  report.completedAt =
    now();

  fs.writeFileSync(
    REPORT_FILE,
    JSON.stringify(
      report,
      null,
      2
    ),
    "utf8"
  );

  return report;
}

if (
  require.main === module
) {
  runAudit()
    .then(report => {
      console.log("");
      console.log(
        "=============================================="
      );
      console.log(
        " BUILD105A WORKQUEUE PERSISTENCE AUDIT"
      );
      console.log(
        "=============================================="
      );
      console.log(
        "OK:",
        report.ok
      );
      console.log(
        "Queue:",
        report.queuePath
      );
      console.log(
        "Findings:",
        report.findings.length
      );

      for (
        const finding of
        report.findings
      ) {
        console.log(
          `- [${finding.severity}] ${finding.code}: ${finding.message}`
        );
      }

      console.log("");
      console.log(
        "Report:",
        REPORT_FILE
      );
      console.log("");
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  runAudit
};