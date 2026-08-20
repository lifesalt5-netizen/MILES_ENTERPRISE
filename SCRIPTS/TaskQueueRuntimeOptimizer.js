"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const TELEMETRY_CACHE_MS = Math.max(
  250,
  Number(process.env.MILES_QUEUE_TELEMETRY_CACHE_MS || 5000)
);

const taskQueue = require(path.join(ROOT, "CORE", "TaskQueue"));

if (!taskQueue.__milesRuntimeOptimized) {
  const originalWriteJsonDirect = taskQueue.writeJsonDirect.bind(taskQueue);
  const originalList = taskQueue.list.bind(taskQueue);
  const fastMutatorNames = [
    "add",
    "recoverStaleRunningTasks",
    "recoverRetryableFailedTasks",
    "claimNextExecutableTask",
    "update"
  ];

  const telemetryCache = {
    items: [],
    loadedAt: 0
  };

  function telemetryCaller() {
    const stack = String(new Error().stack || "");
    return stack.includes("queueCounts") && stack.includes("StartProductionSystem.js");
  }

  function cacheFresh() {
    return (
      telemetryCache.loadedAt > 0 &&
      Date.now() - telemetryCache.loadedAt <= TELEMETRY_CACHE_MS
    );
  }

  function setTelemetryCache(items) {
    telemetryCache.items = Array.isArray(items) ? items : [];
    telemetryCache.loadedAt = Date.now();
  }

  function invalidateTelemetryCache() {
    telemetryCache.items = [];
    telemetryCache.loadedAt = 0;
  }

  function calculateHealthScoreFromTasks(tasks) {
    const current = Date.now();
    let score = 100;

    for (const task of tasks) {
      const baseTime = task.updatedAt || task.createdAt || new Date().toISOString();
      const parsedTime = new Date(baseTime).getTime();
      const ageHours = Number.isFinite(parsedTime)
        ? (current - parsedTime) / 3600000
        : 0;
      const decay =
        ageHours < 6 ? 1.0 :
        ageHours < 24 ? 0.6 :
        ageHours < 72 ? 0.3 :
        0.1;

      if (task.status === "FAILED") score -= 6 * decay;
      if (task.status === "COMPLETED") score += 1.5 * decay;
      if (task.status === "RUNNING") score += 0.2;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function statusFromTasks(tasks) {
    return {
      total: tasks.length,
      pending: tasks.filter(task => task.status === "QUEUED").length,
      running: tasks.filter(task => task.status === "RUNNING").length,
      completed: tasks.filter(task => task.status === "COMPLETED").length,
      failed: tasks.filter(task => task.status === "FAILED").length,
      healthScore: calculateHealthScoreFromTasks(tasks)
    };
  }

  function writeLockedSnapshot(queue, tasks) {
    const normalized = queue.normalizeTasks(Array.isArray(tasks) ? tasks : []);
    queue.ensureRuntime();

    const tmp = `${queue.queuePath}.tmp_${process.pid}_${Date.now()}`;
    const json = JSON.stringify(normalized, null, 2);
    const descriptor = fs.openSync(tmp, "wx");

    try {
      fs.writeFileSync(descriptor, json, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }

    try {
      if (fs.existsSync(queue.queuePath)) {
        fs.rmSync(queue.lastGoodPath, { force: true });
        try {
          fs.renameSync(queue.queuePath, queue.lastGoodPath);
        } catch {
          fs.copyFileSync(queue.queuePath, queue.lastGoodPath);
          fs.rmSync(queue.queuePath, { force: true });
        }
      }

      fs.renameSync(tmp, queue.queuePath);
      setTelemetryCache(normalized);
      return normalized;
    } catch (error) {
      if (!fs.existsSync(queue.queuePath) && fs.existsSync(queue.lastGoodPath)) {
        fs.copyFileSync(queue.lastGoodPath, queue.queuePath);
      }
      throw error;
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
  }

  taskQueue.writeJsonDirect = function optimizedWriteJsonDirect(tasks) {
    if (Number(this.__milesFastWriteDepth || 0) > 0) {
      return writeLockedSnapshot(this, tasks);
    }
    return originalWriteJsonDirect(tasks);
  };

  for (const name of fastMutatorNames) {
    const original = taskQueue[name];
    if (typeof original !== "function") continue;

    taskQueue[name] = function optimizedLockedMutator(...args) {
      this.__milesFastWriteDepth = Number(this.__milesFastWriteDepth || 0) + 1;
      try {
        return original.apply(this, args);
      } finally {
        this.__milesFastWriteDepth = Math.max(
          0,
          Number(this.__milesFastWriteDepth || 1) - 1
        );
      }
    };
  }

  taskQueue.list = function optimizedList(status = null) {
    const telemetry = telemetryCaller();

    if (telemetry && status === null && cacheFresh()) {
      return telemetryCache.items.slice();
    }

    try {
      const items = originalList(status);
      if (telemetry && status === null) setTelemetryCache(items);
      return items;
    } catch (error) {
      if (telemetry && /TaskQueue lock could not be acquired/i.test(String(error?.message || error))) {
        console.warn(
          "[MILES] Queue telemetry temporarily unavailable:",
          error?.message || String(error)
        );
        if (!cacheFresh()) setTelemetryCache(telemetryCache.items);
        const snapshot = telemetryCache.items.slice();
        return status ? snapshot.filter(item => item.status === status) : snapshot;
      }
      throw error;
    }
  };

  taskQueue.getStatus = function optimizedGetStatus() {
    const telemetry = telemetryCaller();

    if (telemetry && cacheFresh()) {
      return statusFromTasks(telemetryCache.items);
    }

    try {
      const tasks = this._read();
      if (telemetry) setTelemetryCache(tasks);
      return statusFromTasks(tasks);
    } catch (error) {
      if (telemetry && /TaskQueue lock could not be acquired/i.test(String(error?.message || error))) {
        console.warn(
          "[MILES] Queue telemetry temporarily unavailable:",
          error?.message || String(error)
        );
        if (!cacheFresh()) setTelemetryCache(telemetryCache.items);
        return statusFromTasks(telemetryCache.items);
      }
      throw error;
    }
  };

  taskQueue.__milesRuntimeOptimized = true;
  taskQueue.__milesOptimizationInfo = {
    telemetryCacheMs: TELEMETRY_CACHE_MS,
    fastMutatorNames: fastMutatorNames.slice(),
    invalidateTelemetryCache,
    statusFromTasks
  };

  console.log(
    `[MILES QUEUE OPTIMIZER] active | telemetryCacheMs=${TELEMETRY_CACHE_MS} | fastMutators=${fastMutatorNames.join(",")}`
  );
}

module.exports = taskQueue;
