"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const { execFileSync } = require("child_process");
const { runPm2, parsePm2Jlist } = require("./ReconcilePm2Process");
const { run: reconcileSurfaces } = require("./ReconcileMilesProductionSurfaces");

const ROOT = process.env.MILES_ROOT || process.cwd();
const DATA = path.join(ROOT, "DATA");
const RUNTIME = path.join(DATA, "runtime");
const REPORT_DIR = path.join(DATA, "runtime_guardian");
const REPAIR = process.argv.includes("--repair");
const EXPECTED_APPS = [
  "miles-api",
  "miles-worker",
  "miles-command-center",
  "miles-executive-dashboard",
  "miles-desktop-ui",
  "miles-autonomous-coo"
];
const MEMORY_WARN_MB = Number(process.env.MILES_WORKER_MEMORY_WARN_MB || 1024);
const MEMORY_FAIL_MB = Number(process.env.MILES_WORKER_MEMORY_FAIL_MB || 3072);

function now() { return new Date().toISOString(); }
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function safeJsonParse(text, fallback) { try { return JSON.parse(text); } catch { return fallback; } }
function ps(script) {
  return execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
}
function pm2List() {
  return parsePm2Jlist(runPm2(["jlist"]).stdout);
}
function portOpen(port, timeout = 2500) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let done = false;
    const finish = value => { if (done) return; done = true; socket.destroy(); resolve(value); };
    socket.setTimeout(timeout);
    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}
function processAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; } catch (e) { return e && e.code === "EPERM"; }
}
function readLockOwner() {
  const ownerFile = path.join(RUNTIME, "task_queue.lock", "owner.json");
  try { return JSON.parse(fs.readFileSync(ownerFile, "utf8")); } catch { return null; }
}
function reclaimStaleLock() {
  const lockDir = path.join(RUNTIME, "task_queue.lock");
  if (!fs.existsSync(lockDir)) return { present: false, reclaimed: false };
  const owner = readLockOwner();
  if (owner && processAlive(owner.pid)) return { present: true, reclaimed: false, reason: "owner_alive", ownerPid: owner.pid };
  fs.rmSync(lockDir, { recursive: true, force: true });
  return { present: true, reclaimed: true, ownerPid: owner && owner.pid };
}
function archiveRuntimeJunk() {
  ensureDir(RUNTIME);
  const archiveDir = path.join(RUNTIME, "ARCHIVE", new Date().toISOString().slice(0, 10).replace(/-/g, ""));
  ensureDir(archiveDir);
  const keep = new Set(["task_queue.json", "task_queue.last_good.json", "work_queue.json", "execution_history.jsonl", "latest_deals.json"]);
  const cutoff = Date.now() - Number(process.env.MILES_RUNTIME_JUNK_MIN_AGE_MS || 3600000);
  const moved = [];
  for (const entry of fs.readdirSync(RUNTIME, { withFileTypes: true })) {
    if (!entry.isFile() || keep.has(entry.name)) continue;
    const isTemp = /\.tmp_/i.test(entry.name);
    const isHistorical = /(before_|before-|\.before_|backup|corrupt)/i.test(entry.name);
    if (!isTemp && !isHistorical) continue;
    const src = path.join(RUNTIME, entry.name);
    const stat = fs.statSync(src);
    if (stat.mtimeMs > cutoff) continue;
    const dst = path.join(archiveDir, entry.name);
    try { fs.renameSync(src, dst); }
    catch { fs.copyFileSync(src, dst); fs.rmSync(src, { force: true }); }
    moved.push(entry.name);
  }
  return { archiveDir, movedCount: moved.length, moved };
}
function rotatePm2Logs() {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return { rotated: [] };
  const dir = path.join(home, ".pm2", "logs");
  if (!fs.existsSync(dir)) return { rotated: [] };
  const limit = Number(process.env.MILES_PM2_LOG_ROTATE_MB || 20) * 1024 * 1024;
  const rotated = [];
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (!stat.isFile() || stat.size < limit) continue;
    const archived = `${file}.${stamp}.archive`;
    fs.renameSync(file, archived);
    fs.writeFileSync(file, "", "utf8");
    rotated.push({ name, bytes: stat.size, archived });
  }
  return { rotated };
}
function killForkChildren() {
  const out = ps(`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*ProcessContainerFork*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $_.ProcessId } catch {} }`);
  return out.trim().split(/\r?\n/).filter(Boolean).map(Number).filter(Number.isFinite);
}
function systemMemory() {
  try {
    const out = ps(`$o=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{TotalGB=[math]::Round($o.TotalVisibleMemorySize/1MB,2);FreeGB=[math]::Round($o.FreePhysicalMemory/1MB,2);UsedGB=[math]::Round(($o.TotalVisibleMemorySize-$o.FreePhysicalMemory)/1MB,2)} | ConvertTo-Json -Compress`);
    return safeJsonParse(out.trim(), null);
  } catch { return null; }
}
function appSnapshot() {
  return pm2List().map(p => ({
    name: p.name,
    pid: p.pid,
    status: p.pm2_env && p.pm2_env.status,
    restarts: p.pm2_env && p.pm2_env.restart_time,
    memoryMB: Math.round(((p.monit && p.monit.memory) || 0) / 1024 / 1024),
    cpu: (p.monit && p.monit.cpu) || 0,
    script: p.pm2_env && p.pm2_env.pm_exec_path
  }));
}
async function verify() {
  const apps = appSnapshot();
  const byName = new Map(apps.map(a => [a.name, a]));
  const missing = EXPECTED_APPS.filter(n => !byName.has(n));
  const offline = EXPECTED_APPS.filter(n => byName.has(n) && byName.get(n).status !== "online");
  const worker = byName.get("miles-worker") || null;
  const ports = {
    api3000: await portOpen(3000),
    desktop3737: await portOpen(3737),
    dashboard8737: await portOpen(8737),
    command8787: await portOpen(8787)
  };
  const lockOwner = readLockOwner();
  const memory = systemMemory();
  const warnings = [];
  const failures = [];
  if (missing.length) failures.push(`missing apps: ${missing.join(", ")}`);
  if (offline.length) failures.push(`offline apps: ${offline.join(", ")}`);
  if (!ports.api3000) failures.push("port 3000 unavailable");
  if (!ports.desktop3737) failures.push("port 3737 unavailable");
  if (!ports.dashboard8737) failures.push("port 8737 unavailable");
  if (!ports.command8787) failures.push("port 8787 unavailable");
  if (worker && worker.memoryMB >= MEMORY_FAIL_MB) failures.push(`worker memory critical ${worker.memoryMB} MB`);
  else if (worker && worker.memoryMB > MEMORY_WARN_MB) warnings.push(`worker memory above lean target ${worker.memoryMB} MB`);
  if (lockOwner && !processAlive(lockOwner.pid)) warnings.push(`stale task queue lock owned by dead pid ${lockOwner.pid}`);
  return { ok: failures.length === 0, checkedAt: now(), apps, ports, lockOwner, memory, warnings, failures };
}
async function main() {
  ensureDir(REPORT_DIR);
  const report = { service: "MILES_PRODUCTION_GUARDIAN", startedAt: now(), mode: REPAIR ? "REPAIR" : "VERIFY", expectedApps: EXPECTED_APPS, actions: [] };
  if (REPAIR) {
    try {
      report.actions.push({ action: "kill_orphan_pm2_forks", ok: true, pids: killForkChildren() });
    } catch (e) {
      report.actions.push({ action: "kill_orphan_pm2_forks", ok: false, error: e.message });
    }
    report.actions.push({ action: "reclaim_stale_taskqueue_lock", ok: true, result: reclaimStaleLock() });
    report.actions.push({ action: "archive_runtime_junk", ok: true, result: archiveRuntimeJunk() });
    report.actions.push({ action: "rotate_pm2_logs", ok: true, result: rotatePm2Logs() });
    try {
      const results = reconcileSurfaces(EXPECTED_APPS);
      report.actions.push({ action: "reconcile_canonical_pm2_surfaces", ok: true, surfaces: results.map(x => ({ name:x.name, pid:x.pid, status:x.status, script:x.script })) });
    } catch (e) {
      report.actions.push({ action: "reconcile_canonical_pm2_surfaces", ok: false, error: e.stack || e.message });
    }
    sleep(Number(process.env.MILES_GUARDIAN_STARTUP_WAIT_MS || 8000));
  }
  report.verification = await verify();
  report.finishedAt = now();
  report.ok = report.verification.ok;
  const stamp = report.finishedAt.replace(/[-:TZ.]/g, "").slice(0, 14);
  const file = path.join(REPORT_DIR, `guardian_${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  console.log("=== MILES PRODUCTION GUARDIAN ===");
  console.log("mode   :", report.mode);
  console.log("result :", report.ok ? "PASS" : "FAIL");
  console.log("report :", file);
  for (const app of report.verification.apps) console.log(`${String(app.name).padEnd(28)} status=${app.status} pid=${app.pid} ramMB=${app.memoryMB} restarts=${app.restarts}`);
  console.log("port3000:", report.verification.ports.api3000);
  console.log("port3737:", report.verification.ports.desktop3737);
  console.log("port8737:", report.verification.ports.dashboard8737);
  console.log("port8787:", report.verification.ports.command8787);
  if (report.verification.warnings.length) console.log("warnings:", report.verification.warnings.join(" | "));
  if (report.verification.failures.length) console.log("failures:", report.verification.failures.join(" | "));
  process.exitCode = report.ok ? 0 : 1;
}
main().catch(err => { console.error(err.stack || err.message); process.exitCode = 1; });
