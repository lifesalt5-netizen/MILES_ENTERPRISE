"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  __dirname;

const DEFAULT_EXECUTION_INTERVAL_MS =
  Number(
    process.env
      .MILES_EXECUTION_INTERVAL_MS ||
    1000
  );

const DEFAULT_HEARTBEAT_MS =
  Number(
    process.env
      .MILES_HEARTBEAT_INTERVAL_MS ||
    15000
  );

const DEFAULT_BRIEF_INTERVAL_MS =
  Number(
    process.env
      .MILES_EXECUTIVE_BRIEF_INTERVAL_MS ||
    60 * 60 * 1000
  );

const DEFAULT_MAX_RETRIES =
  Number(
    process.env
      .MILES_EXECUTION_MAX_RETRIES ||
    2
  );

const DEFAULT_STALE_RUNNING_MINUTES =
  Number(
    process.env
      .MILES_STALE_RUNNING_MINUTES ||
    15
  );

const RUNTIME_DIR =
  path.join(
    ROOT,
    "DATA",
    "runtime"
  );

const STATUS_FILE =
  path.join(
    RUNTIME_DIR,
    "worker_runtime_status.json"
  );

const EXECUTION_HISTORY_FILE =
  path.join(
    RUNTIME_DIR,
    "execution_history.jsonl"
  );

const EXECUTIVE_BRIEF_JSON =
  path.join(
    RUNTIME_DIR,
    "latest_executive_brief.json"
  );

const EXECUTIVE_BRIEF_MD =
  path.join(
    RUNTIME_DIR,
    "latest_executive_brief.md"
  );

function now() {
  return new Date().toISOString();
}

function ensureRuntimeDir() {
  fs.mkdirSync(
    RUNTIME_DIR,
    { recursive: true }
  );
}

function writeJsonAtomic(
  filePath,
  value
) {
  ensureRuntimeDir();

  const tempPath =
    `${filePath}.tmp_${process.pid}_${Date.now()}`;

  const payload =
    JSON.stringify(
      value,
      null,
      2
    );

  fs.writeFileSync(
    tempPath,
    payload,
    "utf8"
  );

  try {
    fs.copyFileSync(
      tempPath,
      filePath
    );
  } finally {
    try {
      fs.unlinkSync(
        tempPath
      );
    } catch {}
  }
}

function appendJsonLine(
  filePath,
  value
) {
  ensureRuntimeDir();

  fs.appendFileSync(
    filePath,
    `${JSON.stringify(value)}\n`,
    "utf8"
  );
}

function normalizeBoolean(
  value,
  fallback = false
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return ![
    "0",
    "false",
    "no",
    "off"
  ].includes(
    String(value)
      .trim()
      .toLowerCase()
  );
}

function taskAgeMinutes(task) {
  const timestamp =
    task.updatedAt ||
    task.startedAt ||
    task.createdAt;

  if (!timestamp) return 0;

  const parsed =
    new Date(timestamp)
      .getTime();

  if (
    !Number.isFinite(parsed)
  ) {
    return 0;
  }

  return (
    Date.now() -
    parsed
  ) / 60000;
}

class RuntimeWorkerSupervisor {
  constructor(options = {}) {
    this.executionService =
      options.executionService ||
      require("./SERVICES/ExecutionService");

    this.taskQueue =
      options.taskQueue ||
      require("./CORE/TaskQueue");

    this.eventBus =
      options.eventBus ||
      require("./event-bus/emitter").bus;

    this.supervisor =
      options.supervisor ||
      require("./CORE/Supervisor");

    this.ExecutiveBriefService =
      options.ExecutiveBriefService ||
      require("./SERVICES/ExecutiveBriefService");

    this.executiveState =
      options.executiveState ||
      require("./SERVICES/ExecutiveStateService");

    this.executionIntervalMs =
      Number(
        options.executionIntervalMs ||
        DEFAULT_EXECUTION_INTERVAL_MS
      );

    this.heartbeatMs =
      Number(
        options.heartbeatMs ||
        DEFAULT_HEARTBEAT_MS
      );

    this.briefIntervalMs =
      Number(
        options.briefIntervalMs ||
        DEFAULT_BRIEF_INTERVAL_MS
      );

    this.maxRetries =
      Number.isFinite(
        Number(
          options.maxRetries
        )
      )
        ? Number(
            options.maxRetries
          )
        : DEFAULT_MAX_RETRIES;

    this.staleRunningMinutes =
      Number(
        options.staleRunningMinutes ||
        DEFAULT_STALE_RUNNING_MINUTES
      );

    this.enableRetries =
      normalizeBoolean(
        options.enableRetries,
        normalizeBoolean(
          process.env
            .MILES_EXECUTION_RETRIES_ENABLED,
          true
        )
      );

    this.executionLoopRunning =
      false;

    this.started =
      false;

    this.shuttingDown =
      false;

    this.executionTimer =
      null;

    this.heartbeatTimer =
      null;

    this.briefTimer =
      null;

    this.metrics = {
      startedAt: null,
      lastExecutionAt: null,
      lastExecutionResult: null,
      lastHeartbeatAt: null,
      lastExecutiveBriefAt: null,
      executionPasses: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      staleRecovered: 0,
      loopErrors: 0
    };
  }

