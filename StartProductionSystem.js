"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

process.env.MILES_ROOT = process.env.MILES_ROOT || __dirname;
const ROOT = process.env.MILES_ROOT;
const RUNTIME_DIR = path.join(ROOT, "DATA", "runtime");
const EPHEMERAL_DIR = path.join(RUNTIME_DIR, "ephemeral_executor");
const STATUS_FILE = path.join(RUNTIME_DIR, "worker_runtime_status.json");
const EXECUTION_HISTORY_FILE = path.join(RUNTIME_DIR, "execution_history.jsonl");
const EPHEMERAL_EXECUTOR = path.join(ROOT, "SCRIPTS", "MilesEphemeralExecutor.js");

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const EXECUTION_INTERVAL_MS = positiveNumber(process.env.MILES_EXECUTION_INTERVAL_MS, 5000);
const HEARTBEAT_INTERVAL_MS = positiveNumber(process.env.MILES_HEARTBEAT_INTERVAL_MS, 15000);
const HEALTH_INTERVAL_MS = positiveNumber(process.env.MILES_INFRASTRUCTURE_HEALTH_INTERVAL_MS, 5 * 60 * 1000);
const WORK_GENERATION_INTERVAL_MS = positiveNumber(process.env.MILES_AUTONOMOUS_WORK_INTERVAL_MS, 5 * 60 * 1000);
const STARTUP_SETTLE_MS = positiveNumber(process.env.MILES_WORKER_STARTUP_SETTLE_MS, 1000);
const EPHEMERAL_TIMEOUT_MS = positiveNumber(process.env.MILES_EPHEMERAL_EXECUTOR_TIMEOUT_MS, 10 * 60 * 1000);

const taskQueue = require("./CORE/TaskQueue");
const supervisor = require("./CORE/Supervisor");

function now() { return new Date().toISOString(); }
function delay(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

function ensureRuntimeDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.mkdirSync(EPHEMERAL_DIR, { recursive: true });
}

function safeUnlink(file) {
  try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch {}
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch { return fallback; }
}

function writeJsonAtomic(filePath, value) {
  ensureRuntimeDir();
  const temporaryFile = filePath + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(temporaryFile, JSON.stringify(value, null, 2), "utf8");
  try { fs.renameSync(temporaryFile, filePath); }
  catch {
    fs.copyFileSync(temporaryFile, filePath);
    safeUnlink(temporaryFile);
  }
}

function appendJsonLine(filePath, value) {
  ensureRuntimeDir();
  fs.appendFileSync(filePath, JSON.stringify(value) + "\n", "utf8");
}

function normalizeStatus(value) {
  return String(value || "UNKNOWN").trim().toUpperCase();
}

function compactResult(result) {
  if (!result || typeof result !== "object") return result == null ? null : String(result);
  return {
    ok: result.ok === true,
    status: result.status || null,
    message: result.message || null,
    taskId: result.taskId || result.id || null,
    generatedAt: result.generatedAt || result.createdAt || result.completedAt || null
  };
}

function queueCounts() {
  const items = typeof taskQueue.list === "function" ? taskQueue.list() : [];
  const counts = {
    total: items.length,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    awaitingApproval: 0,
    other: 0,
    healthScore: null
  };

  for (const item of items) {
    const status = normalizeStatus(item?.status);
    if (["QUEUED", "READY", "PENDING"].includes(status)) counts.queued += 1;
    else if (["RUNNING", "IN_PROGRESS"].includes(status)) counts.running += 1;
    else if (["COMPLETED", "COMPLETE"].includes(status)) counts.completed += 1;
    else if (status === "FAILED") counts.failed += 1;
    else if (["AWAITING_APPROVAL", "AWAITING_CEO_APPROVAL"].includes(status)) counts.awaitingApproval += 1;
    else counts.other += 1;
  }

  try {
    const status = typeof taskQueue.getStatus === "function" ? taskQueue.getStatus() : null;
    counts.healthScore = status?.healthScore ?? null;
  } catch {}

  return counts;
}

