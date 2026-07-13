'use strict';

const AutonomousWorkOrchestrator = require('./AutonomousWorkOrchestrator');

class AutonomousWorkOrchestratorManager {
  constructor(options = {}) {
    this.service = 'AUTONOMOUS_WORK_ORCHESTRATOR_MANAGER';
    this.version = '1.0.0';

    this.rootDir = options.rootDir || process.cwd();

    this.orchestrator =
      options.orchestrator ||
      new AutonomousWorkOrchestrator({
        rootDir: this.rootDir,
        operationExecutionKernel: options.operationExecutionKernel || null,
        workerRegistry: options.workerRegistry || null,
        workerDispatcher: options.workerDispatcher || null,
        workerRuntimeManager: options.workerRuntimeManager || null,
        autonomousWorkerScheduler: options.autonomousWorkerScheduler || null,
        learningEngineManager: options.learningEngineManager || null,
        executiveIntelligence: options.executiveIntelligence || null,
        decisionEngineManager: options.decisionEngineManager || null,
        digitalCOORuntimeManager: options.digitalCOORuntimeManager || null
      });

    this.pollIntervalMs = Number(options.pollIntervalMs || 30000);

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
      operationsSubmitted: 0,
      cyclesCompleted: 0,
      cyclesFailed: 0,
      recoveriesAttempted: 0,
      recoveriesCompleted: 0,
      lastHealth: null,
      lastSummary: null,
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

    this.running = true;
    this.state.ok = true;
    this.state.status = 'RUNNING';
    this.state.startedAt = new Date().toISOString();
    this.state.stoppedAt = null;
    this.state.lastError = null;

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

      const cycle =
        this.orchestrator && typeof this.orchestrator.runCycle === 'function'
          ? await this.orchestrator.runCycle()
          : {
              ok: false,
              service: this.service,
              status: 'ORCHESTRATOR_RUN_CYCLE_UNAVAILABLE'
            };

      const summary = this.getExecutiveSummary();

      if (cycle && cycle.ok) {
        this.state.cyclesCompleted += 1;
      } else {
        this.state.cyclesFailed += 1;
      }

      this.state.ok = Boolean(cycle && cycle.ok);
      this.state.status = this.running ? 'RUNNING' : 'CYCLE_COMPLETE';
      this.state.lastHealth = health;
      this.state.lastSummary = summary;
      this.state.lastResult = {
        health,
        recovery,
        cycle,
        summary
      };
      this.state.lastError =
        cycle && cycle.ok === false && cycle.error
          ? cycle.error
          : null;

      return {
        ok: Boolean(cycle && cycle.ok),
        service: this.service,
        status: cycle && cycle.ok ? 'CYCLE_COMPLETE' : 'CYCLE_FAILED',
        health,
        recovery,
        cycle,
        summary,
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'CYCLE_FAILED';
      this.state.cyclesFailed += 1;
      this.state.lastError = error.message;

      return {
        ok: false,
        service: this.service,
        status: 'CYCLE_FAILED',
        error: error.message,
        state: this.getState()
      };
    }
  }

  enqueueOperation(operation = {}) {
    if (!this.orchestrator || typeof this.orchestrator.enqueueOperation !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'ENQUEUE_OPERATION_UNAVAILABLE'
      };
    }

    const result = this.orchestrator.enqueueOperation(operation);

    if (result && result.ok) {
      this.state.operationsSubmitted += 1;
      this.state.status = 'OPERATION_SUBMITTED';
      this.state.lastResult = result;
      this.state.lastError = null;
    } else {
      this.state.status = 'OPERATION_SUBMIT_FAILED';
      this.state.lastError =
        result && result.error
          ? result.error
          : 'Unknown operation submit failure.';
    }

    return {
      ok: Boolean(result && result.ok),
      service: this.service,
      status: this.state.status,
      result,
      state: this.getState()
    };
  }

  async recover() {
    this.state.recoveriesAttempted += 1;
    this.state.status = 'RECOVERY_ATTEMPTING';

    try {
      if (this.orchestrator && typeof this.orchestrator.ensureStorage === 'function') {
        this.orchestrator.ensureStorage();
      }

      if (this.orchestrator && typeof this.orchestrator.loadState === 'function') {
        this.orchestrator.loadState();
      }

      if (this.orchestrator && typeof this.orchestrator.loadActiveOperations === 'function') {
        this.orchestrator.loadActiveOperations();
      }

      const health = await this.safeHealthCheck();
      const recovered = Boolean(health && health.ok);

      if (recovered) {
        this.state.recoveriesCompleted += 1;
        this.state.status = 'RECOVERY_COMPLETED';
        this.state.lastError = null;
      } else {
        this.state.status = 'RECOVERY_INCOMPLETE';
        this.state.lastError = 'Autonomous Work Orchestrator remains degraded after recovery attempt.';
      }

      return {
        ok: recovered,
        service: this.service,
        status: recovered ? 'RECOVERY_COMPLETED' : 'RECOVERY_INCOMPLETE',
        health
      };
    } catch (error) {
      this.state.status = 'RECOVERY_FAILED';
      this.state.lastError = error.message;

      return {
        ok: false,
        service: this.service,
        status: 'RECOVERY_FAILED',
        error: error.message
      };
    }
  }

  async safeHealthCheck() {
    if (!this.orchestrator || typeof this.orchestrator.healthCheck !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'ORCHESTRATOR_HEALTHCHECK_UNAVAILABLE'
      };
    }

    return await this.orchestrator.healthCheck();
  }

  listPendingOperations() {
    if (!this.orchestrator || typeof this.orchestrator.listPendingOperations !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'LIST_PENDING_OPERATIONS_UNAVAILABLE',
        operations: []
      };
    }

    return this.orchestrator.listPendingOperations();
  }

  listActiveOperations() {
    if (!this.orchestrator || typeof this.orchestrator.listActiveOperations !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'LIST_ACTIVE_OPERATIONS_UNAVAILABLE',
        operations: []
      };
    }

    return this.orchestrator.listActiveOperations();
  }

  getExecutiveSummary() {
    const summary =
      this.orchestrator && typeof this.orchestrator.getExecutiveSummary === 'function'
        ? this.orchestrator.getExecutiveSummary()
        : {
            ok: false,
            service: this.service,
            status: 'ORCHESTRATOR_SUMMARY_UNAVAILABLE'
          };

    this.state.lastSummary = summary;

    return {
      ok: summary.ok !== false,
      service: this.service,
      status: 'ORCHESTRATOR_MANAGER_SUMMARY_READY',
      orchestratorSummary: summary,
      managerState: this.getState()
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

module.exports = AutonomousWorkOrchestratorManager;