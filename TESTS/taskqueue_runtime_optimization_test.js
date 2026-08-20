"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-queue-opt-"));
process.env.MILES_ROOT = root;
process.env.MILES_QUEUE_LOCK_TIMEOUT_MS = "250";
process.env.MILES_QUEUE_LOCK_RETRY_MS = "10";
process.env.MILES_QUEUE_TELEMETRY_CACHE_MS = "250";
process.env.MILES_QUEUE_TELEMETRY_TEST_MODE = "1";

const repoRoot = path.resolve(__dirname, "..");
const queueModulePath = path.join(repoRoot, "CORE", "TaskQueue.js");
const optimizerPath = path.join(repoRoot, "SCRIPTS", "TaskQueueRuntimeOptimizer.js");
const queuePath = path.join(root, "DATA", "runtime", "task_queue.json");

try {
  const queue = require(queueModulePath);
  require(optimizerPath);

  assert.strictEqual(queue.__milesRuntimeOptimized, true);
  assert.ok(queue.__milesOptimizationInfo.fastMutatorNames.includes("claimNextExecutableTask"));

  const originalRead = fs.readFileSync;
  let queueReads = 0;
  fs.readFileSync = function countedRead(file, ...args) {
    if (path.resolve(String(file)) === path.resolve(queuePath)) queueReads += 1;
    return originalRead.call(fs, file, ...args);
  };

  queueReads = 0;
  queue.add({ id: "FAST-A", type: "TEST", status: "QUEUED", priority: 10 });
  assert.strictEqual(queueReads, 1, "add should read the queue once and write the locked snapshot without rereading it");

  queueReads = 0;
  queue.update("FAST-A", { status: "COMPLETED" });
  assert.strictEqual(queueReads, 1, "update should read the queue once and write the locked snapshot without rereading it");

  queueReads = 0;
  const status = queue.getStatus();
  assert.strictEqual(status.total, 1);
  assert.strictEqual(status.completed, 1);
  assert.strictEqual(queueReads, 1, "getStatus should use one queue read, not getStatus + calculateHealthScore rereads");

  queue.__milesOptimizationInfo.invalidateTelemetryCache();
  function queueCounts() {
    const items = queue.list();
    const health = queue.getStatus();
    return { items, health };
  }

  queueReads = 0;
  const telemetry = queueCounts();
  assert.strictEqual(telemetry.items.length, 1);
  assert.strictEqual(telemetry.health.total, 1);
  assert.strictEqual(queueReads, 1, "queueCounts telemetry should share one cached snapshot across list + getStatus");

  queue.__milesOptimizationInfo.invalidateTelemetryCache();
  const originalQueueRead = queue._read;
  queue._read = () => { throw new Error("TaskQueue lock could not be acquired."); };

  assert.doesNotThrow(() => queueCounts(), "queueCounts telemetry must fail soft on lock contention");
  assert.throws(() => queue.list(), /lock could not be acquired/i, "non-telemetry queue reads must still fail closed");
  queue._read = originalQueueRead;

  fs.readFileSync = originalRead;

  const persisted = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  assert.strictEqual(persisted.length, 1);
  assert.strictEqual(persisted[0].id, "FAST-A");
  assert.strictEqual(persisted[0].status, "COMPLETED");

  console.log("TASKQUEUE_RUNTIME_OPTIMIZATION_TEST: GREEN");
} finally {
  delete process.env.MILES_QUEUE_TELEMETRY_TEST_MODE;
  fs.rmSync(root, { recursive: true, force: true });
}
