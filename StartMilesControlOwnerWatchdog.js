'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const INTERVAL_MS = Math.max(30000, Number(process.env.MILES_CONTROL_OWNER_WATCHDOG_INTERVAL_MS || 60000));
const ENSURE_TIMEOUT_MS = Math.max(30000, Number(process.env.MILES_CONTROL_OWNER_WATCHDOG_ENSURE_TIMEOUT_MS || 120000));
const ENSURE_SCRIPT = path.join(ROOT, 'SCRIPTS', 'EnsureMilesControlOwnerWindows.ps1');
const RUNTIME_DIR = path.join(ROOT, 'DATA', 'runtime');
const LOCK_FILE = path.join(RUNTIME_DIR, 'control_owner_watchdog_process.lock.json');
const HEARTBEAT_FILE = path.join(RUNTIME_DIR, 'control_owner_watchdog_process_latest.json');

function isPidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try { process.kill(value, 0); return true; } catch { return false; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function acquireLock() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const existing = readJson(LOCK_FILE);
  if (existing?.pid && Number(existing.pid) !== process.pid && isPidAlive(existing.pid)) {
    return { ok: false, reason: 'WATCHDOG_ALREADY_RUNNING', existingPid: Number(existing.pid) };
  }
  writeJsonAtomic(LOCK_FILE, {
    pid: process.pid,
    root: ROOT,
    script: __filename,
    startedAt: new Date().toISOString()
  });
  return { ok: true };
}

function releaseLock() {
  try {
    const current = readJson(LOCK_FILE);
    if (Number(current?.pid) === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch {}
}

function runEnsure() {
  return new Promise(resolve => {
    const startedAt = new Date().toISOString();
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', ENSURE_SCRIPT,
      '-Root', ROOT
    ], {
      cwd: ROOT,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ startedAt, finishedAt: new Date().toISOString(), ...result });
    };
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => finish({ code: -1, error: error.message, stdout, stderr }));
    child.once('close', code => finish({ code: Number(code), stdout, stderr }));
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ code: -2, error: `ENSURE_TIMEOUT_${ENSURE_TIMEOUT_MS}MS`, stdout, stderr, timedOut: true });
    }, ENSURE_TIMEOUT_MS);
    timer.unref?.();
  });
}

async function writeHeartbeat(lastEnsure, cycle) {
  const payload = {
    ok: lastEnsure?.code === 0,
    status: lastEnsure?.code === 0 ? 'CONTROL_OWNER_WATCHDOG_PROCESS_GREEN' : 'CONTROL_OWNER_WATCHDOG_PROCESS_WATCH',
    mode: 'USER_STARTUP_INDEPENDENT_PROCESS',
    pid: process.pid,
    root: ROOT,
    script: __filename,
    intervalMs: INTERVAL_MS,
    cycle,
    observedAt: new Date().toISOString(),
    lastEnsure: lastEnsure ? {
      code: lastEnsure.code,
      startedAt: lastEnsure.startedAt,
      finishedAt: lastEnsure.finishedAt,
      timedOut: Boolean(lastEnsure.timedOut),
      error: lastEnsure.error || null,
      stdoutTail: String(lastEnsure.stdout || '').slice(-2000),
      stderrTail: String(lastEnsure.stderr || '').slice(-2000)
    } : null,
    safety: {
      fixedEnsureScriptOnly: true,
      arbitraryShell: false,
      gitMutation: false,
      destructiveGitRecovery: false,
      providerMutation: false,
      sendsProspects: false,
      deletesEmail: false,
      changesDns: false,
      publishesB12: false
    }
  };
  writeJsonAtomic(HEARTBEAT_FILE, payload);
  return payload;
}

async function main() {
  if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
  if (!fs.existsSync(ENSURE_SCRIPT)) throw new Error(`ENSURE_SCRIPT_NOT_FOUND:${ENSURE_SCRIPT}`);

  const lock = acquireLock();
  if (!lock.ok) {
    console.log(`MILES_CONTROL_OWNER_WATCHDOG_ALREADY_RUNNING pid=${lock.existingPid}`);
    return;
  }

  process.once('exit', releaseLock);
  process.once('SIGINT', () => { releaseLock(); process.exit(0); });
  process.once('SIGTERM', () => { releaseLock(); process.exit(0); });

  let cycle = 0;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    cycle += 1;
    try {
      const result = await runEnsure();
      await writeHeartbeat(result, cycle);
    } catch (error) {
      await writeHeartbeat({ code: -1, error: error.message, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }, cycle);
    } finally {
      running = false;
    }
  };

  await tick();
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
  console.log(`MILES_CONTROL_OWNER_WATCHDOG_PROCESS_STARTED pid=${process.pid} intervalMs=${INTERVAL_MS}`);
  await new Promise(() => {});
}

if (require.main === module) {
  main().catch(error => {
    try { writeHeartbeat({ code: -1, error: error.message, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }, 0); } catch {}
    console.error(error.stack || error.message);
    process.exitCode = 2;
  });
}

module.exports = { ROOT, INTERVAL_MS, ENSURE_TIMEOUT_MS, ENSURE_SCRIPT, LOCK_FILE, HEARTBEAT_FILE, isPidAlive, readJson, acquireLock, runEnsure, writeHeartbeat, main };
