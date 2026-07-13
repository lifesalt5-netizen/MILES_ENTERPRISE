'use strict';

const fs = require('fs');
const path = require('path');

const DigitalCOORuntime = require('./DigitalCOORuntime');

class DigitalCOORuntimeManager {
  constructor(options = {}) {
    this.service = 'DIGITAL_COO_RUNTIME_MANAGER';
    this.version = '1.0.0';

    this.rootDir = options.rootDir || process.cwd();

    this.runtime =
      options.runtime ||
      new DigitalCOORuntime({
        rootDir: this.rootDir,
        workerRuntimeManager: options.workerRuntimeManager || null,
        connectorRuntimeManager: options.connectorRuntimeManager || null,
        learningEngineManager: options.learningEngineManager || null,
        operationExecutionKernel: options.operationExecutionKernel || null,
        executiveIntelligence: options.executiveIntelligence || null,
        capabilityBuilder: options.capabilityBuilder || null
      });

    this.runtimeDir =
      options.runtimeDir ||
      path.join(this.rootDir, 'runtime');

    this.digitalCOODir =
      options.digitalCOODir ||
      path.join(this.runtimeDir, 'digital_coo');

    this.operationQueuePath =
      options.operationQueuePath ||
      path.join(this.digitalCOODir, 'operation_queue.json');

    this.completedOperationsPath =
      options.completedOperationsPath ||
      path.join(this.digitalCOODir, 'completed_operations.jsonl');

    this.failedOperationsPath =
      options.failedOperationsPath ||
      path.join(this.digitalCOODir, 'failed_operations.jsonl');

    this.statePath =
      options.statePath ||
      path.join(this.digitalCOODir, 'digital_coo_runtime_manager_state.json');

    this.executiveSummaryPath =
      options.executiveSummaryPath ||
      path.join(this.digitalCOODir, 'digital_coo_executive_summary.json');

    this.pollIntervalMs = Number(options.pollIntervalMs || 30000);
    this.maxOperationsPerCycle = Number(options.maxOperationsPerCycle || 1);

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
      operationsQueued: 0,
      operationsProcessed: 0,
      operationsCompleted: 0,
      operationsFailed: 0,
      operationsRejected: 0,
      recoveriesAttempted: 0,
      recoveriesCompleted: 0,
      executiveSummariesGenerated: 0,
      lastOperationAt: null,
      lastHealthAt: null,
      lastExecutiveSummaryAt: null,
      lastOperation: null,
      lastHealth: null,
      lastExecutiveSummary: null,
      lastResult: null,
      lastError: null
    };

