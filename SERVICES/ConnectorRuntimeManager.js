'use strict';

const ConnectorRuntime = require('./connector_runtime/ConnectorRuntime');

class ConnectorRuntimeManager {
  constructor(options = {}) {
    this.service = 'CONNECTOR_RUNTIME_MANAGER';
    this.version = '1.0.0';

    this.rootDir = options.rootDir || process.cwd();

    this.runtime =
      options.runtime ||
      new ConnectorRuntime({
        rootDir: this.rootDir,
        connectorDir: options.connectorDir,
        runtimeDir: options.runtimeDir
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
      connectorsLoaded: 0,
      executionsRouted: 0,
      executionsFailed: 0,
      recoveriesAttempted: 0,
      recoveriesCompleted: 0,
      lastHealth: null,
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

      const loadResult = this.safeLoadAllConnectors();
      const health = await this.safeHealthCheck();

      let recovery = null;

      if (!health.ok) {
        recovery = await this.recover();
      }

      this.state.ok = true;
      this.state.status = this.running ? 'RUNNING' : 'CYCLE_COMPLETE';
      this.state.connectorsLoaded =
        loadResult && typeof loadResult.loaded === 'number'
          ? loadResult.loaded
          : this.state.connectorsLoaded;

      this.state.lastHealth = health;
      this.state.lastResult = {
        loadResult,
        health,
        recovery
      };
      this.state.lastError = null;

      return {
        ok: true,
        service: this.service,
        status: 'CYCLE_COMPLETE',
        loadResult,
        health,
        recovery,
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'CYCLE_FAILED';
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

  safeLoadAllConnectors() {
    if (!this.runtime || typeof this.runtime.loadAllConnectors !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'LOAD_ALL_CONNECTORS_UNAVAILABLE'
      };
    }

    return this.runtime.loadAllConnectors();
  }

  async execute(request = {}) {
    if (!this.runtime || typeof this.runtime.execute !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'CONNECTOR_RUNTIME_EXECUTE_UNAVAILABLE'
      };
    }

    const result = await this.runtime.execute(request);

    if (result && result.ok) {
      this.state.executionsRouted += 1;
      this.state.status = 'EXECUTION_ROUTED';
      this.state.lastResult = result;
      this.state.lastError = null;
    } else {
      this.state.executionsFailed += 1;
      this.state.status = 'EXECUTION_FAILED';
      this.state.lastError = result && result.error ? result.error : 'Unknown connector execution failure';
    }

    return result;
  }

  async recover() {
    this.state.recoveriesAttempted += 1;
    this.state.status = 'RECOVERY_ATTEMPTING';

    try {
      const reload = this.safeLoadAllConnectors();
      const health = await this.safeHealthCheck();

      const recovered = Boolean(health && health.ok);

      if (recovered) {
        this.state.recoveriesCompleted += 1;
        this.state.status = 'RECOVERY_COMPLETED';
        this.state.lastError = null;
      } else {
        this.state.status = 'RECOVERY_INCOMPLETE';
        this.state.lastError = 'Connector runtime remains degraded after recovery attempt';
      }

      return {
        ok: recovered,
        service: this.service,
        status: recovered ? 'RECOVERY_COMPLETED' : 'RECOVERY_INCOMPLETE',
        reload,
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
    if (!this.runtime || typeof this.runtime.healthCheck !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'CONNECTOR_RUNTIME_HEALTHCHECK_UNAVAILABLE'
      };
    }

    return await this.runtime.healthCheck();
  }

  listConnectors() {
    if (!this.runtime || typeof this.runtime.listConnectors !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'LIST_CONNECTORS_UNAVAILABLE'
      };
    }

    return this.runtime.listConnectors();
  }

  getState() {
    return {
      ...this.state,
      running: this.running,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = ConnectorRuntimeManager;