  statusSnapshot() {
    let queueStatus = {};

    try {
      queueStatus =
        this.taskQueue.getStatus();
    } catch (error) {
      queueStatus = {
        error:
          error.message
      };
    }

    return {
      ok: true,
      service:
        "MILES_WORKER_RUNTIME",
      pid:
        process.pid,
      started:
        this.started,
      shuttingDown:
        this.shuttingDown,
      executionLoopRunning:
        this.executionLoopRunning,
      generatedAt:
        now(),
      configuration: {
        executionIntervalMs:
          this.executionIntervalMs,
        heartbeatMs:
          this.heartbeatMs,
        briefIntervalMs:
          this.briefIntervalMs,
        maxRetries:
          this.maxRetries,
        retriesEnabled:
          this.enableRetries,
        staleRunningMinutes:
          this.staleRunningMinutes
      },
      queue:
        queueStatus,
      metrics:
        this.metrics
    };
  }

  persistStatus() {
    const snapshot =
      this.statusSnapshot();

    writeJsonAtomic(
      STATUS_FILE,
      snapshot
    );

    return snapshot;
  }

  recordExecution(
    record
  ) {
    appendJsonLine(
      EXECUTION_HISTORY_FILE,
      {
        recordedAt:
          now(),
        ...record
      }
    );
  }

  recoverStaleRunningTasks() {
    const running =
      this.taskQueue
        .list("RUNNING");

    const recovered = [];

    for (const task of running) {
      const age =
        taskAgeMinutes(
          task
        );

      if (
        age <
        this.staleRunningMinutes
      ) {
        continue;
      }

      const retryCount =
        Number(
          task.retryCount ||
          0
        );

      this.taskQueue.update(
        task.id,
        {
          status:
            retryCount <
            this.maxRetries
              ? "QUEUED"
              : "FAILED",
          retryCount:
            retryCount +
            1,
          recoveredFromStale:
            true,
          staleRecoveredAt:
            now(),
          staleAgeMinutes:
            Math.round(
              age * 100
            ) / 100,
          error:
            retryCount <
            this.maxRetries
              ? null
              : "Stale RUNNING task exceeded retry limit."
        }
      );

      recovered.push({
        taskId:
          task.id,
        previousStatus:
          "RUNNING",
        newStatus:
          retryCount <
          this.maxRetries
            ? "QUEUED"
            : "FAILED",
        ageMinutes:
          age
      });
    }

    this.metrics.staleRecovered +=
      recovered.length;

    if (
      recovered.length > 0
    ) {
      this.recordExecution({
        type:
          "STALE_TASK_RECOVERY",
        recovered
      });
    }

    return recovered;
  }

