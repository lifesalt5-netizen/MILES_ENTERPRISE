'use strict';

const fs = require('fs');
const path = require('path');

class WorkerRegistry {
  constructor(options = {}) {
    this.service = 'WORKER_REGISTRY';
    this.name = this.service;
    this.version = '1.2.0';
    this.rootDir = options.rootDir || process.env.MILES_ROOT || process.cwd();
    this.runtimeDir = path.join(this.rootDir, 'runtime', 'worker_registry');
    this.stateFile = path.join(this.runtimeDir, 'worker_registry_state.json');
    this.registryFile = path.join(this.runtimeDir, 'registered_workers.json');
    this.logFile = path.join(this.rootDir, 'logs', 'worker_registry.log');
    this.workers = new Map();
    this.persistedWorkers = new Map();
    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      rootDir: this.rootDir,
      workersRegistered: 0,
      persistedWorkersDetected: 0,
      registrationConflicts: 0,
      lastRegisteredAt: null,
      lastUnregisteredAt: null,
      lastError: null,
      generatedAt: new Date().toISOString()
    };
    this.ensureDir(this.runtimeDir);
    this.ensureDir(path.dirname(this.logFile));
    this.loadFromDisk();
    this.saveState();
  }

  register(workerName, worker = {}) {
    const displayName = String(workerName || worker.name || worker.worker || '').trim();
    const key = this.normalizeName(displayName);
    if (!key) return { ok: false, service: this.service, status: 'WORKER_NAME_REQUIRED' };
    if (!this.isExecutable(worker)) {
      return { ok: false, service: this.service, status: 'WORKER_NOT_EXECUTABLE', worker: displayName };
    }
    const existing = this.workers.get(key);
    if (existing) {
      if (existing.worker === worker) {
        return { ok: true, service: this.service, status: 'WORKER_ALREADY_REGISTERED', worker: existing.name };
      }
      this.state.registrationConflicts += 1;
      this.state.ok = false;
      this.state.status = 'REGISTRATION_CONFLICT';
      this.state.lastError = `Worker name already registered: ${displayName}`;
      this.saveState();
      this.log('ERROR', this.state.lastError);
      return { ok: false, service: this.service, status: 'WORKER_REGISTRATION_CONFLICT', worker: displayName };
    }
    const record = { name: displayName, key, worker, registeredAt: new Date().toISOString(), status: 'REGISTERED' };
    this.workers.set(key, record);
    this.state.workersRegistered = this.workers.size;
    this.state.lastRegisteredAt = record.registeredAt;
    this.state.status = 'READY';
    this.state.ok = true;
    this.state.lastError = null;
    this.persist();
    this.log('INFO', `Registered worker: ${displayName}`);
    return { ok: true, service: this.service, status: 'WORKER_REGISTERED', worker: displayName };
  }

  unregister(workerName) {
    const key = this.normalizeName(workerName);
    if (!this.workers.has(key)) return { ok: true, service: this.service, status: 'WORKER_NOT_REGISTERED', worker: workerName };
    const record = this.workers.get(key);
    this.workers.delete(key);
    this.state.workersRegistered = this.workers.size;
    this.state.lastUnregisteredAt = new Date().toISOString();
    this.state.status = this.workers.size ? 'READY' : 'EMPTY';
    this.persist();
    this.log('INFO', `Unregistered worker: ${record.name}`);
    return { ok: true, service: this.service, status: 'WORKER_UNREGISTERED', worker: record.name };
  }

  get(workerName) { return this.getWorker(workerName); }
  getWorker(workerName) { const record = this.workers.get(this.normalizeName(workerName)); return record ? record.worker : null; }
  getWorkerRecord(workerName) { return this.workers.get(this.normalizeName(workerName)) || null; }
  has(workerName) { return this.hasWorker(workerName); }
  hasWorker(workerName) { return this.workers.has(this.normalizeName(workerName)); }
  list() { return this.listWorkers(); }
  listWorkers() {
    return Array.from(this.workers.values()).map((record) => ({
      name: record.name,
      status: record.status,
      registeredAt: record.registeredAt,
      hasExecute: typeof record.worker.execute === 'function',
      hasRun: typeof record.worker.run === 'function',
      hasHandle: typeof record.worker.handle === 'function',
      hasProcess: typeof record.worker.process === 'function',
      hasStart: typeof record.worker.start === 'function',
      hasStop: typeof record.worker.stop === 'function',
      hasHealthCheck: typeof record.worker.healthCheck === 'function'
    }));
  }

  clear() {
    this.workers.clear();
    this.state.workersRegistered = 0;
    this.state.status = 'EMPTY';
    this.persist();
    return { ok: true, service: this.service, status: 'REGISTRY_CLEARED' };
  }

  async start() { this.state.status = this.workers.size ? 'RUNNING' : 'EMPTY'; this.saveState(); return { ok: this.workers.size > 0, service: this.service, status: this.state.status, state: this.getState() }; }
  async stop() { this.state.status = 'STOPPED'; this.saveState(); return { ok: true, service: this.service, status: 'STOPPED', state: this.getState() }; }

  async healthCheck() {
    const workers = this.listWorkers();
    const invalidWorkers = workers.filter((worker) => !(worker.hasExecute || worker.hasRun || worker.hasHandle || worker.hasProcess));
    const ok = workers.length > 0 && invalidWorkers.length === 0 && this.state.status !== 'REGISTRATION_CONFLICT';
    return { ok, service: this.service, version: this.version, status: ok ? 'HEALTHY' : 'DEGRADED', workersRegistered: workers.length, persistedWorkersDetected: this.persistedWorkers.size, invalidWorkers: invalidWorkers.map((worker) => worker.name), workers, state: this.getState(), generatedAt: new Date().toISOString() };
  }

  getExecutiveSummary() { return { ok: this.workers.size > 0, service: this.service, status: 'WORKER_REGISTRY_SUMMARY_READY', workersRegistered: this.workers.size, persistedWorkersDetected: this.persistedWorkers.size, workers: this.listWorkers(), state: this.getState(), generatedAt: new Date().toISOString() }; }
  getState() { return { ...this.state, workersRegistered: this.workers.size, persistedWorkersDetected: this.persistedWorkers.size, generatedAt: new Date().toISOString() }; }
  normalizeName(value) { return String(value || '').trim().toLowerCase(); }
  isExecutable(worker) { return Boolean(worker && ['execute', 'run', 'handle', 'process'].some((method) => typeof worker[method] === 'function')); }

  loadFromDisk() {
    try {
      if (!fs.existsSync(this.registryFile)) return;
      const data = JSON.parse(fs.readFileSync(this.registryFile, 'utf8'));
      for (const worker of Array.isArray(data.workers) ? data.workers : []) {
        if (!worker || !worker.name) continue;
        this.persistedWorkers.set(this.normalizeName(worker.name), { ...worker, status: 'AWAITING_LIVE_REGISTRATION' });
      }
      this.state.persistedWorkersDetected = this.persistedWorkers.size;
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'LOAD_FAILED';
      this.state.lastError = error.message;
      this.log('ERROR', error.message);
    }
  }

  persist() {
    const workers = Array.from(this.workers.values()).map((record) => ({ name: record.name, status: record.status, registeredAt: record.registeredAt, metadata: { service: record.worker.service || record.worker.name || record.name, version: record.worker.version || null } }));
    this.writeJson(this.registryFile, { generatedAt: new Date().toISOString(), source: this.service, workers });
    this.saveState();
  }
  saveState() { this.writeJson(this.stateFile, this.getState()); }
  writeJson(filePath, data) { this.ensureDir(path.dirname(filePath)); const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8'); fs.renameSync(temporary, filePath); }
  ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
  log(level, message) { fs.appendFileSync(this.logFile, `${JSON.stringify({ timestamp: new Date().toISOString(), level, service: this.service, message })}\n`, 'utf8'); }
}

module.exports = WorkerRegistry;
module.exports.WorkerRegistry = WorkerRegistry;
module.exports.default = WorkerRegistry;
