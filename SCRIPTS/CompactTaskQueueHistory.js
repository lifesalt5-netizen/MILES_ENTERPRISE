"use strict";

const fs = require("fs");
const path = require("path");

const MB = 1024 * 1024;
const ROOT = process.env.MILES_ROOT || process.cwd();
const RUNTIME_DIR = path.join(ROOT, "DATA", "runtime");
const QUEUE_PATH = path.join(RUNTIME_DIR, "task_queue.json");
const LAST_GOOD_PATH = path.join(RUNTIME_DIR, "task_queue.last_good.json");
const LOCK_PATH = path.join(RUNTIME_DIR, "task_queue.lock");
const HISTORY_DIR = path.join(RUNTIME_DIR, "task_history");
const MANIFEST_PATH = path.join(HISTORY_DIR, "manifest.jsonl");

const TERMINAL = new Set([
  "COMPLETED",
  "COMPLETE",
  "FAILED",
  "CANCELLED",
  "REJECTED",
  "BLOCKED"
]);

function now() { return new Date().toISOString(); }
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms));
}
function sanitize(text) { return String(text || "").replace(/^\uFEFF/, "").trim(); }
function processAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try { process.kill(numericPid, 0); return true; }
  catch (error) { return error && error.code === "EPERM"; }
}
function readOwner() {
  try {
    const file = path.join(LOCK_PATH, "owner.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  } catch { return null; }
}
function lockAgeMs() {
  try {
    const owner = readOwner();
    const acquired = new Date(owner && owner.acquiredAt || 0).getTime();
    if (Number.isFinite(acquired) && acquired > 0) return Math.max(0, Date.now() - acquired);
    return Math.max(0, Date.now() - fs.statSync(LOCK_PATH).mtimeMs);
  } catch { return 0; }
}
function canReclaimLock(staleMs) {
  if (!fs.existsSync(LOCK_PATH)) return false;
  if (lockAgeMs() < staleMs) return false;
  const owner = readOwner();
  return !owner || !processAlive(owner.pid);
}
function acquireLock(options = {}) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const timeoutMs = Math.max(100, Number(options.timeoutMs ?? 15000));
  const retryMs = Math.max(10, Number(options.retryMs ?? 50));
  const staleMs = Math.max(1000, Number(options.staleMs ?? 5000));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      fs.mkdirSync(LOCK_PATH);
      fs.writeFileSync(
        path.join(LOCK_PATH, "owner.json"),
        JSON.stringify({ pid: process.pid, token, acquiredAt: now(), owner: "TASK_QUEUE_COMPACTOR" }, null, 2),
        "utf8"
      );
      return token;
    } catch {
      if (canReclaimLock(staleMs)) {
        try { fs.rmSync(LOCK_PATH, { recursive: true, force: true }); continue; }
        catch {}
      }
      sleepSync(retryMs);
    }
  }

  const owner = readOwner();
  const error = new Error(
    `TaskQueue maintenance lock unavailable after ${timeoutMs}ms; ` +
    `ageMs=${lockAgeMs()}; ownerPid=${owner && owner.pid || "unknown"}`
  );
  error.code = "LOCK_BUSY";
  throw error;
}
function releaseLock(token) {
  try {
    const owner = readOwner();
    if (owner && owner.pid === process.pid && owner.token === token) {
      fs.rmSync(LOCK_PATH, { recursive: true, force: true });
    }
  } catch {}
}
function dependencyIds(task = {}) {
  const raw = task.dependsOn || task.dependencies || task.payload?.dependsOn || task.payload?.dependencies || [];
  return (Array.isArray(raw) ? raw : [raw])
    .map(value => value && typeof value === "object" ? String(value.id || value.taskId || "").trim() : String(value || "").trim())
    .filter(Boolean);
}
function timestamp(task) {
  const parsed = new Date(task?.updatedAt || task?.completedAt || task?.failedAt || task?.createdAt || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
function isTerminal(task) { return TERMINAL.has(String(task?.status || "").toUpperCase()); }
function taskBytes(task) { return Buffer.byteLength(JSON.stringify(task), "utf8") + 1; }
function readQueue() {
  if (!fs.existsSync(QUEUE_PATH)) return [];
  const text = sanitize(fs.readFileSync(QUEUE_PATH, "utf8"));
  if (!text) return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("Task queue root is not an array.");
  return parsed;
}
function fsyncWrite(file, text) {
  const fd = fs.openSync(file, "wx");
  try {
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}
function selectActiveQueue(tasks, options = {}) {
  const targetBytes = Math.max(MB, Number(options.targetBytes ?? 16 * MB));
  const hardBytes = Math.max(targetBytes, Number(options.hardBytes ?? 64 * MB));
  const recentTerminalLimit = Math.max(0, Number(options.recentTerminalLimit ?? 100));
  const byId = new Map(tasks.filter(t => t && t.id).map(t => [String(t.id), t]));
  const keepIds = new Set();
  const mandatory = new Set();

  for (const task of tasks) {
    if (!isTerminal(task)) {
      mandatory.add(task);
      if (task && task.id) keepIds.add(String(task.id));
    }
  }

  // Preserve the full dependency closure of every active task so an archived
  // completed dependency can never make a live task look missing/blocked.
  const visit = id => {
    const task = byId.get(String(id));
    if (!task || mandatory.has(task)) return;
    mandatory.add(task);
    if (task.id) keepIds.add(String(task.id));
    for (const dep of dependencyIds(task)) visit(dep);
  };
  for (const task of [...mandatory]) for (const dep of dependencyIds(task)) visit(dep);

  let estimatedBytes = 2;
  for (const task of mandatory) estimatedBytes += taskBytes(task);

  const terminalCandidates = tasks
    .filter(task => isTerminal(task) && !mandatory.has(task))
    .sort((a, b) => timestamp(b) - timestamp(a));

  let recentKept = 0;
  for (const task of terminalCandidates) {
    if (recentKept >= recentTerminalLimit) break;
    const bytes = taskBytes(task);
    if (estimatedBytes + bytes > targetBytes) continue;
    mandatory.add(task);
    estimatedBytes += bytes;
    recentKept += 1;
  }

  const kept = tasks.filter(task => mandatory.has(task));
  const archived = tasks.filter(task => !mandatory.has(task));
  const compactText = JSON.stringify(kept);
  const actualBytes = Buffer.byteLength(compactText, "utf8");

  if (actualBytes > hardBytes) {
    const error = new Error(
      `Active/dependency-preserved queue remains ${Math.round(actualBytes / MB)} MB, above hard limit ${Math.round(hardBytes / MB)} MB. ` +
      `Refusing destructive compaction because active work itself is too large.`
    );
    error.code = "ACTIVE_QUEUE_TOO_LARGE";
    throw error;
  }

  return { kept, archived, compactText, actualBytes, targetBytes, hardBytes, recentKept };
}

function compactQueue(options = {}) {
  const apply = options.apply === true;
  const triggerBytes = Math.max(MB, Number(options.triggerBytes ?? 64 * MB));
  const targetBytes = Math.max(MB, Number(options.targetBytes ?? 16 * MB));
  const hardBytes = Math.max(targetBytes, Number(options.hardBytes ?? 64 * MB));
  const recentTerminalLimit = Math.max(0, Number(options.recentTerminalLimit ?? 100));
  const lockTimeoutMs = Math.max(100, Number(options.lockTimeoutMs ?? 15000));
  const skipIfBusy = options.skipIfBusy === true;

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.mkdirSync(HISTORY_DIR, { recursive: true });

  if (!fs.existsSync(QUEUE_PATH)) {
    return { ok: true, status: "NO_QUEUE", applied: false, queuePath: QUEUE_PATH };
  }

  const beforeBytes = fs.statSync(QUEUE_PATH).size;
  if (!options.force && beforeBytes <= triggerBytes) {
    return {
      ok: true,
      status: "BELOW_TRIGGER",
      applied: false,
      beforeBytes,
      triggerBytes,
      queuePath: QUEUE_PATH
    };
  }

  let token;
  try {
    token = acquireLock({ timeoutMs: lockTimeoutMs });
  } catch (error) {
    if (skipIfBusy && error.code === "LOCK_BUSY") {
      return { ok: true, status: "SKIPPED_LOCK_BUSY", applied: false, beforeBytes, error: error.message };
    }
    throw error;
  }

  try {
    const beforeStat = fs.statSync(QUEUE_PATH);
    const tasks = readQueue();
    const selection = selectActiveQueue(tasks, { targetBytes, hardBytes, recentTerminalLimit });
    const afterBytes = selection.actualBytes;

    const base = {
      ok: true,
      status: "COMPACTION_PLANNED",
      applied: false,
      queuePath: QUEUE_PATH,
      beforeBytes: beforeStat.size,
      afterBytes,
      beforeTasks: tasks.length,
      afterTasks: selection.kept.length,
      archivedTasks: selection.archived.length,
      recentTerminalKept: selection.recentKept,
      activeOrDependencyTasks: selection.kept.length - selection.recentKept,
      reductionPct: beforeStat.size > 0 ? Math.round((1 - afterBytes / beforeStat.size) * 10000) / 100 : 0
    };

    if (!apply) return base;
    if (selection.archived.length === 0 && afterBytes >= beforeStat.size) {
      return { ...base, status: "NOTHING_SAFE_TO_ARCHIVE" };
    }

    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const archivePath = path.join(HISTORY_DIR, `task_queue_full_snapshot_${stamp}.json`);
    const tempPath = `${QUEUE_PATH}.compact_${process.pid}_${Date.now()}.tmp`;
    const manifestFile = path.join(HISTORY_DIR, `task_queue_compaction_${stamp}.json`);

    fsyncWrite(tempPath, selection.compactText);
    const verification = JSON.parse(fs.readFileSync(tempPath, "utf8"));
    if (!Array.isArray(verification) || verification.length !== selection.kept.length) {
      throw new Error("Compacted queue verification failed before promotion.");
    }

    let originalArchived = false;
    try {
      try {
        fs.renameSync(QUEUE_PATH, archivePath);
      } catch {
        fs.copyFileSync(QUEUE_PATH, archivePath);
        fs.rmSync(QUEUE_PATH, { force: true });
      }
      originalArchived = true;
      fs.renameSync(tempPath, QUEUE_PATH);
      fs.copyFileSync(QUEUE_PATH, LAST_GOOD_PATH);
    } catch (error) {
      try { if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true }); } catch {}
      if (!fs.existsSync(QUEUE_PATH) && originalArchived && fs.existsSync(archivePath)) {
        fs.copyFileSync(archivePath, QUEUE_PATH);
      }
      throw error;
    }

    const manifest = {
      ...base,
      status: "COMPACTED",
      applied: true,
      archivePath,
      manifestFile,
      completedAt: now(),
      fullHistoryPreserved: true
    };
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
    fs.appendFileSync(MANIFEST_PATH, JSON.stringify(manifest) + "\n", "utf8");
    return manifest;
  } finally {
    releaseLock(token);
  }
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  try {
    const result = compactQueue({
      apply: args.has("--apply"),
      force: args.has("--force"),
      skipIfBusy: args.has("--skip-if-busy"),
      triggerBytes: envNumber("MILES_QUEUE_COMPACT_TRIGGER_BYTES", 64 * MB),
      targetBytes: envNumber("MILES_QUEUE_COMPACT_TARGET_BYTES", 16 * MB),
      hardBytes: envNumber("MILES_QUEUE_COMPACT_HARD_BYTES", 64 * MB),
      recentTerminalLimit: envNumber("MILES_QUEUE_COMPACT_RECENT_TERMINAL", 100),
      lockTimeoutMs: envNumber("MILES_QUEUE_COMPACT_LOCK_TIMEOUT_MS", 15000)
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.ok !== true) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, status: error.code || "COMPACTION_FAILED", error: error.message }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = {
  compactQueue,
  selectActiveQueue,
  dependencyIds,
  isTerminal,
  acquireLock,
  releaseLock,
  paths: { ROOT, RUNTIME_DIR, QUEUE_PATH, LAST_GOOD_PATH, LOCK_PATH, HISTORY_DIR, MANIFEST_PATH }
};
