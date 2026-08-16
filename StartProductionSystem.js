"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

process.env.MILES_ROOT = process.env.MILES_ROOT || __dirname;
const ROOT = process.env.MILES_ROOT;
const RUNTIME_DIR = path.join(ROOT, "DATA", "runtime");
const STATUS_FILE = path.join(RUNTIME_DIR, "worker_runtime_status.json");
const EXECUTION_HISTORY_FILE = path.join(RUNTIME_DIR, "execution_history.jsonl");

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const EXECUTION_INTERVAL_MS = positiveNumber(process.env.MILES_EXECUTION_INTERVAL_MS, 5000);
const HEARTBEAT_INTERVAL_MS = positiveNumber(process.env.MILES_HEARTBEAT_INTERVAL_MS, 15000);
const HEALTH_INTERVAL_MS = positiveNumber(process.env.MILES_INFRASTRUCTURE_HEALTH_INTERVAL_MS, 5 * 60 * 1000);
const WORK_GENERATION_INTERVAL_MS = positiveNumber(process.env.MILES_AUTONOMOUS_WORK_INTERVAL_MS, 5 * 60 * 1000);
const STARTUP_SETTLE_MS = positiveNumber(process.env.MILES_WORKER_STARTUP_SETTLE_MS, 1000);

const taskQueue = require("./CORE/TaskQueue");

function lazyModule(modulePath) {
  let loaded = null;
  return new Proxy({}, {
    get(_target, property) {
      if (!loaded) loaded = require(modulePath);
      const value = loaded[property];
      return typeof value === "function" ? value.bind(loaded) : value;
    }
  });
}

const supervisor = lazyModule("./CORE/Supervisor");
const executionService = lazyModule("./SERVICES/ExecutionService");
const infrastructureHealthManager = lazyModule("./SERVICES/InfrastructureHealthManagerService");
const autonomousWorkGenerator = lazyModule("./SERVICES/AutonomousWorkGenerationService");
const providerRouter = lazyModule("./SERVICES/ProviderRouterService");
const connectorManager = lazyModule("./CORE/ConnectorManager");
const capabilityService = lazyModule("./SERVICES/CapabilityService");
const capabilityDispatcher = lazyModule("./SERVICES/CapabilityDispatcherService");
const eventBus = lazyModule("./event-bus/emitter");

