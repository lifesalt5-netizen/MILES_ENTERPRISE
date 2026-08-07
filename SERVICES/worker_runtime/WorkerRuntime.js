'use strict';

const path = require('path');
const WorkerRegistry = require('./WorkerRegistry');
const WorkerDispatcher = require('./WorkerDispatcher');

class WorkerRuntime {
  constructor(options = {}) {
    this.service = 'WORKER_RUNTIME';
    this.version = '1.2.0';
    this.rootDir = options.rootDir || process.env.MILES_ROOT || process.cwd();
    this.workerDir = options.workerDir || path.join(this.rootDir, 'workers');
    this.maxConcurrentWorkers = Math.max(1, Number(options.maxConcurrentWorkers || 1));
    this.registry = options.registry || new WorkerRegistry({ rootDir: this.rootDir });
    this.dispatcher = options.dispatcher || new WorkerDispatcher({ rootDir: this.rootDir, registry: this.registry });
    this.running = false;
    this.activeExecutions = 0;
    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      startedAt: null,
      stoppedAt: null,
      executionsAttempted: 0,
      executionsCompleted: 0,
      executionsFailed: 0,
      lastExecutionAt: null,
      lastError: null
    };
  }

  async start() {
    if (this.running) return { ok: true, service: this.service, status: 'ALREADY_RUNNING', state: this.getState() };
    const registryHealth = await this.registry.healthCheck();
    if (!registryHealth.ok) {
      this.state.ok = false;
      this.state.status = 'START_FAILED';
      this.state.lastError = 'No executable workers are registered.';
      return { ok: false, service: this.service, status: 'START_FAILED', error: this.state.lastError, registry: registryHealth, state: this.getState() };
    }
    if (typeof this.dispatcher.start === 'function') {
      const dispatchStart = await this.dispatcher.start();
      if (dispatchStart && dispatchStart.ok === false) return { ok: false, service: this.service, status: 'START_FAILED', dispatcher: dispatchStart, state: this.getState() };
    }
    this.running = true;
    this.state.ok = true;
    this.state.status = 'RUNNING';
    this.state.startedAt = new Date().toISOString();
    this.state.stoppedAt = null;
    this.state.lastError = null;
    return { ok: true, service: this.service, status: 'STARTED', state: this.getState() };
  }

  async stop() {
    if (typeof this.dispatcher.stop === 'function') await this.dispatcher.stop();
    this.running = false;
    this.state.status = 'STOPPED';
    this.state.stoppedAt = new Date().toISOString();
    return { ok: true, service: this.service, status: 'STOPPED', state: this.getState() };
  }

  async discoverWorkers() {
    const workers = this.registry.listWorkers();
    return { ok: workers.length > 0, service: this.service, status: workers.length ? 'WORKERS_DISCOVERED' : 'NO_LIVE_WORKERS', workers, workerDir: this.workerDir };
  }

  async executeWorker(operation = {}) {
    if (!this.running) return this.failure('RUNTIME_NOT_RUNNING', 'Worker runtime is not running.', operation);
    if (this.activeExecutions >= this.maxConcurrentWorkers) return this.failure('WORKER_RUNTIME_BUSY', 'Worker concurrency limit reached.', operation);
    this.activeExecutions += 1;
    this.state.executionsAttempted += 1;
    this.state.lastExecutionAt = new Date().toISOString();
    try {
      const result = await this.dispatcher.dispatch(operation);
      if (result && result.ok) {
        this.state.executionsCompleted += 1;
        this.state.ok = true;
        this.state.status = 'RUNNING';
        this.state.lastError = null;
      } else {
        this.state.executionsFailed += 1;
        this.state.lastError = result && (result.reason || result.error) || 'Worker execution failed.';
      }
      return result;
    } catch (error) {
      return this.failure('WORKER_EXECUTION_FAILED', error.message, operation, true);
    } finally {
      this.activeExecutions -= 1;
    }
  }

  async dispatch(operation = {}) { return await this.executeWorker(operation); }
  async execute(operation = {}) { return await this.executeWorker(operation); }
  async processOperation(operation = {}) { return await this.executeWorker(operation); }

  failure(status, error, operation, countAttempt = false) {
    if (countAttempt) this.state.executionsFailed += 1;
    this.state.ok = false;
    this.state.status = status;
    this.state.lastError = error;
    return { ok: false, service: this.service, status, error, operation, state: this.getState() };
  }

  async healthCheck() {
    const [registry, dispatcher] = await Promise.all([this.registry.healthCheck(), this.dispatcher.healthCheck()]);
    const ok = this.running && registry.ok && dispatcher.ok;
    return { ok, service: this.service, version: this.version, status: ok ? 'HEALTHY' : 'DEGRADED', running: this.running, activeExecutions: this.activeExecutions, maxConcurrentWorkers: this.maxConcurrentWorkers, registry, dispatcher, state: this.getState(), generatedAt: new Date().toISOString() };
  }

  getState() { return { ...this.state, running: this.running, activeExecutions: this.activeExecutions, maxConcurrentWorkers: this.maxConcurrentWorkers, generatedAt: new Date().toISOString() }; }
}

module.exports = WorkerRuntime;
module.exports.WorkerRuntime = WorkerRuntime;
module.exports.default = WorkerRuntime;
