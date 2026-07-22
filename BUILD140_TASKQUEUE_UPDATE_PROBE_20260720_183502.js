"use strict";

const fs = require("fs");
const util = require("util");

const taskQueue = require("./CORE/TaskQueue");
const executionService = require("./SERVICES/ExecutionService");

function print(label, value) {
  console.log(`\n==================== ${label} ====================`);
  console.log(
    typeof value === "string"
      ? value
      : util.inspect(value, {
          depth: 8,
          colors: false,
          maxArrayLength: 50,
          breakLength: 140
        })
  );
}

function taskSnapshot(id) {
  const all =
    typeof taskQueue.list === "function"
      ? taskQueue.list()
      : [];

  return all.find(task => task && task.id === id) || null;
}

async function main() {
  print("INITIAL STATUS", taskQueue.getStatus());

  const running =
    typeof taskQueue.list === "function"
      ? taskQueue.list("RUNNING")
      : [];

  print(
    "RUNNING TASKS",
    running.map(task => ({
      id: task.id,
      provider: task.provider,
      action: task.action,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      status: task.status
    }))
  );

  if (!running.length) {
    print("RESULT", "No RUNNING task was available for the probe.");
    return;
  }

  /*
   * Use the oldest stale RUNNING task so the probe does not interfere
   * with newly-created work.
   */
  const target = running
    .slice()
    .sort((a, b) => {
      const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return at - bt;
    })[0];

  print("SELECTED TARGET", {
    id: target.id,
    provider: target.provider,
    action: target.action,
    status: target.status,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt
  });

  const originalUpdate = taskQueue.update.bind(taskQueue);
  let updateSequence = 0;

  taskQueue.update = function instrumentedUpdate(id, patch) {
    updateSequence += 1;

    const before = taskSnapshot(id);

    print(`UPDATE ${updateSequence} REQUEST`, {
      id,
      patch,
      before: before
        ? {
            status: before.status,
            updatedAt: before.updatedAt,
            startedAt: before.startedAt,
            completedAt: before.completedAt,
            failedAt: before.failedAt,
            error: before.error
          }
        : null
    });

    let returned;

    try {
      returned = originalUpdate(id, patch);
    } catch (error) {
      print(`UPDATE ${updateSequence} THREW`, {
        message: error.message,
        stack: error.stack
      });

      throw error;
    }

    const after = taskSnapshot(id);

    print(`UPDATE ${updateSequence} PERSISTED`, {
      returned,
      after: after
        ? {
            status: after.status,
            updatedAt: after.updatedAt,
            startedAt: after.startedAt,
            completedAt: after.completedAt,
            failedAt: after.failedAt,
            error: after.error,
            resultStatus: after.result?.status || null
          }
        : null
    });

    return returned;
  };

  print("REQUEUE REQUEST", {
    id: target.id,
    from: target.status,
    to: "QUEUED"
  });

  taskQueue.update(target.id, {
    status: "QUEUED",
    recoveredFromStatus: "RUNNING",
    recoveryReason:
      "BUILD140 TaskQueue update lifecycle probe.",
    recoveredAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    failedAt: null,
    error: null
  });

  print("AFTER REQUEUE", taskSnapshot(target.id));
  print("STATUS BEFORE RUNNEXT", taskQueue.getStatus());

  const timeoutMs = 180000;

  const executionResult = await Promise.race([
    executionService.runNext(),
    new Promise(resolve =>
      setTimeout(
        () =>
          resolve({
            ok: false,
            status: "PROBE_TIMEOUT",
            timeoutMs
          }),
        timeoutMs
      )
    )
  ]);

  print("RUNNEXT RESULT", executionResult);
  print("FINAL TARGET ON DISK", taskSnapshot(target.id));
  print("FINAL QUEUE STATUS", taskQueue.getStatus());

  const finalTarget = taskSnapshot(target.id);

  print("PROBE ASSESSMENT", {
    targetId: target.id,
    finalStatus: finalTarget?.status || null,
    updateCallsObserved: updateSequence,
    remainedRunning:
      finalTarget?.status === "RUNNING",
    reachedTerminalState: [
      "COMPLETED",
      "FAILED",
      "AWAITING_APPROVAL",
      "AWAITING_CEO_APPROVAL",
      "BLOCKED",
      "CANCELLED"
    ].includes(finalTarget?.status),
    timedOut:
      executionResult?.status === "PROBE_TIMEOUT"
  });
}

main()
  .then(() => {
    console.log("\nBUILD140_TASKQUEUE_UPDATE_PROBE_COMPLETE");
  })
  .catch(error => {
    print("FATAL ERROR", {
      message: error.message,
      stack: error.stack
    });

    process.exitCode = 1;
  });
