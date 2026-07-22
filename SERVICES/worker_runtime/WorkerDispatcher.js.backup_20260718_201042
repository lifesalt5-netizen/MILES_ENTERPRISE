'use strict';

const fs = require('fs');
const path = require('path');

class WorkerDispatcher {
  constructor(options = {}) {
    this.service = 'WORKER_DISPATCHER';
    this.name = this.service;
    this.version = '1.1.0';
    this.rootDir = options.rootDir || process.env.MILES_ROOT || process.cwd();

    this.registry = options.registry || null;

    this.runtimeDir = path.join(this.rootDir, 'runtime', 'worker_dispatcher');
    this.dispatchLogFile = path.join(this.runtimeDir, 'dispatch_log.jsonl');
    this.stateFile = path.join(this.runtimeDir, 'worker_dispatcher_state.json');
    this.logFile = path.join(this.rootDir, 'logs', 'worker_dispatcher.log');

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      rootDir: this.rootDir,
      dispatchesAttempted: 0,
      dispatchesCompleted: 0,
      dispatchesFailed: 0,
      lastDispatchAt: null,
      lastWorker: null,
      lastOperation: null,
      lastError: null,
      generatedAt: new Date().toISOString()
    };

    this.ensureDir(this.runtimeDir);
    this.ensureDir(path.dirname(this.logFile));
    this.saveState();
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

  async dispatch(operation = {}) {
    return await this.dispatchOperation(operation);
  }

  async dispatchOperation(operation = {}) {
    const workerName = operation.worker || operation.workerName || operation.assignedWorker || operation.area || null;

    this.state.dispatchesAttempted += 1;
    this.state.lastDispatchAt = new Date().toISOString();
    this.state.lastWorker = workerName;
    this.state.lastOperation = operation;

    if (!workerName) {
      return this.recordFailure(operation, workerName, 'WORKER_REQUIRED');
    }

    const worker = this.resolveWorker(workerName);

    if (!worker) {
      return this.recordFailure(operation, workerName, 'WORKER_NOT_FOUND');
    }

    try {
      let result;

      if (typeof worker.execute === 'function') {
        result = await worker.execute(operation);
      } else if (typeof worker.run === 'function') {
        result = await worker.run(operation);
      } else if (typeof worker.handle === 'function') {
        result = await worker.handle(operation);
      } else if (typeof worker.process === 'function') {
        result = await worker.process(operation);
      } else {
        return this.recordFailure(operation, workerName, 'WORKER_HAS_NO_EXECUTION_METHOD');
      }

      this.state.dispatchesCompleted += 1;
      this.state.status = 'RUNNING';
      this.state.lastError = null;

      const dispatchRecord = {
        ok: result && result.ok === false ? false : true,
        service: this.service,
        status: 'DISPATCH_COMPLETED',
        worker: workerName,
        operation,
        result,
        generatedAt: new Date().toISOString()
      };

      this.appendDispatchLog(dispatchRecord);
      this.saveState();

      return dispatchRecord;
    } catch (error) {
      return this.recordFailure(operation, workerName, error.message);
    }
  }

  resolveWorker(workerName) {
    if (!this.registry) return null;

    if (typeof this.registry.getWorker === 'function') {
      return this.registry.getWorker(workerName);
    }

    if (typeof this.registry.get === 'function') {
      return this.registry.get(workerName);
    }

    if (this.registry.workers && typeof this.registry.workers.get === 'function') {
      const record = this.registry.workers.get(workerName);
      return record && record.worker ? record.worker : record;
    }

    return null;
  }

  recordFailure(operation, workerName, reason) {
    this.state.dispatchesFailed += 1;
    this.state.status = 'DEGRADED';
    this.state.lastError = reason;

    const failure = {
      ok: false,
      service: this.service,
      status: 'DISPATCH_FAILED',
      worker: workerName,
      reason,
      operation,
      generatedAt: new Date().toISOString()
    };

    this.appendDispatchLog(failure);
    this.saveState();
    this.log('ERROR', `${workerName || 'unknown'} dispatch failed: ${reason}`);

    return failure;
  }

  async healthCheck() {
    return {
      ok: this.state.ok,
      service: this.service,
      version: this.version,
      status: this.state.ok ? 'HEALTHY' : 'DEGRADED',
      registryAvailable: Boolean(this.registry),
      state: this.getState(),
      generatedAt: new Date().toISOString()
    };
  }

  getExecutiveSummary() {
    return {
      ok: true,
      service: this.service,
      status: 'WORKER_DISPATCHER_SUMMARY_READY',
      dispatchesAttempted: this.state.dispatchesAttempted,
      dispatchesCompleted: this.state.dispatchesCompleted,
      dispatchesFailed: this.state.dispatchesFailed,
      lastDispatchAt: this.state.lastDispatchAt,
      lastWorker: this.state.lastWorker,
      state: this.getState(),
      generatedAt: new Date().toISOString()
    };
  }

  getState() {
    return {
      ...this.state,
      generatedAt: new Date().toISOString()
    };
  }

  appendDispatchLog(record) {
    this.ensureDir(path.dirname(this.dispatchLogFile));
    fs.appendFileSync(this.dispatchLogFile, `${JSON.stringify(record)}\n`, 'utf8');
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

module.exports = WorkerDispatcher;
module.exports.WorkerDispatcher = WorkerDispatcher;
module.exports.default = WorkerDispatcher;