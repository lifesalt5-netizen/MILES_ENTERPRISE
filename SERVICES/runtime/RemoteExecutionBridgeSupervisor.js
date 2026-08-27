'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class RemoteExecutionBridgeSupervisor {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.bridgeFile = path.join(this.root, 'StartMilesRemoteExecutionBridge.js');
    this.runtimeDir = path.join(this.root, 'DATA', 'runtime');
    this.lockFile = path.join(this.runtimeDir, 'remote_execution_bridge_supervisor.lock');
    this.stateFile = path.join(this.runtimeDir, 'remote_execution_bridge_supervisor.json');
    this.spawnFn = options.spawnFn || spawn;
    this.restartDelayMs = Math.max(500, Number(options.restartDelayMs || process.env.MILES_BRIDGE_RESTART_DELAY_MS || 3000));
    this.child = null;
    this.running = false;
    this.ownsLock = false;
    this.restartTimer = null;
    this.restartCount = 0;
  }

  isPidAlive(pid) {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 0) return false;
    try { process.kill(n, 0); return true; }
    catch { return false; }
  }

  readLock() {
    try { return JSON.parse(fs.readFileSync(this.lockFile, 'utf8')); }
    catch { return null; }
  }

  writeState(extra = {}) {
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    const state = {
      supervisorPid: process.pid,
      childPid: this.child?.pid || null,
      running: this.running,
      ownsLock: this.ownsLock,
      restartCount: this.restartCount,
      bridgeFile: this.bridgeFile,
      observedAt: new Date().toISOString(),
      ...extra
    };
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf8');
    return state;
  }

  acquireLock() {
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    const existing = this.readLock();
    if (existing?.pid && this.isPidAlive(existing.pid) && existing.pid !== process.pid) {
      return { ok: false, status: 'SUPERVISOR_ALREADY_OWNED', ownerPid: existing.pid };
    }
    if (existing && (!existing.pid || !this.isPidAlive(existing.pid))) {
      try { fs.unlinkSync(this.lockFile); } catch {}
    }
    try {
      const fd = fs.openSync(this.lockFile, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
      fs.closeSync(fd);
      this.ownsLock = true;
      return { ok: true, status: 'LOCK_ACQUIRED', ownerPid: process.pid };
    } catch (error) {
      const retry = this.readLock();
      return { ok: false, status: 'SUPERVISOR_LOCK_BUSY', ownerPid: retry?.pid || null, error: error.message };
    }
  }

  releaseLock() {
    if (!this.ownsLock) return;
    const current = this.readLock();
    if (!current || current.pid === process.pid) {
      try { fs.unlinkSync(this.lockFile); } catch {}
    }
    this.ownsLock = false;
  }

  spawnBridge() {
    if (!this.running || !this.ownsLock) return null;
    if (!fs.existsSync(this.bridgeFile)) throw new Error(`REMOTE_BRIDGE_FILE_MISSING:${this.bridgeFile}`);
    const child = this.spawnFn(process.execPath, [this.bridgeFile], {
      cwd: this.root,
      env: { ...process.env, MILES_BRIDGE_SUPERVISED: 'true' },
      shell: false,
      windowsHide: true,
      stdio: 'inherit'
    });
    this.child = child;
    this.writeState({ status: 'BRIDGE_STARTING' });
    child.once('spawn', () => this.writeState({ status: 'BRIDGE_RUNNING' }));
    child.once('error', error => this.writeState({ status: 'BRIDGE_SPAWN_ERROR', error: error.message }));
    child.once('exit', (code, signal) => {
      this.child = null;
      this.writeState({ status: 'BRIDGE_EXITED', exitCode: code, signal: signal || null });
      if (!this.running || !this.ownsLock) return;
      this.restartCount += 1;
      this.writeState({ status: 'BRIDGE_RESTART_SCHEDULED', exitCode: code, signal: signal || null });
      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        try { this.spawnBridge(); }
        catch (error) { this.writeState({ status: 'BRIDGE_RESTART_FAILED', error: error.message }); }
      }, this.restartDelayMs);
      this.restartTimer.unref?.();
    });
    return child;
  }

  start() {
    if (this.running) return { ok: true, status: 'ALREADY_RUNNING', childPid: this.child?.pid || null };
    const lock = this.acquireLock();
    if (!lock.ok) {
      this.writeState({ status: lock.status, externalOwnerPid: lock.ownerPid || null });
      return { ok: true, status: lock.status, externalOwnerPid: lock.ownerPid || null };
    }
    this.running = true;
    try {
      const child = this.spawnBridge();
      return { ok: true, status: 'SUPERVISION_STARTED', supervisorPid: process.pid, childPid: child?.pid || null };
    } catch (error) {
      this.running = false;
      this.releaseLock();
      this.writeState({ status: 'SUPERVISION_START_FAILED', error: error.message });
      return { ok: false, status: 'SUPERVISION_START_FAILED', error: error.message };
    }
  }

  stop() {
    this.running = false;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.child && this.child.exitCode === null) {
      try { this.child.kill(); } catch {}
    }
    this.child = null;
    this.releaseLock();
    this.writeState({ status: 'SUPERVISION_STOPPED' });
    return { ok: true, status: 'SUPERVISION_STOPPED' };
  }

  status() {
    return this.writeState({ status: this.running ? (this.child ? 'BRIDGE_RUNNING' : 'BRIDGE_RECOVERING') : 'STOPPED' });
  }
}

module.exports = RemoteExecutionBridgeSupervisor;