  retryIfAllowed(
    task,
    result
  ) {
    if (
      !this.enableRetries ||
      !task ||
      !result ||
      result.ok === true ||
      result.status ===
        "AWAITING_APPROVAL"
    ) {
      return {
        retried: false
      };
    }

    const retryable =
      result.retryable === true ||
      result.failure
        ?.retryable === true;

    if (!retryable) {
      return {
        retried: false,
        reason:
          "Failure is not retryable."
      };
    }

    const currentRetries =
      Number(
        task.retryCount ||
        0
      );

    if (
      currentRetries >=
      this.maxRetries
    ) {
      return {
        retried: false,
        reason:
          "Retry limit reached."
      };
    }

    const updated =
      this.taskQueue.update(
        task.id,
        {
          status: "QUEUED",
          retryCount:
            currentRetries + 1,
          lastRetryAt:
            now(),
          lastRetryReason:
            result.error ||
            result.failure
              ?.type ||
            "Transient execution failure",
          error: null
        }
      );

    this.metrics.retried += 1;

    this.recordExecution({
      type:
        "TASK_RETRY_QUEUED",
      taskId:
        task.id,
      retryCount:
        updated.retryCount,
      result
    });

    return {
      retried: true,
      task:
        updated
    };
  }

  async executePass() {
    if (
      this.executionLoopRunning ||
      this.shuttingDown
    ) {
      return {
        ok: true,
        skipped: true,
        reason:
          this.shuttingDown
            ? "SHUTTING_DOWN"
            : "PASS_ALREADY_RUNNING"
      };
    }

    this.executionLoopRunning =
      true;

    const queuedBefore =
      this.taskQueue
        .list("QUEUED");

    const selectedTask =
      queuedBefore
        .slice()
        .sort(
          (a, b) =>
            Number(
              a.priority ||
              99
            ) -
            Number(
              b.priority ||
              99
            )
        )[0] ||
      null;

    try {
      this.metrics.executionPasses += 1;
      this.metrics.lastExecutionAt =
        now();

      const result =
        await this.executionService
          .runNext();

      this.metrics.lastExecutionResult =
        result;

      if (
        selectedTask &&
        result?.ok === true &&
        result?.message !==
          "No queued tasks"
      ) {
        this.metrics.completed += 1;
      }

      if (
        selectedTask &&
        result?.ok === false &&
        result?.status !==
          "AWAITING_APPROVAL"
      ) {
        this.metrics.failed += 1;
      }

      const retry =
        this.retryIfAllowed(
          selectedTask,
          result
        );

      this.recordExecution({
        type:
          "EXECUTION_PASS",
        selectedTaskId:
          selectedTask?.id ||
          null,
        selectedTaskType:
          selectedTask?.type ||
          null,
        result,
        retry
      });

      this.persistStatus();

      return {
        ok:
          result?.ok !== false ||
          retry.retried === true,
        taskId:
          selectedTask?.id ||
          null,
        result,
        retry
      };
    } catch (error) {
      this.metrics.loopErrors += 1;
      this.metrics.lastExecutionResult = {
        ok: false,
        error:
          error.stack ||
          error.message
      };

      this.recordExecution({
        type:
          "EXECUTION_LOOP_ERROR",
        selectedTaskId:
          selectedTask?.id ||
          null,
        error:
          error.stack ||
          error.message
      });

      this.persistStatus();

      return {
        ok: false,
        error:
          error.stack ||
          error.message
      };
    } finally {
      this.executionLoopRunning =
        false;
    }
  }

  generateExecutiveBrief() {
    try {
      const service =
        new this.ExecutiveBriefService(
          this.executiveState
        );

      const brief =
        service.generate();

      const markdown =
        service.toMarkdown();

      writeJsonAtomic(
        EXECUTIVE_BRIEF_JSON,
        brief
      );

      ensureRuntimeDir();

      fs.writeFileSync(
        EXECUTIVE_BRIEF_MD,
        markdown,
        "utf8"
      );

      this.metrics.lastExecutiveBriefAt =
        now();

      this.recordExecution({
        type:
          "EXECUTIVE_BRIEF_GENERATED",
        businessHealth:
          brief.businessHealth,
        businessHealthScore:
          brief.businessHealthScore,
        authorizedWork:
          brief.authorizedWork
            ?.length ||
          0,
        ceoDecisions:
          brief
            .executiveDecisionsNeeded
            ?.length ||
          0
      });

      this.persistStatus();

      return {
        ok: true,
        brief,
        jsonFile:
          EXECUTIVE_BRIEF_JSON,
        markdownFile:
          EXECUTIVE_BRIEF_MD
      };
    } catch (error) {
      this.recordExecution({
        type:
          "EXECUTIVE_BRIEF_ERROR",
        error:
          error.stack ||
          error.message
      });

      return {
        ok: false,
        error:
          error.stack ||
          error.message
      };
    }
  }

