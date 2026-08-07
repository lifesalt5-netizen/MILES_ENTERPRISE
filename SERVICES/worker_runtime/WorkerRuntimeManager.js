'use strict';

const path = require('path');

const WorkerRuntime = require('./WorkerRuntime');
const WorkerRegistry = require('./WorkerRegistry');
const WorkerDispatcher = require('./WorkerDispatcher');

class WorkerRuntimeManager {
  constructor(options = {}) {
    this.service = 'WORKER_RUNTIME_MANAGER';
    this.version = '1.1.0';

    this.rootDir = options.rootDir || process.cwd();

    this.registry =
      options.registry ||
      new WorkerRegistry({
        rootDir: this.rootDir
      });

    this.dispatcher =
      options.dispatcher ||
      new WorkerDispatcher({
        rootDir: this.rootDir,
        registry: this.registry
      });

    this.runtime =
      options.runtime ||
      new WorkerRuntime({
        rootDir: this.rootDir,
        registry: this.registry,
        dispatcher: this.dispatcher,
        workerDir: options.workerDir || path.join(this.rootDir, 'workers'),
        maxConcurrentWorkers: options.maxConcurrentWorkers || 1
      });

    this.pollIntervalMs = Number(options.pollIntervalMs || 15000);
    this.running = false;
    this.loopHandle = null;
    this.cycleInProgress = false;

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      startedAt: null,
      stoppedAt: null,
      lastCycleAt: null,
      cycleCount: 0,
      workersDiscovered: 0,
      workersExecuted: 0,
      workersFailed: 0,
      lastResult: null,
      lastError: null
    };
  }

  async start() {
    if (this.running) {
      return {
        ok: true,
        service: this.service,
        status: 'ALREADY_RUNNING',
        state: this.getState()
      };
    }

    const runtimeStart =
      this.runtime && typeof this.runtime.start === 'function'
        ? await this.runtime.start()
        : { ok: false, status: 'RUNTIME_START_UNAVAILABLE' };

    if (!runtimeStart || runtimeStart.ok === false) {
      this.state.ok = false;
      this.state.status = 'START_FAILED';
      this.state.lastError = runtimeStart && (runtimeStart.error || runtimeStart.status) || 'Worker runtime failed to start.';
      return { ok: false, service: this.service, status: 'START_FAILED', runtime: runtimeStart, state: this.getState() };
    }

    this.running = true;
    this.state.status = 'RUNNING';
    this.state.startedAt = new Date().toISOString();
    this.state.stoppedAt = null;
    this.state.lastError = null;

    const firstCycle = await this.runCycle();
    if (!firstCycle || firstCycle.ok === false) {
      await this.runtime.stop();
      this.running = false;
      this.state.ok = false;
      this.state.status = 'START_FAILED';
      this.state.lastError = firstCycle && (firstCycle.error || firstCycle.status) || 'Initial worker cycle failed.';
      return { ok: false, service: this.service, status: 'START_FAILED', firstCycle, state: this.getState() };
    }

    this.loopHandle = setInterval(async () => {
      await this.runCycle();
    }, this.pollIntervalMs);

    return {
      ok: true,
      service: this.service,
      status: 'STARTED',
      pollIntervalMs: this.pollIntervalMs,
      state: this.getState()
    };
  }

  async stop() {
    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
    }

    if (this.runtime && typeof this.runtime.stop === 'function') {
      await this.runtime.stop();
    }

    this.running = false;
    this.state.status = 'STOPPED';
    this.state.stoppedAt = new Date().toISOString();

    return {
      ok: true,
      service: this.service,
      status: 'STOPPED',
      state: this.getState()
    };
  }

  async runCycle() {
    if (this.cycleInProgress) {
      return { ok: true, service: this.service, status: 'CYCLE_ALREADY_RUNNING', state: this.getState() };
    }

    this.cycleInProgress = true;
    try {
      this.state.cycleCount += 1;
      this.state.lastCycleAt = new Date().toISOString();

      const discovery = await this.safeDiscoverWorkers();
      if (!discovery || discovery.ok === false) {
        throw new Error('Live worker discovery failed.');
      }
      const nextWork = await this.getNextWork();

      let execution = null;

      if (nextWork) {
        execution = await this.runtime.executeWorker(nextWork);

        if (execution && execution.ok) {
          this.state.workersExecuted += 1;
        } else {
          this.state.workersFailed += 1;
        }
      }

      this.state.ok = true;
      this.state.status = this.running ? 'RUNNING' : 'CYCLE_COMPLETE';
      this.state.workersDiscovered =
        discovery && Array.isArray(discovery.workers)
          ? discovery.workers.length
          : this.state.workersDiscovered;

      this.state.lastResult = {
        discovery,
        nextWork,
        execution
      };

      this.state.lastError = null;

      return {
        ok: true,
        service: this.service,
        status: 'CYCLE_COMPLETE',
        discovery,
        nextWork,
        execution,
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'CYCLE_FAILED';
      this.state.lastError = error.message;
      this.state.workersFailed += 1;

      return {
        ok: false,
        service: this.service,
        status: 'CYCLE_FAILED',
        error: error.message,
        state: this.getState()
      };
    } finally {
      this.cycleInProgress = false;
    }
  }

  async safeDiscoverWorkers() {
    if (!this.runtime || typeof this.runtime.discoverWorkers !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'DISCOVERY_UNAVAILABLE'
      };
    }

    return await this.runtime.discoverWorkers();
  }

  async getNextWork() {
    if (this.dispatcher) {
      if (typeof this.dispatcher.getNextWork === 'function') {
        return await this.dispatcher.getNextWork();
      }

      if (typeof this.dispatcher.next === 'function') {
        return await this.dispatcher.next();
      }

      if (typeof this.dispatcher.dequeue === 'function') {
        return await this.dispatcher.dequeue();
      }

      if (typeof this.dispatcher.poll === 'function') {
        return await this.dispatcher.poll();
      }
    }

    return null;
  }

  async executeWorker(operation = {}) {
    return await this.runtime.executeWorker(operation);
  }

  async dispatch(operation = {}) {
    return await this.executeWorker(operation);
  }

  async healthCheck() {
    const runtimeHealth =
      this.runtime && typeof this.runtime.healthCheck === 'function'
        ? await this.runtime.healthCheck()
        : {
            ok: false,
            status: 'RUNTIME_HEALTH_UNAVAILABLE'
          };

    return {
      ok: Boolean(this.running && runtimeHealth.ok),
      service: this.service,
      version: this.version,
      status: this.running && runtimeHealth.ok ? 'HEALTHY' : 'DEGRADED',
      running: this.running,
      pollIntervalMs: this.pollIntervalMs,
      runtime: runtimeHealth,
      state: this.getState()
    };
  }

  getState() {
    return {
      ...this.state,
      running: this.running,
      cycleInProgress: this.cycleInProgress,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = WorkerRuntimeManager;