    this.ensureStorage();
    this.loadState();
  }

  ensureStorage() {
    if (!fs.existsSync(this.digitalCOODir)) {
      fs.mkdirSync(this.digitalCOODir, { recursive: true });
    }

    if (!fs.existsSync(this.operationQueuePath)) {
      fs.writeFileSync(this.operationQueuePath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.completedOperationsPath)) {
      fs.writeFileSync(this.completedOperationsPath, '', 'utf8');
    }

    if (!fs.existsSync(this.failedOperationsPath)) {
      fs.writeFileSync(this.failedOperationsPath, '', 'utf8');
    }

    if (!fs.existsSync(this.executiveSummaryPath)) {
      fs.writeFileSync(this.executiveSummaryPath, JSON.stringify({}, null, 2), 'utf8');
    }

    if (!fs.existsSync(this.statePath)) {
      this.persistState();
    }
  }

  loadState() {
    try {
      if (!fs.existsSync(this.statePath)) {
        return;
      }

      const raw = fs.readFileSync(this.statePath, 'utf8');

      if (!raw.trim()) {
        return;
      }

      const loaded = JSON.parse(raw);

      this.state = {
        ...this.state,
        ...loaded,
        service: this.service,
        version: this.version
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'STATE_LOAD_FAILED';
      this.state.lastError = error.message;
      this.persistState();
    }
  }

  persistState() {
    this.state.generatedAt = new Date().toISOString();
    fs.writeFileSync(this.statePath, JSON.stringify(this.getState(), null, 2), 'utf8');
  }

  appendJsonLine(filePath, payload) {
    fs.appendFileSync(
      filePath,
      `${JSON.stringify({
        ...payload,
        loggedAt: new Date().toISOString()
      })}\n`,
      'utf8'
    );
  }

  readQueue() {
    try {
      if (!fs.existsSync(this.operationQueuePath)) {
        fs.writeFileSync(this.operationQueuePath, JSON.stringify([], null, 2), 'utf8');
      }

      const raw = fs.readFileSync(this.operationQueuePath, 'utf8');

      if (!raw.trim()) {
        return [];
      }

      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return parsed;
      }

      if (parsed && Array.isArray(parsed.operations)) {
        return parsed.operations;
      }

      return [];
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'QUEUE_READ_FAILED';
      this.state.lastError = error.message;
      this.persistState();
      return [];
    }
  }

  writeQueue(queue) {
    fs.writeFileSync(this.operationQueuePath, JSON.stringify(queue, null, 2), 'utf8');
  }

  enqueueOperation(operation = {}) {
    try {
      const queue = this.readQueue();

      const normalized = {
        ...operation,
        operationId:
          operation.operationId ||
          operation.id ||
          `OP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        status: operation.status || 'QUEUED',
        queuedAt: operation.queuedAt || new Date().toISOString()
      };

      queue.push(normalized);
      this.writeQueue(queue);

      this.state.operationsQueued = queue.length;
      this.state.status = 'OPERATION_QUEUED';
      this.state.lastOperation = normalized;
      this.state.lastError = null;
      this.persistState();

      return {
        ok: true,
        service: this.service,
        status: 'OPERATION_QUEUED',
        operation: normalized,
        queueLength: queue.length,
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'OPERATION_QUEUE_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      return {
        ok: false,
        service: this.service,
        status: 'OPERATION_QUEUE_FAILED',
        error: error.message
      };
    }
  }

  dequeueOperations(limit = this.maxOperationsPerCycle) {
    const queue = this.readQueue();
    const selected = queue.slice(0, limit);
    const remaining = queue.slice(limit);

    this.writeQueue(remaining);

    this.state.operationsQueued = remaining.length;
    this.persistState();

    return selected;
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

    this.running = true;
    this.state.ok = true;
    this.state.status = 'RUNNING';
    this.state.startedAt = new Date().toISOString();
    this.state.stoppedAt = null;
    this.state.lastError = null;
    this.persistState();

    await this.runCycle();

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

    this.running = false;
    this.state.status = 'STOPPED';
    this.state.stoppedAt = new Date().toISOString();
    this.persistState();

    return {
      ok: true,
      service: this.service,
      status: 'STOPPED',
      state: this.getState()
    };
  }

  async runCycle() {
    try {
      this.state.cycleCount += 1;
      this.state.lastCycleAt = new Date().toISOString();

      const health = await this.safeHealthCheck();
      let recovery = null;

      if (!health.ok) {
        recovery = await this.recover();
      }

      const operations = this.dequeueOperations(this.maxOperationsPerCycle);
      const results = [];

      for (const operation of operations) {
        const result = await this.processOperation(operation);
        results.push(result);
      }

      const executiveSummary = await this.generateExecutiveSummary();

      this.state.ok = true;
      this.state.status = this.running ? 'RUNNING' : 'CYCLE_COMPLETE';
      this.state.lastHealth = health;
      this.state.lastHealthAt = new Date().toISOString();
      this.state.lastExecutiveSummary = executiveSummary;
      this.state.lastExecutiveSummaryAt = new Date().toISOString();
      this.state.lastResult = {
        health,
        recovery,
        operationsProcessed: results.length,
        results,
        executiveSummary
      };
      this.state.lastError = null;
      this.persistState();

      return {
        ok: true,
        service: this.service,
        status: 'CYCLE_COMPLETE',
        health,
        recovery,
        operationsProcessed: results.length,
        results,
        executiveSummary,
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'CYCLE_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      return {
        ok: false,
        service: this.service,
        status: 'CYCLE_FAILED',
        error: error.message,
        state: this.getState()
      };
    }
  }

  async processOperation(operation = {}) {
    const operationId =
      operation.operationId ||
      operation.id ||
      `OP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const startedAt = new Date().toISOString();

    try {
      if (!this.runtime || typeof this.runtime.executeOperation !== 'function') {
        throw new Error('DigitalCOORuntime does not expose executeOperation().');
      }

      const execution = await this.runtime.executeOperation({
        ...operation,
        operationId
      });

      this.state.operationsProcessed += 1;
      this.state.lastOperationAt = new Date().toISOString();
      this.state.lastOperation = {
        operationId,
        operation,
        execution
      };

      if (execution && execution.ok) {
        this.state.operationsCompleted += 1;

        this.appendJsonLine(this.completedOperationsPath, {
          operationId,
          operation,
          execution,
          startedAt,
          completedAt: new Date().toISOString()
        });

        this.persistState();

        return {
          ok: true,
          service: this.service,
          status: 'OPERATION_COMPLETED',
          operationId,
          execution
        };
      }

      if (execution && execution.status === 'OPERATION_REJECTED') {
        this.state.operationsRejected += 1;
      } else {
        this.state.operationsFailed += 1;
      }

      this.appendJsonLine(this.failedOperationsPath, {
        operationId,
        operation,
        execution,
        startedAt,
        failedAt: new Date().toISOString()
      });

      this.persistState();

      return {
        ok: false,
        service: this.service,
        status: execution && execution.status ? execution.status : 'OPERATION_FAILED',
        operationId,
        execution
      };
    } catch (error) {
      this.state.operationsProcessed += 1;
      this.state.operationsFailed += 1;
      this.state.lastOperationAt = new Date().toISOString();
      this.state.lastError = error.message;

      this.appendJsonLine(this.failedOperationsPath, {
        operationId,
        operation,
        error: error.message,
        startedAt,
        failedAt: new Date().toISOString()
      });

      this.persistState();

      return {
        ok: false,
        service: this.service,
        status: 'OPERATION_FAILED',
        operationId,
        error: error.message
      };
    }
  }

  async generateExecutiveSummary() {
    try {
      let summary;

      if (this.runtime && typeof this.runtime.getExecutiveSummary === 'function') {
        summary = await this.runtime.getExecutiveSummary();
      } else {
        summary = {
          ok: false,
          service: this.service,
          status: 'DIGITAL_COO_EXECUTIVE_SUMMARY_UNAVAILABLE'
        };
      }

      this.state.executiveSummariesGenerated += 1;
      this.state.lastExecutiveSummary = summary;
      this.state.lastExecutiveSummaryAt = new Date().toISOString();

      fs.writeFileSync(this.executiveSummaryPath, JSON.stringify(summary, null, 2), 'utf8');

      return summary;
    } catch (error) {
      const summary = {
        ok: false,
        service: this.service,
        status: 'EXECUTIVE_SUMMARY_FAILED',
        error: error.message,
        generatedAt: new Date().toISOString()
      };

      fs.writeFileSync(this.executiveSummaryPath, JSON.stringify(summary, null, 2), 'utf8');

      return summary;
    }
  }

  async safeHealthCheck() {
    if (!this.runtime || typeof this.runtime.healthCheck !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'DIGITAL_COO_RUNTIME_HEALTHCHECK_UNAVAILABLE'
      };
    }

    return await this.runtime.healthCheck();
  }

  async recover() {
    this.state.recoveriesAttempted += 1;
    this.state.status = 'RECOVERY_ATTEMPTING';
    this.persistState();

    try {
      this.ensureStorage();

      const health = await this.safeHealthCheck();
      const recovered = Boolean(health && health.ok);

      if (recovered) {
        this.state.recoveriesCompleted += 1;
        this.state.status = 'RECOVERY_COMPLETED';
        this.state.lastError = null;
      } else {
        this.state.status = 'RECOVERY_INCOMPLETE';
        this.state.lastError = 'Digital COO Runtime remains degraded after recovery attempt';
      }

      this.persistState();

      return {
        ok: recovered,
        service: this.service,
        status: recovered ? 'RECOVERY_COMPLETED' : 'RECOVERY_INCOMPLETE',
        health
      };
    } catch (error) {
      this.state.status = 'RECOVERY_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      return {
        ok: false,
        service: this.service,
        status: 'RECOVERY_FAILED',
        error: error.message
      };
    }
  }

  async healthCheck() {
    const digitalCOODirExists = fs.existsSync(this.digitalCOODir);
    const queueExists = fs.existsSync(this.operationQueuePath);
    const completedExists = fs.existsSync(this.completedOperationsPath);
    const failedExists = fs.existsSync(this.failedOperationsPath);
    const stateExists = fs.existsSync(this.statePath);
    const summaryExists = fs.existsSync(this.executiveSummaryPath);

    const runtimeHealth = await this.safeHealthCheck();

    const ok =
      digitalCOODirExists &&
      queueExists &&
      completedExists &&
      failedExists &&
      stateExists &&
      summaryExists &&
      runtimeHealth.ok !== false;

    return {
      ok,
      service: this.service,
      version: this.version,
      status: ok ? 'HEALTHY' : 'DEGRADED',
      running: this.running,
      pollIntervalMs: this.pollIntervalMs,
      maxOperationsPerCycle: this.maxOperationsPerCycle,
      paths: {
        digitalCOODir: this.digitalCOODir,
        operationQueuePath: this.operationQueuePath,
        completedOperationsPath: this.completedOperationsPath,
        failedOperationsPath: this.failedOperationsPath,
        statePath: this.statePath,
        executiveSummaryPath: this.executiveSummaryPath
      },
      storage: {
        digitalCOODirExists,
        queueExists,
        completedExists,
        failedExists,
        stateExists,
        summaryExists
      },
      runtime: runtimeHealth,
      state: this.getState()
    };
  }

  getState() {
    return {
      ...this.state,
      running: this.running,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = DigitalCOORuntimeManager;