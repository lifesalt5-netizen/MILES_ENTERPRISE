'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const INTERVAL_MS = Math.max(30000, Number(process.env.MILES_CONTROL_OWNER_WATCHDOG_INTERVAL_MS || 60000));
const ENSURE_TIMEOUT_MS = Math.max(30000, Number(process.env.MILES_CONTROL_OWNER_WATCHDOG_ENSURE_TIMEOUT_MS || 120000));
const ENSURE_SCRIPT = path.join(ROOT, 'SCRIPTS', 'EnsureMilesControlOwnerWindows.ps1');
const RECOVERY_PROOF_SCRIPT = path.join(ROOT, 'SCRIPTS', 'RunMilesControlOwnerRecoveryProofWindows.ps1');
const RUNTIME_DIR = path.join(ROOT, 'DATA', 'runtime');
const LOCK_FILE = path.join(RUNTIME_DIR, 'control_owner_watchdog_process.lock.json');
const HEARTBEAT_FILE = path.join(RUNTIME_DIR, 'control_owner_watchdog_process_latest.json');
const RECOVERY_PROOF_REQUEST_FILE = path.join(RUNTIME_DIR, 'control_owner_recovery_proof_request.json');

let recoveryProofChild = null;
let recoveryProofId = null;

function isPidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try { process.kill(value, 0); return true; } catch { return false; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
  try {
    fs.renameSync(temporary, file);
  } catch {
    fs.copyFileSync(temporary, file);
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function acquireLock() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const existing = readJson(LOCK_FILE);
  if (existing?.pid && Number(existing.pid) !== process.pid && isPidAlive(existing.pid)) {
    return { ok: false, reason: 'WATCHDOG_ALREADY_RUNNING', existingPid: Number(existing.pid) };
  }
  writeJson(LOCK_FILE, {
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
    let timer = null;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ startedAt, finishedAt: new Date().toISOString(), ...result });
    };
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => finish({ code: -1, error: error.message, stdout, stderr }));
    child.once('close', code => finish({ code: Number(code), stdout, stderr }));
    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ code: -2, error: `ENSURE_TIMEOUT_${ENSURE_TIMEOUT_MS}MS`, stdout, stderr, timedOut: true });
    }, ENSURE_TIMEOUT_MS);
  });
}

function normalizeRecoveryProofRequest(value) {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'NO_REQUEST' };
  const proofId = String(value.proofId || '');
  const status = String(value.status || '').toUpperCase();
  const notBeforeMs = Date.parse(String(value.notBefore || ''));
  if (!/^[a-f0-9]{32}$/i.test(proofId)) return { ok: false, reason: 'INVALID_PROOF_ID' };
  if (!Number.isFinite(notBeforeMs)) return { ok: false, reason: 'INVALID_NOT_BEFORE', proofId, status };
  return { ok: true, proofId, status, notBeforeMs, request: value };
}

function updateRecoveryProofRequest(proofId, patch) {
  const current = readJson(RECOVERY_PROOF_REQUEST_FILE);
  if (!current || String(current.proofId || '') !== String(proofId || '')) return null;
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  writeJson(RECOVERY_PROOF_REQUEST_FILE, next);
  return next;
}