function runEphemeral(mode, input = null) {
  ensureRuntimeDir();
  const token = process.pid + "_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  const inputFile = input == null ? "-" : path.join(EPHEMERAL_DIR, token + ".input.json");
  const outputFile = path.join(EPHEMERAL_DIR, token + ".output.json");

  if (input != null) fs.writeFileSync(inputFile, JSON.stringify(input), "utf8");

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(
      process.execPath,
      [EPHEMERAL_EXECUTOR, mode, inputFile, outputFile],
      {
        cwd: ROOT,
        env: { ...process.env, MILES_ROOT: ROOT },
        stdio: ["ignore", "inherit", "inherit"],
        windowsHide: true
      }
    );

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch {}
      const error = new Error("Ephemeral executor timed out: " + mode);
      error.code = "EPHEMERAL_TIMEOUT";
      safeUnlink(inputFile === "-" ? null : inputFile);
      safeUnlink(outputFile);
      reject(error);
    }, EPHEMERAL_TIMEOUT_MS);

    child.once("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      safeUnlink(inputFile === "-" ? null : inputFile);
      safeUnlink(outputFile);
      reject(error);
    });

    child.once("exit", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const envelope = readJson(outputFile, null);
      safeUnlink(inputFile === "-" ? null : inputFile);
      safeUnlink(outputFile);

      if (!envelope) {
        const error = new Error("Ephemeral executor produced no result: " + mode + " exit=" + code);
        error.code = "EPHEMERAL_NO_RESULT";
        reject(error);
        return;
      }

      if (code !== 0 && envelope.ok !== true) {
        const error = new Error(envelope.error || ("Ephemeral executor failed: " + mode));
        error.code = "EPHEMERAL_EXECUTOR_FAILED";
        error.envelope = envelope;
        reject(error);
        return;
      }

      resolve(envelope.result);
    });
  });
}

class RuntimeWorkerSupervisor {
  constructor() {
    this.started = false;
    this.shuttingDown = false;
    this.executionPassRunning = false;
    this.healthCycleRunning = false;
    this.workGenerationRunning = false;
    this.executionTimer = null;
    this.heartbeatTimer = null;
    this.healthTimer = null;
    this.workGenerationTimer = null;
    this.resolutionHealth = null;
    this.metrics = {
      pid: process.pid,
      startedAt: null,
      stoppedAt: null,
      executionPasses: 0,
      executionPassesSkipped: 0,
      completed: 0,
      failed: 0,
      awaitingApproval: 0,
      emptyQueuePasses: 0,
      healthCycles: 0,
      healthCycleFailures: 0,
      workGenerationCycles: 0,
      workGenerationFailures: 0,
      heartbeatCount: 0,
      ephemeralExecutions: 0,
      ephemeralFailures: 0,
      lastExecutionStartedAt: null,
      lastExecutionCompletedAt: null,
      lastExecutionDurationMs: null,
      lastExecutionTaskId: null,
      lastExecutionResult: null,
      lastHealthCycleAt: null,
      lastHealthResult: null,
      lastWorkGenerationAt: null,
      lastWorkGenerationResult: null,
      lastHeartbeatAt: null,
      lastError: null
    };
  }

  recordHistory(record) {
    appendJsonLine(EXECUTION_HISTORY_FILE, { generatedAt: now(), pid: process.pid, ...record });
  }

  buildStatus() {
    const memory = process.memoryUsage();
    return {
      ok: this.started && !this.shuttingDown,
      service: "RuntimeWorkerSupervisor",
      type: "MILES_MINIMAL_EPHEMERAL_WORKER_RUNTIME",
      generatedAt: now(),
      root: ROOT,
      pid: process.pid,
      nodeVersion: process.version,
      memory: {
        rssMb: Math.round(memory.rss / 1048576),
        heapUsedMb: Math.round(memory.heapUsed / 1048576),
        heapTotalMb: Math.round(memory.heapTotal / 1048576)
      },
      intervals: {
        execution: EXECUTION_INTERVAL_MS,
        heartbeat: HEARTBEAT_INTERVAL_MS,
        infrastructureHealth: HEALTH_INTERVAL_MS,
        autonomousWorkGeneration: WORK_GENERATION_INTERVAL_MS
      },
      lifecycle: {
        started: this.started,
        shuttingDown: this.shuttingDown,
        executionPassRunning: this.executionPassRunning,
        healthCycleRunning: this.healthCycleRunning,
        workGenerationRunning: this.workGenerationRunning
      },
      queue: queueCounts(),
      metrics: {
        ...this.metrics,
        lastExecutionResult: compactResult(this.metrics.lastExecutionResult),
        lastHealthResult: compactResult(this.metrics.lastHealthResult),
        lastWorkGenerationResult: compactResult(this.metrics.lastWorkGenerationResult),
        lastError: this.metrics.lastError
          ? {
              area: this.metrics.lastError.area || null,
              message: this.metrics.lastError.message || null,
              createdAt: this.metrics.lastError.createdAt || null
            }
          : null
      },
      resolutionHealth: this.resolutionHealth
    };
  }

