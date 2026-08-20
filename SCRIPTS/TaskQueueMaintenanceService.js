"use strict";

const fs = require("fs");
const path = require("path");
const { compactQueue, paths } = require("./CompactTaskQueueHistory");

const MB = 1024 * 1024;
const ROOT = process.env.MILES_ROOT || process.cwd();
const STATUS_FILE = path.join(ROOT, "DATA", "runtime", "task_queue_maintenance_status.json");
const INTERVAL_MS = Math.max(60000, Number(process.env.MILES_QUEUE_MAINTENANCE_INTERVAL_MS || 120000));
const TRIGGER_BYTES = Math.max(8 * MB, Number(process.env.MILES_QUEUE_COMPACT_TRIGGER_BYTES || 24 * MB));
const TARGET_BYTES = Math.max(4 * MB, Number(process.env.MILES_QUEUE_COMPACT_TARGET_BYTES || 12 * MB));
const HARD_BYTES = Math.max(TARGET_BYTES, Number(process.env.MILES_QUEUE_COMPACT_HARD_BYTES || 64 * MB));

function now() { return new Date().toISOString(); }
function writeStatus(value) {
  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
  const temp = `${STATUS_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  try { fs.renameSync(temp, STATUS_FILE); }
  catch { fs.copyFileSync(temp, STATUS_FILE); try { fs.unlinkSync(temp); } catch {} }
}

function cycle() {
  let queueBytes = 0;
  try { queueBytes = fs.existsSync(paths.QUEUE_PATH) ? fs.statSync(paths.QUEUE_PATH).size : 0; }
  catch {}

  if (queueBytes <= TRIGGER_BYTES) {
    const result = {
      ok: true,
      service: "MILES_TASK_QUEUE_MAINTAINER",
      status: "IDLE_BELOW_TRIGGER",
      pid: process.pid,
      generatedAt: now(),
      queueBytes,
      triggerBytes: TRIGGER_BYTES,
      targetBytes: TARGET_BYTES
    };
    writeStatus(result);
    return result;
  }

  try {
    const maintenance = compactQueue({
      apply: true,
      triggerBytes: TRIGGER_BYTES,
      targetBytes: TARGET_BYTES,
      hardBytes: HARD_BYTES,
      recentTerminalLimit: Number(process.env.MILES_QUEUE_COMPACT_RECENT_TERMINAL || 100),
      lockTimeoutMs: Number(process.env.MILES_QUEUE_MAINTENANCE_LOCK_TIMEOUT_MS || 750),
      skipIfBusy: true
    });
    const result = {
      ok: maintenance.ok === true,
      service: "MILES_TASK_QUEUE_MAINTAINER",
      status: maintenance.status,
      pid: process.pid,
      generatedAt: now(),
      maintenance
    };
    writeStatus(result);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      service: "MILES_TASK_QUEUE_MAINTAINER",
      status: "MAINTENANCE_FAILED",
      pid: process.pid,
      generatedAt: now(),
      error: error.message
    };
    writeStatus(result);
    return result;
  }
}

if (require.main === module) {
  const once = process.argv.includes("--once");
  const first = cycle();
  console.log(JSON.stringify(first));
  if (once) {
    process.exitCode = first.ok === false ? 1 : 0;
  } else {
    console.log(`[MILES TASK QUEUE MAINTAINER] pid=${process.pid} intervalMs=${INTERVAL_MS} triggerMB=${Math.round(TRIGGER_BYTES / MB)} targetMB=${Math.round(TARGET_BYTES / MB)}`);
    const timer = setInterval(() => {
      const result = cycle();
      if (result.status !== "IDLE_BELOW_TRIGGER") console.log(JSON.stringify(result));
    }, INTERVAL_MS);
    process.on("SIGINT", () => { clearInterval(timer); process.exit(0); });
    process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
    // Keep the process alive without a second orphan-prone keepalive timer.
    timer.ref?.();
  }
}

module.exports = { cycle, STATUS_FILE, INTERVAL_MS, TRIGGER_BYTES, TARGET_BYTES, HARD_BYTES };
