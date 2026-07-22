"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();

const taskQueueFile = path.join(
  root,
  "CORE",
  "TaskQueue.js"
);

const executionFile = path.join(
  root,
  "SERVICES",
  "ExecutionService.js"
);

const backupDir = path.join(
  root,
  "BACKUPS",
  "BUILD141_STALE_TASK_RECOVERY"
);

fs.mkdirSync(backupDir, {
  recursive: true
});

function stamp() {
  return new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
}

function backup(file) {
  const destination = path.join(
    backupDir,
    `${path.basename(file)}.${stamp()}.bak`
  );

  fs.copyFileSync(file, destination);

  console.log(
    `[BUILD141] Backup created: ${destination}`
  );

  return destination;
}

function writeFileAtomic(file, content) {
  const temp =
    `${file}.build141_${process.pid}_${Date.now()}.tmp`;

  fs.writeFileSync(
    temp,
    content,
    "utf8"
  );

  fs.copyFileSync(
    temp,
    file
  );

  fs.unlinkSync(temp);
}

function patchTaskQueue() {
  let source = fs.readFileSync(
    taskQueueFile,
    "utf8"
  );

  if (
    source.includes(
      "recoverStaleRunningTasks("
    )
  ) {
    console.log(
      "[BUILD141] TaskQueue stale recovery already installed."
    );

    return false;
  }

  backup(taskQueueFile);

  const anchor =
`    list(status = null) {
        const tasks = this._read();
        return status ? tasks.filter(t => t.status === status) : tasks;
    }`;

  if (!source.includes(anchor)) {
    throw new Error(
      "BUILD141_TASKQUEUE_ANCHOR_NOT_FOUND"
    );
  }

  const recoveryMethod =
`    recoverStaleRunningTasks(options = {}) {
        const staleAfterMs =
            Number(options.staleAfterMs) > 0
                ? Number(options.staleAfterMs)
                : Number(
                    process.env.MILES_STALE_TASK_TIMEOUT_MS ||
                    600000
                );

        const recoveredBy =
            options.recoveredBy ||
            "TaskQueue.recoverStaleRunningTasks";

        const currentTime = Date.now();

        return this.withLock(() => {
            const tasks = this.readJsonDirect();
            const recovered = [];

            for (const task of tasks) {
                if (
                    !task ||
                    String(task.status || "").toUpperCase() !==
                        "RUNNING"
                ) {
                    continue;
                }

                const timestamp =
                    task.startedAt ||
                    task.updatedAt ||
                    task.createdAt;

                const parsed =
                    new Date(timestamp || 0).getTime();

                const ageMs =
                    Number.isFinite(parsed)
                        ? currentTime - parsed
                        : Number.MAX_SAFE_INTEGER;

                if (ageMs < staleAfterMs) {
                    continue;
                }

                const recoveredAt = now();

                task.status = "QUEUED";
                task.updatedAt = recoveredAt;
                task.startedAt = null;
                task.completedAt = null;
                task.failedAt = null;
                task.error = null;

                task.recovery = {
                    recovered: true,
                    recoveredAt,
                    recoveredBy,
                    previousStatus: "RUNNING",
                    staleAfterMs,
                    observedAgeMs: ageMs,
                    reason:
                        "Recovered stale RUNNING task after interrupted or terminated execution."
                };

                task.recoveryCount =
                    Number(task.recoveryCount || 0) + 1;

                recovered.push({
                    id: task.id,
                    provider:
                        task.provider ||
                        task.payload?.provider ||
                        null,
                    action:
                        task.action ||
                        task.payload?.action ||
                        null,
                    observedAgeMs: ageMs,
                    recoveryCount:
                        task.recoveryCount
                });
            }

            if (recovered.length) {
                this.writeJsonDirect(tasks);

                for (const item of recovered) {
                    logger.info(
                        \`[BUILD141_STALE_RECOVERY] \${item.id} RUNNING => QUEUED\`,
                        item
                    );

                    try {
                        eventBus.publish(
                            "TASK_RECOVERED",
                            item
                        );
                    } catch {}
                }
            }

            return {
                ok: true,
                staleAfterMs,
                recoveredCount:
                    recovered.length,
                recovered
            };
        });
    }

${anchor}`;

  source = source.replace(
    anchor,
    recoveryMethod
  );

  writeFileAtomic(
    taskQueueFile,
    source
  );

  console.log(
    "[BUILD141] TaskQueue recovery method installed."
  );

  return true;
}

function patchExecutionService() {
  let source = fs.readFileSync(
    executionFile,
    "utf8"
  );

  if (
    source.includes(
      "BUILD141_STALE_TASK_RECOVERY"
    )
  ) {
    console.log(
      "[BUILD141] ExecutionService recovery hook already installed."
    );

    return false;
  }

  backup(executionFile);

  const anchor =
`  async runNext() {
    const queued =
      taskQueue.list("QUEUED");`;

  if (!source.includes(anchor)) {
    throw new Error(
      "BUILD141_EXECUTION_ANCHOR_NOT_FOUND"
    );
  }

  const replacement =
`  async runNext() {
    /*
     * BUILD141_STALE_TASK_RECOVERY
     *
     * A process termination, service restart or machine shutdown can leave
     * a task persisted as RUNNING even though no worker still owns it.
     *
     * Recover stale tasks before selecting the next executable task.
     */
    if (
      typeof taskQueue.recoverStaleRunningTasks ===
      "function"
    ) {
      try {
        taskQueue.recoverStaleRunningTasks({
          recoveredBy:
            "ExecutionService.runNext"
        });
      } catch (error) {
        log(
          "ExecutionService",
          "recoverStaleRunningTasks",
          "Failed",
          error.message
        );
      }
    }

    const queued =
      taskQueue.list("QUEUED");`;

  source = source.replace(
    anchor,
    replacement
  );

  writeFileAtomic(
    executionFile,
    source
  );

  console.log(
    "[BUILD141] ExecutionService recovery hook installed."
  );

  return true;
}

function main() {
  if (!fs.existsSync(taskQueueFile)) {
    throw new Error(
      `Missing file: ${taskQueueFile}`
    );
  }

  if (!fs.existsSync(executionFile)) {
    throw new Error(
      `Missing file: ${executionFile}`
    );
  }

  const taskQueuePatched =
    patchTaskQueue();

  const executionServicePatched =
    patchExecutionService();

  console.log(
    JSON.stringify(
      {
        ok: true,
        build: "BUILD141",
        taskQueuePatched,
        executionServicePatched,
        taskQueueFile,
        executionFile,
        backupDir
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        build: "BUILD141",
        error: error.message,
        stack: error.stack
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}
