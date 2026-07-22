"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  __dirname;

const ROOT =
  process.env.MILES_ROOT;

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

const EXECUTION_INTERVAL_MS =
  positiveNumber(
    process.env.MILES_EXECUTION_INTERVAL_MS,
    5000
  );

const HEARTBEAT_INTERVAL_MS =
  positiveNumber(
    process.env.MILES_HEARTBEAT_INTERVAL_MS,
    15000
  );

const HEALTH_INTERVAL_MS =
  positiveNumber(
    process.env.MILES_INFRASTRUCTURE_HEALTH_INTERVAL_MS,
    5 * 60 * 1000
  );

const WORK_GENERATION_INTERVAL_MS =
  positiveNumber(
    process.env.MILES_AUTONOMOUS_WORK_INTERVAL_MS,
    5 * 60 * 1000
  );

const STARTUP_SETTLE_MS =
  positiveNumber(
    process.env.MILES_WORKER_STARTUP_SETTLE_MS,
    1000
  );

const taskQueue =
  require("./CORE/TaskQueue");

const supervisor =
  require("./CORE/Supervisor");

const executionService =
  require("./SERVICES/ExecutionService");

const infrastructureRegistry =
  require("./SERVICES/InfrastructureRegistryService");

const credentialAuthority =
  require("./SERVICES/CredentialAuthorityService");

const infrastructureHealthManager =
  require("./SERVICES/InfrastructureHealthManagerService");

const autonomousWorkGenerator =
  require("./SERVICES/AutonomousWorkGenerationService");

const providerRouter =
  require("./SERVICES/ProviderRouterService");

const eventBus =
  safeRequire(
    "./event-bus/emitter"
  );

function positiveNumber(
  value,
  fallback
) {
  const parsed =
    Number(value);

  return (
    Number.isFinite(parsed) &&
    parsed > 0
  )
    ? parsed
    : fallback;
}

function now() {
  return new Date()
    .toISOString();
}

