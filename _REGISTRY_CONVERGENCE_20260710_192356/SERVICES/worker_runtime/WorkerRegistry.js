'use strict';

const fs = require('fs');
const path = require('path');

class WorkerRegistry {
  constructor(options = {}) {
    this.service = 'WORKER_REGISTRY';
    this.name = this.service;
    this.version = '1.1.0';
    this.rootDir = options.rootDir || process.env.MILES_ROOT || process.cwd();

    this.runtimeDir = path.join(this.rootDir, 'runtime', 'worker_registry');
    this.stateFile = path.join(this.runtimeDir, 'worker_registry_state.json');
    this.registryFile = path.join(this.runtimeDir, 'registered_workers.json');
    this.logFile = path.join(this.rootDir, 'logs', 'worker_registry.log');

    this.workers = new Map();

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      rootDir: this.rootDir,
      workersRegistered: 0,
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

  register(workerName, workerOrDefinition = {}) {
    const name = this.normalizeName(workerName || workerOrDefinition.name || workerOrDefinition.worker);

    if (!name) {
      return {
        ok: false,
        service: this.service,
        status: 'WORKER_NAME_REQUIRED'
      };
    }

    const record = {
      name,
      worker: workerOrDefinition,
      registeredAt: new Date().toISOString(),
      status: 'REGISTERED'
    };

    this.workers.set(name, record);

    this.state.workersRegistered = this.workers.size;
    this.state.lastRegisteredAt = record.registeredAt;
    this.state.status = 'READY';
    this.state.lastError = null;

    this.persist();
    this.log('INFO', `Registered worker: ${name}`);

    return {
      ok: true,
      service: this.service,
      status: 'WORKER_REGISTERED',
      worker: name
    };
  }

  unregister(workerName) {
    const name = this.normalizeName(workerName);

    if (!this.workers.has(name)) {
      return {
        ok: true,
        service: this.service,
        status: 'WORKER_NOT_REGISTERED',
        worker: name
      };
    }

    this.workers.delete(name);

    this.state.workersRegistered = this.workers.size;
    this.state.lastUnregisteredAt = new Date().toISOString();

    this.persist();
    this.log('INFO', `Unregistered worker: ${name}`);

    return {
      ok: true,
      service: this.service,
      status: 'WORKER_UNREGISTERED',
      worker: name
    };
  }

  get(workerName) {
    return this.getWorker(workerName);
  }

  getWorker(workerName) {
    const name = this.normalizeName(workerName);
    const record = this.workers.get(name);

    if (!record) return null;

    return record.worker;
  }

  getWorkerRecord(workerName) {
    const name = this.normalizeName(workerName);
    return this.workers.get(name) || null;
  }

  has(workerName) {
    return this.hasWorker(workerName);
  }

  hasWorker(workerName) {
    return this.workers.has(this.normalizeName(workerName));
  }

  list() {
    return this.listWorkers();
  }

  listWorkers() {
    return Array.from(this.workers.values()).map((record) => ({
      name: record.name,
      status: record.status,
      registeredAt: record.registeredAt,
      hasExecute: Boolean(record.worker && typeof record.worker.execute === 'function'),
      hasRun: Boolean(record.worker && typeof record.worker.run === 'function'),
      hasStart: Boolean(record.worker && typeof record.worker.start === 'function'),
      hasStop: Boolean(record.worker && typeof record.worker.stop === 'function'),
      hasHealthCheck: Boolean(record.worker && typeof record.worker.healthCheck === 'function')
    }));
  }

  clear() {
    this.workers.clear();
    this.state.workersRegistered = 0;
    this.persist();

    return {
      ok: true,
      service: this.service,
      status: 'REGISTRY_CLEARED'
    };
  }

  async start() {
    this.state.status = 'RUNNING';
    this.state.lastError = null;
    this.saveState();

    return {
      ok: true,
      service: this.service,
      status: 'STARTED',
      state: this.getState()
    };
  }

  async stop() {
    this.state.status = 'STOPPED';
    this.saveState();

    return {
      ok: true,
      service: this.service,
      status: 'STOPPED',
      state: this.getState()
    };
  }

  async healthCheck() {
    return {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'HEALTHY',
      workersRegistered: this.workers.size,
      workers: this.listWorkers(),
      state: this.getState(),
      generatedAt: new Date().toISOString()
    };
  }

  getExecutiveSummary() {
    return {
      ok: true,
      service: this.service,
      status: 'WORKER_REGISTRY_SUMMARY_READY',
      workersRegistered: this.workers.size,
      workers: this.listWorkers(),
      state: this.getState(),
      generatedAt: new Date().toISOString()
    };
  }

  getState() {
    return {
      ...this.state,
      workersRegistered: this.workers.size,
      generatedAt: new Date().toISOString()
    };
  }

  normalizeName(value) {
    return String(value || '').trim();
  }

  loadFromDisk() {
    try {
      if (!fs.existsSync(this.registryFile)) return;

      const data = JSON.parse(fs.readFileSync(this.registryFile, 'utf8'));
      const workers = Array.isArray(data.workers) ? data.workers : [];

      for (const worker of workers) {
        if (!worker || !worker.name) continue;

        this.workers.set(worker.name, {
          name: worker.name,
          worker,
          registeredAt: worker.registeredAt || new Date().toISOString(),
          status: worker.status || 'REGISTERED'
        });
      }

      this.state.workersRegistered = this.workers.size;
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'LOAD_FAILED';
      this.state.lastError = error.message;
      this.log('ERROR', error.message);
    }
  }

  persist() {
    const workers = Array.from(this.workers.values()).map((record) => ({
      name: record.name,
      status: record.status,
      registeredAt: record.registeredAt,
      metadata:
        record.worker && typeof record.worker === 'object'
          ? {
              service: record.worker.service || record.worker.name || record.name,
              version: record.worker.version || null
            }
          : {}
    }));

    this.writeJson(this.registryFile, {
      generatedAt: new Date().toISOString(),
      source: this.service,
      workers
    });

    this.saveState();
  }

  saveState() {
    this.writeJson(this.stateFile, this.getState());
  }

  writeJson(filePath, data) {
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
  }

  log(level, message) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message
    };

    fs.appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

module.exports = WorkerRegistry;
module.exports.WorkerRegistry = WorkerRegistry;
module.exports.default = WorkerRegistry;