  persistStatus() {
    const status = this.buildStatus();
    writeJsonAtomic(STATUS_FILE, status);
    return status;
  }

  async executePass() {
    if (this.executionPassRunning || this.shuttingDown) {
      this.metrics.executionPassesSkipped += 1;
      return { ok: true, skipped: true, reason: this.shuttingDown ? "SHUTTING_DOWN" : "PASS_ALREADY_RUNNING" };
    }

    this.executionPassRunning = true;
    const startedAt = Date.now();
    this.metrics.executionPasses += 1;
    this.metrics.lastExecutionStartedAt = now();

    try {
      const selectedTask = typeof taskQueue.claimNextExecutableTask === "function"
        ? taskQueue.claimNextExecutableTask({
            recoveredBy: "StartProductionSystem.executePass",
            claimedBy: "RuntimeWorkerSupervisor"
          })
        : taskQueue.list("QUEUED")
            .slice()
            .sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99))[0] || null;

      if (!selectedTask) {
        this.metrics.emptyQueuePasses += 1;
        const result = { ok: true, message: "No dependency-ready queued tasks" };
        this.metrics.lastExecutionResult = compactResult(result);
        return result;
      }

      this.metrics.lastExecutionTaskId = selectedTask.id || null;
      this.metrics.ephemeralExecutions += 1;
      const result = await runEphemeral("execute", { task: selectedTask });
      this.metrics.lastExecutionResult = compactResult(result);

      if (result?.status === "AWAITING_APPROVAL") this.metrics.awaitingApproval += 1;
      else if (result?.ok === true) this.metrics.completed += 1;
      else this.metrics.failed += 1;

      this.recordHistory({
        type: "EPHEMERAL_EXECUTION_PASS",
        taskId: selectedTask.id,
        provider: selectedTask.payload?.provider || selectedTask.provider || null,
        action: selectedTask.payload?.action || selectedTask.action || selectedTask.type || null,
        resultStatus: result?.status || null,
        ok: result?.ok === true
      });