function launchRecoveryProof(request) {
  if (!request?.ok) return { status: request?.reason || 'NO_REQUEST' };
  if (['LAUNCHED', 'RUNNER_EXITED_GREEN', 'RUNNER_EXITED_RED', 'CANCELED'].includes(request.status)) {
    return {
      status: request.status,
      proofId: request.proofId,
      runnerPid: Number(request.request?.runnerPid || 0) || null
    };
  }
  if (request.status !== 'PENDING') return { status: `IGNORED_${request.status || 'UNKNOWN'}`, proofId: request.proofId };
  if (Date.now() < request.notBeforeMs) {
    return { status: 'PENDING_NOT_BEFORE', proofId: request.proofId, notBefore: new Date(request.notBeforeMs).toISOString() };
  }
  if (recoveryProofChild && recoveryProofChild.exitCode === null) {
    return { status: 'RUNNER_ALREADY_ACTIVE', proofId: recoveryProofId, runnerPid: recoveryProofChild.pid };
  }
  if (!fs.existsSync(RECOVERY_PROOF_SCRIPT)) {
    updateRecoveryProofRequest(request.proofId, { status: 'RUNNER_EXITED_RED', error: `RECOVERY_PROOF_SCRIPT_NOT_FOUND:${RECOVERY_PROOF_SCRIPT}` });
    return { status: 'RUNNER_EXITED_RED', proofId: request.proofId, error: 'RECOVERY_PROOF_SCRIPT_NOT_FOUND' };
  }

  const logFile = path.join(RUNTIME_DIR, `control_owner_recovery_proof_watchdog_${request.proofId}.log`);
  const logFd = fs.openSync(logFile, 'a');
  let child;
  try {
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', RECOVERY_PROOF_SCRIPT,
      '-Root', ROOT,
      '-ProofId', request.proofId,
      '-DelaySeconds', '10'
    ], {
      cwd: ROOT,
      shell: false,
      windowsHide: true,
      detached: false,
      stdio: ['ignore', logFd, logFd]
    });
  } finally {
    try { fs.closeSync(logFd); } catch {}
  }

  recoveryProofChild = child;
  recoveryProofId = request.proofId;
  updateRecoveryProofRequest(request.proofId, {
    status: 'LAUNCHED',
    launchedAt: new Date().toISOString(),
    runnerPid: child.pid,
    launchMode: 'INDEPENDENT_WATCHDOG_CHILD',
    logFile
  });

  child.once('error', error => {
    updateRecoveryProofRequest(request.proofId, {
      status: 'RUNNER_EXITED_RED',
      exitCode: -1,
      error: error.message,
      finishedAt: new Date().toISOString()
    });
  });
  child.once('close', code => {
    updateRecoveryProofRequest(request.proofId, {
      status: Number(code) === 0 ? 'RUNNER_EXITED_GREEN' : 'RUNNER_EXITED_RED',
      exitCode: Number(code),
      finishedAt: new Date().toISOString()
    });
    if (recoveryProofId === request.proofId) {
      recoveryProofChild = null;
      recoveryProofId = null;
    }
  });

  return { status: 'LAUNCHED', proofId: request.proofId, runnerPid: child.pid, logFile };
}

function maybeLaunchRecoveryProof() {
  return launchRecoveryProof(normalizeRecoveryProofRequest(readJson(RECOVERY_PROOF_REQUEST_FILE)));
}

function writeHeartbeat(lastEnsure, cycle, recoveryProof = null) {
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
    recoveryProof,
    safety: {
      fixedEnsureScriptOnly: true,
      fixedRecoveryProofScriptOnly: true,
      recoveryProofRunsInsideIndependentWatchdog: true,
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
  writeJson(HEARTBEAT_FILE, payload);
  return payload;
}

async function main() {
  if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
  if (!fs.existsSync(ENSURE_SCRIPT)) throw new Error(`ENSURE_SCRIPT_NOT_FOUND:${ENSURE_SCRIPT}`);
  if (!fs.existsSync(RECOVERY_PROOF_SCRIPT)) throw new Error(`RECOVERY_PROOF_SCRIPT_NOT_FOUND:${RECOVERY_PROOF_SCRIPT}`);

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
      const proofState = maybeLaunchRecoveryProof();
      writeHeartbeat(result, cycle, proofState);
    } catch (error) {
      writeHeartbeat({ code: -1, error: error.message, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }, cycle, { status: 'WATCHDOG_TICK_ERROR', error: error.message });
    } finally {
      running = false;
    }
  };

  await tick();
  setInterval(tick, INTERVAL_MS);
  console.log(`MILES_CONTROL_OWNER_WATCHDOG_PROCESS_STARTED pid=${process.pid} intervalMs=${INTERVAL_MS}`);
}

if (require.main === module) {
  main().catch(error => {
    try { writeHeartbeat({ code: -1, error: error.message, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }, 0, { status: 'WATCHDOG_START_ERROR', error: error.message }); } catch {}
    console.error(error.stack || error.message);
    process.exitCode = 2;
  });
}

module.exports = {
  ROOT,
  INTERVAL_MS,
  ENSURE_TIMEOUT_MS,
  ENSURE_SCRIPT,
  RECOVERY_PROOF_SCRIPT,
  LOCK_FILE,
  HEARTBEAT_FILE,
  RECOVERY_PROOF_REQUEST_FILE,
  isPidAlive,
  readJson,
  acquireLock,
  runEnsure,
  normalizeRecoveryProofRequest,
  launchRecoveryProof,
  maybeLaunchRecoveryProof,
  writeHeartbeat,
  main
};
