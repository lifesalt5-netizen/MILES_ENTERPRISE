"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const COMPACTOR = path.join(__dirname, "CompactTaskQueueHistory.js");
const MAINTAINER = path.join(__dirname, "TaskQueueMaintenanceService.js");
const MB = 1024 * 1024;

function assert(ok, message) { if (!ok) throw new Error(message); }
function run(file, args, env) {
  const result = spawnSync(process.execPath, [file, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(file)} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  const text = String(result.stdout || "").trim();
  try { return JSON.parse(text); } catch {}
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  throw new Error(`No JSON result from ${path.basename(file)}: ${text.slice(-2000)}`);
}
function createRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, "DATA", "runtime"), { recursive: true });
  return root;
}
function writeQueue(root, tasks) {
  const runtime = path.join(root, "DATA", "runtime");
  const queue = path.join(runtime, "task_queue.json");
  const lastGood = path.join(runtime, "task_queue.last_good.json");
  fs.writeFileSync(queue, JSON.stringify(tasks, null, 2), "utf8");
  fs.copyFileSync(queue, lastGood);
  return { runtime, queue, lastGood };
}
function syntheticTasks() {
  const t = Date.now();
  const tasks = [
    { id: "dep-1", status: "COMPLETED", updatedAt: new Date(t - 1000).toISOString(), result: { blob: "d".repeat(400000) } },
    { id: "active-1", status: "QUEUED", dependencies: ["dep-1"], updatedAt: new Date(t).toISOString(), payload: { objective: "live" } },
    { id: "active-2", status: "AWAITING_APPROVAL", updatedAt: new Date(t).toISOString(), payload: { objective: "governed" } }
  ];
  for (let i = 0; i < 120; i += 1) {
    tasks.push({
      id: `done-${i}`,
      status: "COMPLETED",
      updatedAt: new Date(t - i * 1000).toISOString(),
      result: { ok: true, blob: "x".repeat(180000) }
    });
  }
  return tasks;
}

(function main() {
  const root = createRoot("miles-taskqueue-compact-");
  const originalTasks = syntheticTasks();
  const { runtime, queue, lastGood } = writeQueue(root, originalTasks);
  const beforeBytes = fs.statSync(queue).size;
  const env = {
    MILES_ROOT: root,
    MILES_QUEUE_COMPACT_TRIGGER_BYTES: String(1 * MB),
    MILES_QUEUE_COMPACT_TARGET_BYTES: String(2 * MB),
    MILES_QUEUE_COMPACT_HARD_BYTES: String(8 * MB),
    MILES_QUEUE_COMPACT_RECENT_TERMINAL: "5",
    MILES_QUEUE_COMPACT_LOCK_TIMEOUT_MS: "1000"
  };

  const compacted = run(COMPACTOR, ["--apply"], env);
  const active = JSON.parse(fs.readFileSync(queue, "utf8"));
  const afterBytes = fs.statSync(queue).size;
  assert(compacted.status === "COMPACTED", `expected COMPACTED, got ${compacted.status}`);
  assert(afterBytes < beforeBytes / 2, `queue did not shrink enough: ${beforeBytes} -> ${afterBytes}`);
  assert(active.some(t => t.id === "active-1"), "active task was lost");
  assert(active.some(t => t.id === "active-2"), "approval task was lost");
  assert(active.some(t => t.id === "dep-1"), "completed dependency required by active task was lost");
  assert(!fs.existsSync(path.join(runtime, "task_queue.lock")), "compactor leaked queue lock");

  const historyDir = path.join(runtime, "task_history");
  const archives = fs.readdirSync(historyDir).filter(name => /^task_queue_full_snapshot_.*\.json$/.test(name));
  assert(archives.length === 1, `expected one full-history archive, got ${archives.length}`);
  const archivedSnapshot = JSON.parse(fs.readFileSync(path.join(historyDir, archives[0]), "utf8"));
  assert(archivedSnapshot.length === originalTasks.length, "full historical queue snapshot was not preserved");
  const lastGoodTasks = JSON.parse(fs.readFileSync(lastGood, "utf8"));
  assert(lastGoodTasks.length === active.length, "last-good snapshot does not match compacted active queue");

  // A fresh lock owned by a live process must never be reclaimed by maintenance.
  const lockDir = path.join(runtime, "task_queue.lock");
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({
    pid: process.pid,
    token: "live-owner",
    acquiredAt: new Date().toISOString()
  }), "utf8");
  const busy = run(COMPACTOR, ["--apply", "--force", "--skip-if-busy"], {
    ...env,
    MILES_QUEUE_COMPACT_LOCK_TIMEOUT_MS: "150"
  });
  assert(busy.status === "SKIPPED_LOCK_BUSY", `live lock was not preserved: ${busy.status}`);
  assert(fs.existsSync(lockDir), "compactor incorrectly removed a live-owner lock");
  fs.rmSync(lockDir, { recursive: true, force: true });

  // Autonomous maintainer must compact a newly bloated queue in --once mode.
  const root2 = createRoot("miles-taskqueue-maint-");
  const second = syntheticTasks();
  const p2 = writeQueue(root2, second);
  const maintenance = run(MAINTAINER, ["--once"], {
    MILES_ROOT: root2,
    MILES_QUEUE_COMPACT_TRIGGER_BYTES: String(1 * MB),
    MILES_QUEUE_COMPACT_TARGET_BYTES: String(2 * MB),
    MILES_QUEUE_COMPACT_HARD_BYTES: String(8 * MB),
    MILES_QUEUE_COMPACT_RECENT_TERMINAL: "5",
    MILES_QUEUE_MAINTENANCE_LOCK_TIMEOUT_MS: "500"
  });
  assert(maintenance.status === "COMPACTED", `maintainer did not compact: ${maintenance.status}`);
  assert(fs.statSync(p2.queue).size < fs.statSync(path.join(root2, "DATA", "runtime", "task_history", fs.readdirSync(path.join(root2, "DATA", "runtime", "task_history")).find(n => n.startsWith("task_queue_full_snapshot_")))).size, "maintainer archive is not larger than active queue");
  const maintenanceStatus = JSON.parse(fs.readFileSync(path.join(root2, "DATA", "runtime", "task_queue_maintenance_status.json"), "utf8"));
  assert(maintenanceStatus.ok === true, "maintainer status is not healthy");

  console.log(JSON.stringify({
    ok: true,
    test: "TASK_QUEUE_COMPACTION_P0",
    beforeMB: Math.round(beforeBytes / MB * 100) / 100,
    afterMB: Math.round(afterBytes / MB * 100) / 100,
    beforeTasks: originalTasks.length,
    afterTasks: active.length,
    archivedTasks: compacted.archivedTasks,
    dependencyPreserved: true,
    fullHistoryPreserved: true,
    liveLockPreserved: true,
    autonomousMaintenance: true
  }, null, 2));
})();
