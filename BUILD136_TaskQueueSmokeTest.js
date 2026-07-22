"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  process.cwd();

const queuePath =
  path.join(
    ROOT,
    "DATA",
    "runtime",
    "task_queue.json"
  );

const taskQueue =
  require("./CORE/TaskQueue");

const beforeText =
  fs.existsSync(queuePath)
    ? fs.readFileSync(
        queuePath,
        "utf8"
      )
    : "[]";

let addedTask = null;

try {
  addedTask =
    taskQueue.add(
      "BUILD136_SMOKE_TEST",
      {
        capability:
          "runtime.queue.smoke_test",

        provider:
          "RuntimeProvider",

        action:
          "verify_task_queue_add",

        build:
          "BUILD136"
      },
      1
    );

  if (
    !addedTask ||
    !addedTask.id
  ) {
    throw new Error(
      "TaskQueue.add did not return a task."
    );
  }

  const queued =
    taskQueue.list();

  if (
    !queued.some(
      task =>
        task.id ===
        addedTask.id
    )
  ) {
    throw new Error(
      "Smoke-test task was not persisted."
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        addedTask
      },
      null,
      2
    )
  );
} finally {
  fs.writeFileSync(
    queuePath,
    beforeText,
    "utf8"
  );

  console.log(
    "[BUILD136] Queue restored to pre-smoke-test state."
  );
}