function now() { return new Date().toISOString(); }
function delay(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function ensureRuntimeDir() { fs.mkdirSync(RUNTIME_DIR, { recursive: true }); }

function writeJsonAtomic(filePath, value) {
  ensureRuntimeDir();
  const temporaryFile = filePath + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(temporaryFile, JSON.stringify(value, null, 2), "utf8");
  try { fs.renameSync(temporaryFile, filePath); }
  catch {
    fs.copyFileSync(temporaryFile, filePath);
    try { fs.unlinkSync(temporaryFile); } catch {}
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

function compactResolution(result, countKey) {
  if (!result || typeof result !== "object") return { ok: false, count: null, checkedAt: null };
  return {
    ok: result.ok === true,
    count: countKey ? Number(result[countKey] || 0) : null,
    checkedAt: result.checkedAt || null
  };
}

function queueCounts() {
  const items = typeof taskQueue.list === "function" ? taskQueue.list() : [];
  const counts = { total: items.length, queued: 0, running: 0, completed: 0, failed: 0, awaitingApproval: 0, other: 0 };
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
  } catch { counts.healthScore = null; }
  return counts;
}

function emitCooTick(payload) {
  try {
    const bus = eventBus?.bus || eventBus;
    if (bus && typeof bus.emit === "function") { bus.emit("COO_TICK", payload); return true; }
    if (bus && typeof bus.publish === "function") { bus.publish("COO_TICK", payload); return true; }
  } catch (error) {
    console.error("[MILES] COO_TICK emission failed:", error.message);
  }
  return false;
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
      type: "MILES_MINIMAL_WORKER_RUNTIME",
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
        pid: this.metrics.pid,
        startedAt: this.metrics.startedAt,
        stoppedAt: this.metrics.stoppedAt,
        executionPasses: this.metrics.executionPasses,
        executionPassesSkipped: this.metrics.executionPassesSkipped,
        completed: this.metrics.completed,
        failed: this.metrics.failed,
        awaitingApproval: this.metrics.awaitingApproval,
        emptyQueuePasses: this.metrics.emptyQueuePasses,
        healthCycles: this.metrics.healthCycles,
        healthCycleFailures: this.metrics.healthCycleFailures,
        workGenerationCycles: this.metrics.workGenerationCycles,
        workGenerationFailures: this.metrics.workGenerationFailures,
        heartbeatCount: this.metrics.heartbeatCount,
        lastExecutionStartedAt: this.metrics.lastExecutionStartedAt,
        lastExecutionCompletedAt: this.metrics.lastExecutionCompletedAt,
        lastExecutionDurationMs: this.metrics.lastExecutionDurationMs,
        lastExecutionTaskId: this.metrics.lastExecutionTaskId,
        lastExecutionResult: compactResult(this.metrics.lastExecutionResult),
        lastHealthCycleAt: this.metrics.lastHealthCycleAt,
        lastHealthResult: compactResult(this.metrics.lastHealthResult),
        lastWorkGenerationAt: this.metrics.lastWorkGenerationAt,
        lastWorkGenerationResult: compactResult(this.metrics.lastWorkGenerationResult),
        lastHeartbeatAt: this.metrics.lastHeartbeatAt,
        lastError: this.metrics.lastError ? { area: this.metrics.lastError.area || null, message: this.metrics.lastError.message || null, createdAt: this.metrics.lastError.createdAt || null } : null
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
        ? taskQueue.claimNextExecutableTask({ recoveredBy: "StartProductionSystem.executePass", claimedBy: "RuntimeWorkerSupervisor" })
        : taskQueue.list("QUEUED").slice().sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99))[0] || null;

      if (!selectedTask) {
        this.metrics.emptyQueuePasses += 1;
        const result = { ok: true, message: "No dependency-ready queued tasks" };
        this.metrics.lastExecutionResult = compactResult(result);
        return result;
      }

      this.metrics.lastExecutionTaskId = selectedTask.id || null;
      const result = await executionService.execute(selectedTask);
      this.metrics.lastExecutionResult = compactResult(result);

      if (result?.status === "AWAITING_APPROVAL") this.metrics.awaitingApproval += 1;
      else if (result?.ok === true) this.metrics.completed += 1;
      else this.metrics.failed += 1;

      this.recordHistory({
        type: "EXECUTION_PASS",
        taskId: selectedTask.id,
        provider: selectedTask.payload?.provider || selectedTask.provider || null,
        action: selectedTask.payload?.action || selectedTask.action || selectedTask.type || null,
        resultStatus: result?.status || null,
        ok: result?.ok === true
      });

      return result;
    } catch (error) {
      this.metrics.failed += 1;
      this.metrics.lastError = { area: "EXECUTION_PASS", message: error.message, createdAt: now() };
      this.recordHistory({ type: "EXECUTION_PASS_ERROR", error: error.message });
      console.error("[MILES] EXECUTION LOOP ERROR", error);
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
      const result = await infrastructureHealthManager.runCycle();
      this.metrics.healthCycles += 1;
      this.metrics.lastHealthCycleAt = now();
      this.metrics.lastHealthResult = compactResult(result);
      this.recordHistory({ type: "INFRASTRUCTURE_HEALTH_CYCLE", ok: result?.ok === true, durationMs: result?.durationMs || null, failures: Array.isArray(result?.failures) ? result.failures.slice(0, 10) : [] });
      return result;
    } catch (error) {
      this.metrics.healthCycleFailures += 1;
      this.metrics.lastError = { area: "INFRASTRUCTURE_HEALTH", message: error.message, createdAt: now() };
      console.error("[MILES] INFRASTRUCTURE HEALTH ERROR", error);
      return { ok: false, error: error.message };
    } finally {
      this.healthCycleRunning = false;
      this.persistStatus();
    }
  }

  runAutonomousWorkGenerationCycle() {
    if (this.workGenerationRunning || this.shuttingDown) return { ok: true, skipped: true };
    this.workGenerationRunning = true;
    try {
      const result = autonomousWorkGenerator.runCycle();
      this.metrics.workGenerationCycles += 1;
      this.metrics.lastWorkGenerationAt = now();
      this.metrics.lastWorkGenerationResult = compactResult(result);
      this.recordHistory({ type: "AUTONOMOUS_WORK_GENERATION", ok: result?.ok === true, status: result?.status || null });
      return result;
    } catch (error) {
      this.metrics.workGenerationFailures += 1;
      this.metrics.lastError = { area: "AUTONOMOUS_WORK_GENERATION", message: error.message, createdAt: now() };
      console.error("[MILES] AUTONOMOUS WORK ERROR", error);
      return { ok: false, error: error.message };
    } finally {
      this.workGenerationRunning = false;
      this.persistStatus();
    }
  }

  emitHeartbeat() {
    const queue = queueCounts();
    this.metrics.heartbeatCount += 1;
    this.metrics.lastHeartbeatAt = now();
    const payload = {
      generatedAt: this.metrics.lastHeartbeatAt,
      queue,
      metrics: {
        executionPasses: this.metrics.executionPasses,
        completed: this.metrics.completed,
        failed: this.metrics.failed,
        healthCycles: this.metrics.healthCycles,
        workGenerationCycles: this.metrics.workGenerationCycles
      }
    };
    emitCooTick(payload);
    this.persistStatus();
    return payload;
  }

  startExecutionLoop() {
    console.log("[MILES] Canonical execution loop starting (" + EXECUTION_INTERVAL_MS + " ms).");
    this.executePass().catch(error => console.error("[MILES] INITIAL EXECUTION PASS ERROR", error));
    this.executionTimer = setInterval(() => {
      this.executePass().catch(error => console.error("[MILES] EXECUTION LOOP ERROR", error));
    }, EXECUTION_INTERVAL_MS);
  }

  startHeartbeatLoop() {
    console.log("[MILES] Heartbeat loop starting (" + HEARTBEAT_INTERVAL_MS + " ms).");
    this.emitHeartbeat();
    this.heartbeatTimer = setInterval(() => this.emitHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  startInfrastructureHealthLoop() {
    console.log("[MILES] Infrastructure health scheduled (" + HEALTH_INTERVAL_MS + " ms; deferred startup).");
    this.healthTimer = setInterval(() => {
      this.runInfrastructureHealthCycle().catch(error => console.error("[MILES] INFRASTRUCTURE HEALTH LOOP ERROR", error));
    }, HEALTH_INTERVAL_MS);
  }

  startAutonomousWorkLoop() {
    console.log("[MILES] Autonomous work scheduled (" + WORK_GENERATION_INTERVAL_MS + " ms; deferred startup).");
    this.workGenerationTimer = setInterval(() => {
      try { this.runAutonomousWorkGenerationCycle(); }
      catch (error) { console.error("[MILES] AUTONOMOUS WORK LOOP ERROR", error); }
    }, WORK_GENERATION_INTERVAL_MS);
  }

  async boot() {
    if (this.started) return this.persistStatus();

    console.log("[MILES] AUTONOMOUS SYSTEM ONLINE");
    console.log("[MILES] GOVERNED MINIMAL WORKER RUNTIME ACTIVE");

    await supervisor.start();

    const providerResolution = providerRouter.status();
    const capabilityResolution = capabilityService.validateRegistry(providerRouter);
    const connectorResolution = connectorManager.validateAll();
    const routingResolution = capabilityDispatcher.validate(connectorManager);

    this.resolutionHealth = {
      ok: providerResolution.ok === true && capabilityResolution.ok === true && connectorResolution.ok === true && routingResolution.ok === true,
      providerRegistry: compactResolution(providerResolution.validation || providerResolution, "providerCount"),
      capabilityRegistry: compactResolution(capabilityResolution, "capabilityCount"),
      connectorRegistry: compactResolution(connectorResolution, "connectorCount"),
      routing: compactResolution(routingResolution),
      checkedAt: now()
    };

    if (!this.resolutionHealth.ok) throw new Error("PROVIDER_CAPABILITY_RESOLUTION_FAILED");

    await delay(STARTUP_SETTLE_MS);

    this.started = true;
    this.metrics.startedAt = now();

    this.startExecutionLoop();
    this.startHeartbeatLoop();
    this.startInfrastructureHealthLoop();
    this.startAutonomousWorkLoop();

    console.log("[MILES] Minimal workers online");
    return this.persistStatus();
  }

  async shutdown(signal = "MANUAL") {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    console.log("[MILES] Worker runtime shutdown requested: " + signal);

    for (const timer of [this.executionTimer, this.heartbeatTimer, this.healthTimer, this.workGenerationTimer]) {
      if (timer) { clearInterval(timer); clearTimeout(timer); }
    }

    try { if (typeof infrastructureHealthManager.stop === "function") await infrastructureHealthManager.stop(); } catch {}
    try { if (typeof autonomousWorkGenerator.stop === "function") autonomousWorkGenerator.stop(); } catch {}
    try { if (typeof providerRouter.shutdown === "function") await providerRouter.shutdown(); } catch {}
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

module.exports = { RuntimeWorkerSupervisor, main };
