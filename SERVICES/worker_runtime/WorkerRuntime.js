'use strict';

const fs = require('fs');
const path = require('path');

const WorkerRuntime = require('./WorkerRuntime');
const WorkerRegistry = require('./WorkerRegistry');
const WorkerDispatcher = require('./WorkerDispatcher');

class WorkerRuntimeManager {
  constructor(options = {}) {
    this.service = 'WORKER_RUNTIME_MANAGER';
    this.version = '1.1.0';

    this.rootDir = options.rootDir || process.cwd();
    this.businessQueuePath = options.businessQueuePath || path.join(this.rootDir, 'state', 'business_operations_queue.json');

    this.registry = options.registry || new WorkerRegistry({ rootDir: this.rootDir });
    this.dispatcher = options.dispatcher || new WorkerDispatcher({ rootDir: this.rootDir, registry: this.registry });

    this.runtime = options.runtime || new WorkerRuntime({
      rootDir: this.rootDir,
      registry: this.registry,
      dispatcher: this.dispatcher,
      workerDir: options.workerDir || path.join(this.rootDir, 'workers'),
      maxConcurrentWorkers: options.maxConcurrentWorkers || 1
    });

    this.pollIntervalMs = Number(options.pollIntervalMs || 15000);
    this.running = false;
    this.loopHandle = null;

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
      operationsClaimed: 0,
      operationsCompleted: 0,
      operationsFailed: 0,
      lastResult: null,
      lastError: null
    };
  }

  async start() {
    if (this.running) {
      return { ok: true, service: this.service, status: 'ALREADY_RUNNING', state: this.getState() };
    }

    this.running = true;
    this.state.status = 'RUNNING';
    this.state.startedAt = new Date().toISOString();
    this.state.stoppedAt = null;
    this.state.lastError = null;

    await this.runCycle();

    this.loopHandle = setInterval(async () => {
      await this.runCycle();
    }, this.pollIntervalMs);

    return { ok: true, service: this.service, status: 'STARTED', pollIntervalMs: this.pollIntervalMs, state: this.getState() };
  }

  async stop() {
    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
    }

    this.running = false;
    this.state.status = 'STOPPED';
    this.state.stoppedAt = new Date().toISOString();

    return { ok: true, service: this.service, status: 'STOPPED', state: this.getState() };
  }

  async runCycle() {
    try {
      this.state.cycleCount += 1;
      this.state.lastCycleAt = new Date().toISOString();

      const discovery = await this.safeDiscoverWorkers();
      const nextWork = await this.getNextWork();

      let execution = null;

      if (nextWork) {
        execution = await this.executeBusinessOperation(nextWork);

        if (execution && execution.ok) {
          this.state.workersExecuted += 1;
          this.state.operationsCompleted += 1;
        } else {
          this.state.workersFailed += 1;
          this.state.operationsFailed += 1;
        }
      }

      this.state.ok = true;
      this.state.status = this.running ? 'RUNNING' : 'CYCLE_COMPLETE';
      this.state.workersDiscovered =
        discovery && Array.isArray(discovery.workers)
          ? discovery.workers.length
          : this.state.workersDiscovered;

      this.state.lastResult = { discovery, nextWork, execution };
      this.state.lastError = null;

      return { ok: true, service: this.service, status: 'CYCLE_COMPLETE', discovery, nextWork, execution, state: this.getState() };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'CYCLE_FAILED';
      this.state.lastError = error.message;
      this.state.workersFailed += 1;

      return { ok: false, service: this.service, status: 'CYCLE_FAILED', error: error.message, state: this.getState() };
    }
  }

  async safeDiscoverWorkers() {
    if (!this.runtime || typeof this.runtime.discoverWorkers !== 'function') {
      return { ok: false, service: this.service, status: 'DISCOVERY_UNAVAILABLE' };
    }

    return await this.runtime.discoverWorkers();
  }

  async getNextWork() {
    const queue = this.readQueue();
    const operations = Array.isArray(queue.operations) ? queue.operations : [];

    const ready = operations
      .filter((operation) => operation && operation.status === 'READY')
      .sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99))[0];

    if (!ready) return null;

    ready.status = 'RUNNING';
    ready.startedAt = new Date().toISOString();
    ready.updatedAt = new Date().toISOString();

    this.state.operationsClaimed += 1;
    this.writeQueue(queue);

    return ready;
  }

  async executeBusinessOperation(operation) {
    const workerId = operation.worker || operation.workerId || operation.assignedWorker;

    if (!workerId) {
      const failed = { ok: false, status: 'WORKER_REQUIRED', operation };
      this.updateOperation(operation.id, 'FAILED', failed);
      return failed;
    }

    const workerRequest = {
      workerId,
      worker: workerId,
      id: workerId,
      name: workerId,
      payload: operation,
      operationId: operation.id,
      operation
    };

    let result;

    try {
      const originalDispatcher = this.runtime.dispatcher;
      this.runtime.dispatcher = null;
      result = await this.runtime.executeWorker(workerRequest);
      this.runtime.dispatcher = originalDispatcher;

      if (result && result.ok) {
        this.updateOperation(operation.id, 'COMPLETED', result);
      } else {
        this.updateOperation(operation.id, 'FAILED', result);
      }

      return result;
    } catch (error) {
      const failed = { ok: false, status: 'WORKER_EXECUTION_FAILED', error: error.message };
      this.updateOperation(operation.id, 'FAILED', failed);
      return failed;
    }
  }

  updateOperation(operationId, status, result) {
    const queue = this.readQueue();
    queue.operations = (queue.operations || []).map((operation) => {
      if (operation.id !== operationId) return operation;

      return {
        ...operation,
        status,
        result,
        completedAt: status === 'COMPLETED' ? new Date().toISOString() : operation.completedAt || null,
        failedAt: status === 'FAILED' ? new Date().toISOString() : operation.failedAt || null,
        updatedAt: new Date().toISOString()
      };
    });

    queue.generatedAt = new Date().toISOString();
    this.writeQueue(queue);
  }

  readQueue() {
    try {
      if (!fs.existsSync(this.businessQueuePath)) {
        return { generatedAt: new Date().toISOString(), operations: [] };
      }
      return JSON.parse(fs.readFileSync(this.businessQueuePath, 'utf8'));
    } catch {
      return { generatedAt: new Date().toISOString(), operations: [] };
    }
  }

  writeQueue(queue) {
    fs.mkdirSync(path.dirname(this.businessQueuePath), { recursive: true });
    fs.writeFileSync(this.businessQueuePath, JSON.stringify(queue, null, 2), 'utf8');
  }

  async healthCheck() {
    const runtimeHealth =
      this.runtime && typeof this.runtime.healthCheck === 'function'
        ? await this.runtime.healthCheck()
        : { ok: false, status: 'RUNTIME_HEALTH_UNAVAILABLE' };

    return {
      ok: Boolean(runtimeHealth.ok),
      service: this.service,
      version: this.version,
      status: runtimeHealth.ok ? 'HEALTHY' : 'DEGRADED',
      running: this.running,
      pollIntervalMs: this.pollIntervalMs,
      businessQueuePath: this.businessQueuePath,
      runtime: runtimeHealth,
      state: this.getState()
    };
  }

  getState() {
    return { ...this.state, running: this.running, generatedAt: new Date().toISOString() };
  }
}

module.exports = WorkerRuntimeManager;
module.exports.WorkerRuntimeManager = WorkerRuntimeManager;
module.exports.default = WorkerRuntimeManager;