      return result;
    } catch (error) {
      this.metrics.failed += 1;
      this.metrics.ephemeralFailures += 1;
      this.metrics.lastError = { area: "EPHEMERAL_EXECUTION_PASS", message: error.message, createdAt: now() };
      this.recordHistory({ type: "EPHEMERAL_EXECUTION_PASS_ERROR", error: error.message });
      console.error("[MILES] EPHEMERAL EXECUTION ERROR", error);
      return { ok: false, status: "EXECUTION_PASS_FAILED", error: error.message };
    } finally {
      this.metrics.lastExecutionCompletedAt = now();
      this.metrics.lastExecutionDurationMs = Date.now() - startedAt;
      this.executionPassRunning = false;
      this.persistStatus();
    }
  }

  async runInfrastructureHealthCycle() {
    if (this.healthCycleRunning || this.shuttingDown) return { ok: true, skipped: true };
    this.healthCycleRunning = true;
    try {
      const result = await runEphemeral("health");
      this.metrics.healthCycles += 1;
      this.metrics.lastHealthCycleAt = now();
      this.metrics.lastHealthResult = compactResult(result);
      this.recordHistory({ type: "EPHEMERAL_INFRASTRUCTURE_HEALTH", ok: result?.ok === true, status: result?.status || null });
      return result;
    } catch (error) {
      this.metrics.healthCycleFailures += 1;
      this.metrics.ephemeralFailures += 1;
      this.metrics.lastError = { area: "EPHEMERAL_INFRASTRUCTURE_HEALTH", message: error.message, createdAt: now() };
      console.error("[MILES] EPHEMERAL INFRASTRUCTURE HEALTH ERROR", error);
      return { ok: false, error: error.message };
    } finally {
      this.healthCycleRunning = false;
      this.persistStatus();
    }
  }

  async runAutonomousWorkGenerationCycle() {
    if (this.workGenerationRunning || this.shuttingDown) return { ok: true, skipped: true };
    this.workGenerationRunning = true;
    try {
      const result = await runEphemeral("autonomous");
      this.metrics.workGenerationCycles += 1;
      this.metrics.lastWorkGenerationAt = now();
      this.metrics.lastWorkGenerationResult = compactResult(result);
      this.recordHistory({ type: "EPHEMERAL_AUTONOMOUS_WORK", ok: result?.ok === true, status: result?.status || null });
      return result;
    } catch (error) {
      this.metrics.workGenerationFailures += 1;
      this.metrics.ephemeralFailures += 1;
      this.metrics.lastError = { area: "EPHEMERAL_AUTONOMOUS_WORK", message: error.message, createdAt: now() };
      console.error("[MILES] EPHEMERAL AUTONOMOUS WORK ERROR", error);
      return { ok: false, error: error.message };
    } finally {
      this.workGenerationRunning = false;
      this.persistStatus();
    }
  }

  emitHeartbeat() {
    this.metrics.heartbeatCount += 1;
    this.metrics.lastHeartbeatAt = now();
    return this.persistStatus();
  }

  startExecutionLoop() {
    console.log("[MILES] Minimal core execution scheduler starting (" + EXECUTION_INTERVAL_MS + " ms).");
    this.executePass().catch(error => console.error("[MILES] INITIAL EPHEMERAL EXECUTION ERROR", error));
    this.executionTimer = setInterval(() => {
      this.executePass().catch(error => console.error("[MILES] EPHEMERAL EXECUTION LOOP ERROR", error));
    }, EXECUTION_INTERVAL_MS);
  }

  startHeartbeatLoop() {
    console.log("[MILES] Minimal heartbeat starting (" + HEARTBEAT_INTERVAL_MS + " ms).");
    this.emitHeartbeat();
    this.heartbeatTimer = setInterval(() => this.emitHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  startInfrastructureHealthLoop() {
    console.log("[MILES] Infrastructure health scheduled in ephemeral process (" + HEALTH_INTERVAL_MS + " ms).");
    this.healthTimer = setInterval(() => {
      this.runInfrastructureHealthCycle().catch(error => console.error("[MILES] HEALTH CHILD ERROR", error));
    }, HEALTH_INTERVAL_MS);
  }

  startAutonomousWorkLoop() {
    console.log("[MILES] Autonomous work scheduled in ephemeral process (" + WORK_GENERATION_INTERVAL_MS + " ms).");
    this.workGenerationTimer = setInterval(() => {
      this.runAutonomousWorkGenerationCycle().catch(error => console.error("[MILES] AUTONOMOUS CHILD ERROR", error));
    }, WORK_GENERATION_INTERVAL_MS);
  }

  async validateResolutionHealth() {
    const validation = await runEphemeral("validate");
    this.resolutionHealth = validation;
    if (!validation?.ok) throw new Error("PROVIDER_CAPABILITY_RESOLUTION_FAILED");
    return validation;
  }

  async boot() {
    ensureRuntimeDir();
    console.log("[MILES] Minimal core booting; heavy execution isolated to ephemeral child processes.");
    await supervisor.start(60000);
    await this.validateResolutionHealth();
    await delay(STARTUP_SETTLE_MS);

    this.started = true;
    this.metrics.startedAt = now();

    this.startExecutionLoop();
    this.startHeartbeatLoop();
    this.startInfrastructureHealthLoop();
    this.startAutonomousWorkLoop();

    console.log("[MILES] Minimal core online");
    return this.persistStatus();
  }

  async shutdown(signal = "MANUAL") {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    console.log("[MILES] Minimal core shutdown requested: " + signal);

    for (const timer of [this.executionTimer, this.heartbeatTimer, this.healthTimer, this.workGenerationTimer]) {
      if (timer) {
        clearInterval(timer);
        clearTimeout(timer);
      }
    }

    try { if (typeof supervisor.stop === "function") await supervisor.stop(); } catch {}

    this.started = false;
    this.metrics.stoppedAt = now();
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

  const runtime = new RuntimeWorkerSupervisor();
  let shutdownStarted = false;

  async function shutdown(signal) {
    if (shutdownStarted) return;
    shutdownStarted = true;
    await runtime.shutdown(signal);
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT").catch(error => { console.error(error); process.exit(1); }));
  process.on("SIGTERM", () => shutdown("SIGTERM").catch(error => { console.error(error); process.exit(1); }));
  process.on("uncaughtException", error => {
    console.error("[MILES] UNCAUGHT EXCEPTION", error);
    runtime.metrics.lastError = { area: "UNCAUGHT_EXCEPTION", message: error.message, createdAt: now() };
    runtime.persistStatus();
  });
  process.on("unhandledRejection", reason => {
    console.error("[MILES] UNHANDLED REJECTION", reason);
    runtime.metrics.lastError = { area: "UNHANDLED_REJECTION", message: reason?.message || String(reason), createdAt: now() };
    runtime.persistStatus();
  });

  await runtime.boot();
}

if (require.main === module) {
  main().catch(error => {
    console.error("[MILES] BOOT FAILED");
    console.error(error);
    process.exit(1);
  });
}

module.exports = { RuntimeWorkerSupervisor, main, runEphemeral };