  emitHeartbeat() {
    this.metrics.lastHeartbeatAt =
      now();

    try {
      this.eventBus.emit(
        "COO_TICK"
      );
    } catch (error) {
      console.error(
        "[MILES] HEARTBEAT ERROR",
        error
      );
    }

    const snapshot =
      this.persistStatus();

    console.log(
      `[MILES] HEARTBEAT â†’ COO_TICK | queued=${snapshot.queue.pending || 0} running=${snapshot.queue.running || 0} failed=${snapshot.queue.failed || 0} health=${snapshot.queue.healthScore ?? "unknown"}`
    );

    return snapshot;
  }

  startExecutionLoop() {
    console.log(
      `[MILES] Execution loop starting (${this.executionIntervalMs} ms).`
    );

    this.executionTimer =
      setInterval(
        () => {
          this.executePass()
            .catch(error => {
              console.error(
                "[MILES] EXECUTION LOOP ERROR"
              );
              console.error(error);
            });
        },
        this.executionIntervalMs
      );
  }

  startHeartbeat() {
    this.heartbeatTimer =
      setInterval(
        () => {
          this.emitHeartbeat();
        },
        this.heartbeatMs
      );
  }

  startExecutiveBriefLoop() {
    this.generateExecutiveBrief();

    this.briefTimer =
      setInterval(
        () => {
          this.generateExecutiveBrief();
        },
        this.briefIntervalMs
      );
  }

  async boot() {
    if (this.started) {
      return this.statusSnapshot();
    }

    console.log("");
    console.log(
      "[MILES] ==============================="
    );
    console.log(
      "[MILES] AUTONOMOUS SYSTEM ONLINE"
    );
    console.log(
      "[MILES] GOVERNED WORKER RUNTIME ACTIVE"
    );
    console.log(
      "[MILES] ==============================="
    );
    console.log("");

    console.log(
      "[MILES] Booting workers..."
    );

    await this.supervisor.start();

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          1000
        )
    );

    this.recoverStaleRunningTasks();

    this.started = true;
    this.metrics.startedAt =
      now();

    this.startExecutionLoop();
    this.startHeartbeat();
    this.startExecutiveBriefLoop();

    console.log(
      "[MILES] Workers online"
    );
    console.log(
      "[MILES] System fully running"
    );
    console.log("");

    return this.persistStatus();
  }

  async shutdown(
    signal = "MANUAL"
  ) {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown =
      true;

    console.log(
      `[MILES] Worker runtime shutdown requested: ${signal}`
    );

    if (this.executionTimer) {
      clearInterval(
        this.executionTimer
      );
    }

    if (this.heartbeatTimer) {
      clearInterval(
        this.heartbeatTimer
      );
    }

    if (this.briefTimer) {
      clearInterval(
        this.briefTimer
      );
    }

    this.persistStatus();
  }
}

async function main() {
  require("./api/server");

  require("./workers/cooWorker");
  require("./workers/revenueWorker");
  require("./workers/replyWorker");
  require("./workers/dealWorker");
  require("./workers/atlasWorker");

  const runtime =
    new RuntimeWorkerSupervisor();

  process.on(
    "SIGINT",
    async () => {
      await runtime.shutdown(
        "SIGINT"
      );
      process.exit(0);
    }
  );

  process.on(
    "SIGTERM",
    async () => {
      await runtime.shutdown(
        "SIGTERM"
      );
      process.exit(0);
    }
  );

  process.on(
    "uncaughtException",
    error => {
      console.error(
        "[MILES] UNCAUGHT EXCEPTION",
        error
      );

      runtime.persistStatus();
    }
  );

  process.on(
    "unhandledRejection",
    reason => {
      console.error(
        "[MILES] UNHANDLED REJECTION",
        reason
      );

      runtime.persistStatus();
    }
  );

  await runtime.boot();
}

if (require.main === module) {
  main().catch(error => {
    console.error("");
    console.error(
      "[MILES] BOOT FAILED"
    );
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  RuntimeWorkerSupervisor,
  main
};