function safeRequire(
  modulePath
) {
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

function delay(milliseconds) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

function ensureRuntimeDir() {
  fs.mkdirSync(
    RUNTIME_DIR,
    {
      recursive: true
    }
  );
}

function writeJsonAtomic(
  filePath,
  value
) {
  ensureRuntimeDir();

  const temporaryFile =
    `${filePath}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(
      value,
      null,
      2
    ),
    "utf8"
  );

  try {
    fs.renameSync(
      temporaryFile,
      filePath
    );
  } catch {
    fs.copyFileSync(
      temporaryFile,
      filePath
    );

    try {
      fs.unlinkSync(
        temporaryFile
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

function normalizeStatus(
  value
) {
  return String(
    value ||
    "UNKNOWN"
  )
    .trim()
    .toUpperCase();
}

function queueCounts() {
  const items =
    typeof taskQueue.list ===
      "function"
      ? taskQueue.list()
      : [];

  const counts = {
    total:
      items.length,

    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    awaitingApproval: 0,
    other: 0
  };

  for (const item of items) {
    const status =
      normalizeStatus(
        item?.status
      );

    switch (status) {
      case "QUEUED":
      case "READY":
      case "PENDING":
        counts.queued += 1;
        break;

      case "RUNNING":
      case "IN_PROGRESS":
        counts.running += 1;
        break;

      case "COMPLETED":
      case "COMPLETE":
        counts.completed += 1;
        break;

      case "FAILED":
        counts.failed += 1;
        break;

      case "AWAITING_APPROVAL":
      case "AWAITING_CEO_APPROVAL":
        counts.awaitingApproval += 1;
        break;

      default:
        counts.other += 1;
        break;
    }
  }

  if (
    typeof taskQueue.getStatus ===
    "function"
  ) {
    try {
      const status =
        taskQueue.getStatus();

      counts.healthScore =
        status?.healthScore ??
        null;
    } catch {
      counts.healthScore =
        null;
    }
  } else {
    counts.healthScore =
      null;
  }

  return counts;
}

function emitCooTick(
  payload
) {
  try {
    const bus =
      eventBus?.bus ||
      eventBus;

    if (
      bus &&
      typeof bus.emit ===
        "function"
    ) {
      bus.emit(
        "COO_TICK",
        payload
      );

      return true;
    }

    if (
      bus &&
      typeof bus.publish ===
        "function"
    ) {
      bus.publish(
        "COO_TICK",
        payload
      );

      return true;
    }
  } catch (
    error
  ) {
    console.error(
      "[MILES] COO_TICK emission failed:",
      error.message
    );
  }

  return false;
}

class RuntimeWorkerSupervisor {
  constructor() {
    this.started = false;
    this.shuttingDown = false;

    this.executionPassRunning =
      false;

    this.healthCycleRunning =
      false;

    this.workGenerationRunning =
      false;

    this.executionTimer =
      null;

    this.heartbeatTimer =
      null;

    this.healthTimer =
      null;

    this.workGenerationTimer =
      null;

    this.metrics = {
      pid:
        process.pid,

      startedAt:
        null,

      stoppedAt:
        null,

      executionPasses:
        0,

      executionPassesSkipped:
        0,

      completed:
        0,

      failed:
        0,

      awaitingApproval:
        0,

      emptyQueuePasses:
        0,

      healthCycles:
        0,

      healthCycleFailures:
        0,

      workGenerationCycles:
        0,

      workGenerationFailures:
        0,

      heartbeatCount:
        0,

      lastExecutionStartedAt:
        null,

      lastExecutionCompletedAt:
        null,

      lastExecutionDurationMs:
        null,

      lastExecutionTaskId:
        null,

      lastExecutionResult:
        null,

      lastHealthCycleAt:
        null,

      lastHealthResult:
        null,

      lastWorkGenerationAt:
        null,

      lastWorkGenerationResult:
        null,

      lastHeartbeatAt:
        null,

      lastError:
        null
    };
  }

  recordHistory(
    record
  ) {
    appendJsonLine(
      EXECUTION_HISTORY_FILE,
      {
        generatedAt:
          now(),

        pid:
          process.pid,

        ...record
      }
    );
  }

  buildStatus() {
    let infrastructure = null;
    let credentials = null;
    let healthManager = null;
    let generator = null;
    let router = null;

    try {
      infrastructure =
        infrastructureRegistry
          .summary();
    } catch (
      error
    ) {
      infrastructure = {
        ok: false,
        error:
          error.message
      };
    }

    try {
      credentials =
        credentialAuthority
          .summary();
    } catch (
      error
    ) {
      credentials = {
        ok: false,
        error:
          error.message
      };
    }

    try {
      healthManager =
        infrastructureHealthManager
          .status();
    } catch (
      error
    ) {
      healthManager = {
        ok: false,
        error:
          error.message
      };
    }

    try {
      generator =
        autonomousWorkGenerator
          .status();
    } catch (
      error
    ) {
      generator = {
        ok: false,
        error:
          error.message
      };
    }

    try {
      router =
        typeof providerRouter
          .getPerformanceState ===
          "function"
          ? providerRouter
              .getPerformanceState()
          : null;
    } catch (
      error
    ) {
      router = {
        ok: false,
        error:
          error.message
      };
    }

    return {
      ok:
        this.started &&
        !this.shuttingDown,

      service:
        "RuntimeWorkerSupervisor",

      type:
        "MILES_CANONICAL_WORKER_RUNTIME",

      generatedAt:
        now(),

      root:
        ROOT,

      pid:
        process.pid,

      nodeVersion:
        process.version,

      intervals: {
        execution:
          EXECUTION_INTERVAL_MS,

        heartbeat:
          HEARTBEAT_INTERVAL_MS,

        infrastructureHealth:
          HEALTH_INTERVAL_MS,

        autonomousWorkGeneration:
          WORK_GENERATION_INTERVAL_MS
      },

      lifecycle: {
        started:
          this.started,

        shuttingDown:
          this.shuttingDown,

        executionPassRunning:
          this.executionPassRunning,

        healthCycleRunning:
          this.healthCycleRunning,

        workGenerationRunning:
          this.workGenerationRunning
      },

      queue:
        queueCounts(),

      metrics: {
        ...this.metrics
      },

      infrastructure,

      credentials,

      healthManager,

      autonomousWorkGenerator:
        generator,

      providerRouter:
        router
    };
  }

  persistStatus() {
    const status =
      this.buildStatus();

    writeJsonAtomic(
      STATUS_FILE,
      status
    );

    return status;
  }

  async executePass() {
    console.log("[BUILD106] executePass ENTER");
    if (
      this.executionPassRunning ||
      this.shuttingDown
    ) {
      this.metrics
        .executionPassesSkipped +=
        1;

      return {
        ok: true,
        skipped: true,
        reason:
          this.shuttingDown
            ? "SHUTTING_DOWN"
            : "PASS_ALREADY_RUNNING"
      };
    }

    this.executionPassRunning =
      true;

    const startedAt =
      Date.now();

    this.metrics
      .executionPasses +=
      1;

    this.metrics
      .lastExecutionStartedAt =
      now();

    try {
      const queued =
        taskQueue.list(
          "QUEUED"
        );
console.log(
  "[BUILD106] queued.length =",
  Array.isArray(queued) ? queued.length : "NOT_ARRAY"
);

if (Array.isArray(queued) && queued.length) {
  console.log(
    "[BUILD106] First queued task:",
    JSON.stringify(
      {
        id: queued[0].id,
        status: queued[0].status,
        provider:
          queued[0].payload?.provider || queued[0].provider,
        action:
          queued[0].payload?.action || queued[0].action
      },
      null,
      2
    )
  );
}
      if (
        !Array.isArray(queued) ||
        queued.length === 0
      ) {
        this.metrics
          .emptyQueuePasses +=
          1;

        const result = {
          ok: true,
          message:
            "No queued tasks"
        };

        this.metrics
          .lastExecutionResult =
          result;

        return result;
      }

      const selectedTask =
        queued
          .slice()
          .sort(
            (
              first,
              second
            ) =>
              Number(
                first.priority ||
                99
              ) -
              Number(
                second.priority ||
                99
              )
          )[0];

      this.metrics
        .lastExecutionTaskId =
        selectedTask?.id ||
        null;

      console.log(
        `[MILES] EXECUTING ${selectedTask.id} | ${selectedTask.payload?.provider || selectedTask.provider || "UNKNOWN"} | ${selectedTask.payload?.action || selectedTask.action || selectedTask.type || "UNKNOWN"}`
      );

      const result =
        await executionService
          .execute(
            selectedTask
          );

      this.metrics
        .lastExecutionResult =
        result;

      if (
        result?.status ===
          "AWAITING_APPROVAL"
      ) {
        this.metrics
          .awaitingApproval +=
          1;
      } else if (
        result?.ok === true
      ) {
        this.metrics
          .completed +=
          1;
      } else {
        this.metrics
          .failed +=
          1;
      }

      this.recordHistory({
        type:
          "EXECUTION_PASS",

        taskId:
          selectedTask.id,

        provider:
          selectedTask
            .payload?.provider ||
          selectedTask.provider ||
          null,

        action:
          selectedTask
            .payload?.action ||
          selectedTask.action ||
          selectedTask.type ||
          null,

        resultStatus:
          result?.status ||
          null,

        ok:
          result?.ok === true
      });

      console.log(
        `[MILES] EXECUTION RESULT ${selectedTask.id} | status=${result?.status || "UNKNOWN"} | ok=${result?.ok === true}`
      );

      return result;
    } catch (
      error
    ) {
      this.metrics
        .failed +=
        1;

      this.metrics
        .lastError = {
          area:
            "EXECUTION_PASS",

          message:
            error.message,

          stack:
            error.stack,

          createdAt:
            now()
      };

      this.recordHistory({
        type:
          "EXECUTION_PASS_ERROR",

        error:
          error.stack ||
          error.message
      });

      console.error(
        "[MILES] EXECUTION LOOP ERROR"
      );

      console.error(
        error
      );

      return {
        ok: false,
        status:
          "EXECUTION_PASS_FAILED",
        error:
          error.message
      };
    } finally {
      this.metrics
        .lastExecutionCompletedAt =
        now();

      this.metrics
        .lastExecutionDurationMs =
        Date.now() -
        startedAt;

      this.executionPassRunning =
        false;

      this.persistStatus();
    }
  }

  async runInfrastructureHealthCycle() {
    if (
      this.healthCycleRunning ||
      this.shuttingDown
    ) {
      return {
        ok: true,
        skipped: true
      };
    }

    this.healthCycleRunning =
      true;

    try {
      const result =
        await infrastructureHealthManager
          .runCycle();

      this.metrics
        .healthCycles +=
        1;

      this.metrics
        .lastHealthCycleAt =
        now();

      this.metrics
        .lastHealthResult = {
          ok:
            result?.ok === true,

          durationMs:
            result?.durationMs ||
            null,

          failures:
            result?.failures ||
            []
      };

      this.recordHistory({
        type:
          "INFRASTRUCTURE_HEALTH_CYCLE",

        ok:
          result?.ok === true,

        durationMs:
          result?.durationMs ||
          null,

        failures:
          result?.failures ||
          []
      });

      return result;
    } catch (
      error
    ) {
      this.metrics
        .healthCycleFailures +=
        1;

      this.metrics
        .lastError = {
          area:
            "INFRASTRUCTURE_HEALTH",

          message:
            error.message,

          createdAt:
            now()
      };

      console.error(
        "[MILES] INFRASTRUCTURE HEALTH ERROR"
      );

      console.error(
        error
      );

      return {
        ok: false,
        error:
          error.message
      };
    } finally {
      this.healthCycleRunning =
        false;

      this.persistStatus();
    }
  }

  runAutonomousWorkGenerationCycle() {
    if (
      this.workGenerationRunning ||
      this.shuttingDown
    ) {
      return {
        ok: true,
        skipped: true
      };
    }

    this.workGenerationRunning =
      true;

    try {
      const result =
        autonomousWorkGenerator
          .runCycle();

      this.metrics
        .workGenerationCycles +=
        1;

      this.metrics
        .lastWorkGenerationAt =
        now();

      this.metrics
        .lastWorkGenerationResult = {
          ok:
            result?.ok === true,

          summary:
            result?.summary ||
            null
      };

      this.recordHistory({
        type:
          "AUTONOMOUS_WORK_GENERATION",

        ok:
          result?.ok === true,

        summary:
          result?.summary ||
          null
      });

      console.log(
        "[MILES] AUTONOMOUS WORK",
        result?.summary ||
        {}
      );

      return result;
    } catch (
      error
    ) {
      this.metrics
        .workGenerationFailures +=
        1;

      this.metrics
        .lastError = {
          area:
            "AUTONOMOUS_WORK_GENERATION",

          message:
            error.message,

          createdAt:
            now()
      };

      console.error(
        "[MILES] AUTONOMOUS WORK ERROR"
      );

      console.error(
        error
      );

      return {
        ok: false,
        error:
          error.message
      };
    } finally {
      this.workGenerationRunning =
        false;

      this.persistStatus();
    }
  }

  emitHeartbeat() {
    const queue =
      queueCounts();

    this.metrics
      .heartbeatCount +=
      1;

    this.metrics
      .lastHeartbeatAt =
      now();

    const payload = {
      generatedAt:
        this.metrics
          .lastHeartbeatAt,

      queue,

      metrics: {
        executionPasses:
          this.metrics
            .executionPasses,

        completed:
          this.metrics
            .completed,

        failed:
          this.metrics
            .failed,

        healthCycles:
          this.metrics
            .healthCycles,

        workGenerationCycles:
          this.metrics
            .workGenerationCycles
      }
    };

    emitCooTick(
      payload
    );

    console.log(
      `[MILES] HEARTBEAT -> COO_TICK | queued=${queue.queued} running=${queue.running} completed=${queue.completed} failed=${queue.failed} approval=${queue.awaitingApproval} health=${queue.healthScore ?? "unknown"}`
    );

    this.persistStatus();

    return payload;
  }

  startExecutionLoop() {
    console.log(
      `[MILES] Canonical execution loop starting (${EXECUTION_INTERVAL_MS} ms).`
    );

    this.executePass()
      .catch(
        error => {
          console.error(
            "[MILES] INITIAL EXECUTION PASS ERROR",
            error
          );
        }
      );

    this.executionTimer =
      setInterval(
        () => {
          this.executePass()
            .catch(
              error => {
                console.error(
                  "[MILES] EXECUTION LOOP ERROR",
                  error
                );
              }
            );
        },
        EXECUTION_INTERVAL_MS
      );
  }

  startHeartbeatLoop() {
    console.log(
      `[MILES] Heartbeat loop starting (${HEARTBEAT_INTERVAL_MS} ms).`
    );

    this.emitHeartbeat();

    this.heartbeatTimer =
      setInterval(
        () => {
          this.emitHeartbeat();
        },
        HEARTBEAT_INTERVAL_MS
      );
  }

  startInfrastructureHealthLoop() {
    console.log(
      `[MILES] Infrastructure health loop starting (${HEALTH_INTERVAL_MS} ms).`
    );

    setTimeout(
      () => {
        this.runInfrastructureHealthCycle()
          .catch(
            error => {
              console.error(
                "[MILES] INITIAL INFRASTRUCTURE HEALTH ERROR",
                error
              );
            }
          );
      },
      5000
    );

    this.healthTimer =
      setInterval(
        () => {
          this.runInfrastructureHealthCycle()
            .catch(
              error => {
                console.error(
                  "[MILES] INFRASTRUCTURE HEALTH LOOP ERROR",
                  error
                );
              }
            );
        },
        HEALTH_INTERVAL_MS
      );
  }

  startAutonomousWorkLoop() {
    console.log(
      `[MILES] Autonomous work loop starting (${WORK_GENERATION_INTERVAL_MS} ms).`
    );

    setTimeout(
      () => {
        this.runAutonomousWorkGenerationCycle();
      },
      10000
    );

    this.workGenerationTimer =
      setInterval(
        () => {
          this.runAutonomousWorkGenerationCycle();
        },
        WORK_GENERATION_INTERVAL_MS
      );
  }

  async boot() {
    if (this.started) {
      return this.persistStatus();
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

    await supervisor.start();

    await delay(
      STARTUP_SETTLE_MS
    );

    credentialAuthority.scan();

    infrastructureRegistry.summary();

    this.started =
      true;

    this.metrics
      .startedAt =
      now();

    this.startExecutionLoop();
    this.startHeartbeatLoop();
    this.startInfrastructureHealthLoop();
    this.startAutonomousWorkLoop();

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
    if (
      this.shuttingDown
    ) {
      return;
    }

    this.shuttingDown =
      true;

    console.log(
      `[MILES] Worker runtime shutdown requested: ${signal}`
    );

    const timers = [
      this.executionTimer,
      this.heartbeatTimer,
      this.healthTimer,
      this.workGenerationTimer
    ];

    for (
      const timer of timers
    ) {
      if (timer) {
        clearInterval(
          timer
        );

        clearTimeout(
          timer
        );
      }
    }

    try {
      if (
        infrastructureHealthManager &&
        typeof infrastructureHealthManager
          .stop ===
          "function"
      ) {
        await infrastructureHealthManager
          .stop();
      }
    } catch (
      error
    ) {
      console.error(
        "[MILES] Health manager shutdown error:",
        error.message
      );
    }

    try {
      if (
        autonomousWorkGenerator &&
        typeof autonomousWorkGenerator
          .stop ===
          "function"
      ) {
        autonomousWorkGenerator
          .stop();
      }
    } catch (
      error
    ) {
      console.error(
        "[MILES] Work generator shutdown error:",
        error.message
      );
    }

    try {
      if (
        providerRouter &&
        typeof providerRouter.shutdown ===
          "function"
      ) {
        await providerRouter
          .shutdown();
      }
    } catch (
      error
    ) {
      console.error(
        "[MILES] Provider router shutdown error:",
        error.message
      );
    }

    try {
      if (
        supervisor &&
        typeof supervisor.stop ===
          "function"
      ) {
        await supervisor.stop();
      }
    } catch (
      error
    ) {
      console.error(
        "[MILES] Supervisor shutdown error:",
        error.message
      );
    }

    this.started =
      false;

    this.metrics
      .stoppedAt =
      now();

    this.persistStatus();

    console.log(
      "[MILES] Worker runtime stopped."
    );
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

  let shutdownStarted =
    false;

  async function shutdown(
    signal
  ) {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted =
      true;

    await runtime.shutdown(
      signal
    );

    process.exit(0);
  }

  process.on(
    "SIGINT",
    () => {
      shutdown(
        "SIGINT"
      ).catch(
        error => {
          console.error(
            error
          );

          process.exit(1);
        }
      );
    }
  );

  process.on(
    "SIGTERM",
    () => {
      shutdown(
        "SIGTERM"
      ).catch(
        error => {
          console.error(
            error
          );

          process.exit(1);
        }
      );
    }
  );

  process.on(
    "uncaughtException",
    error => {
      console.error(
        "[MILES] UNCAUGHT EXCEPTION",
        error
      );

      runtime.metrics
        .lastError = {
          area:
            "UNCAUGHT_EXCEPTION",

          message:
            error.message,

          stack:
            error.stack,

          createdAt:
            now()
      };

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

      runtime.metrics
        .lastError = {
          area:
            "UNHANDLED_REJECTION",

          message:
            reason?.message ||
            String(reason),

          stack:
            reason?.stack ||
            null,

          createdAt:
            now()
      };

      runtime.persistStatus();
    }
  );

  await runtime.boot();
}

if (
  require.main === module
) {
  main()
    .catch(
      error => {
        console.error("");
        console.error(
          "[MILES] BOOT FAILED"
        );
        console.error(
          error
        );

        process.exit(1);
      }
    );
}

module.exports = {
  RuntimeWorkerSupervisor,
  main
};