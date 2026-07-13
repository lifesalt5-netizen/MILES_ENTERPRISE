'use strict';

const fs = require('fs');
const path = require('path');

class ConnectorRuntimeManager {
  constructor(options = {}) {
    this.service = 'CONNECTOR_RUNTIME_MANAGER';
    this.version = '1.1.0';
    this.rootDir = options.rootDir || process.env.MILES_ROOT || process.cwd();
    this.runtime = options.runtime || null;

    this.pollIntervalMs = Number(options.pollIntervalMs || 30000);
    this.timer = null;
    this.running = false;

    this.runtimeDir = path.join(this.rootDir, 'runtime', 'connector_runtime_manager');
    this.stateFile = path.join(this.runtimeDir, 'connector_runtime_manager_state.json');
    this.logFile = path.join(this.rootDir, 'logs', 'connector_runtime_manager.log');

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      startedAt: null,
      stoppedAt: null,
      cycleCount: 0,
      lastCycleAt: null,
      connectorsDiscovered: 0,
      connectorsHealthy: 0,
      connectorsFailed: 0,
      lastHealth: null,
      lastError: null,
      generatedAt: new Date().toISOString()
    };

    this.ensureDir(this.runtimeDir);
    this.ensureDir(path.dirname(this.logFile));
    this.saveState();
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

    this.timer = setInterval(() => {
      this.runCycle().catch((error) => {
        this.state.ok = false;
        this.state.status = 'DEGRADED';
        this.state.lastError = error.message;
        this.log('ERROR', error.message);
        this.saveState();
      });
    }, this.pollIntervalMs);

    this.log('INFO', 'Connector Runtime Manager started.');

    return {
      ok: true,
      service: this.service,
      status: 'STARTED',
      pollIntervalMs: this.pollIntervalMs,
      state: this.getState()
    };
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.running = false;
    this.state.status = 'STOPPED';
    this.state.stoppedAt = new Date().toISOString();
    this.saveState();

    this.log('INFO', 'Connector Runtime Manager stopped.');

    return { ok: true, service: this.service, status: 'STOPPED', state: this.getState() };
  }

  async runCycle() {
    let health = null;

    if (this.runtime && typeof this.runtime.healthCheck === 'function') {
      health = await this.runtime.healthCheck();
    } else if (this.runtime && typeof this.runtime.getState === 'function') {
      health = {
        ok: true,
        service: 'CONNECTOR_RUNTIME',
        status: 'STATE_AVAILABLE',
        state: this.runtime.getState()
      };
    } else {
      health = {
        ok: true,
        service: 'CONNECTOR_RUNTIME',
        status: 'RUNTIME_UNAVAILABLE_SKIPPED'
      };
    }

    const connectors = this.extractConnectorCounts(health);

    this.state.ok = health.ok !== false;
    this.state.status = this.running
      ? this.state.ok ? 'RUNNING' : 'DEGRADED'
      : this.state.status;
    this.state.cycleCount += 1;
    this.state.lastCycleAt = new Date().toISOString();
    this.state.connectorsDiscovered = connectors.discovered;
    this.state.connectorsHealthy = connectors.healthy;
    this.state.connectorsFailed = connectors.failed;
    this.state.lastHealth = health;
    this.state.lastError = null;

    this.saveState();

    return {
      ok: this.state.ok,
      service: this.service,
      status: 'CYCLE_COMPLETED',
      health,
      connectors,
      state: this.getState()
    };
  }

  extractConnectorCounts(health = {}) {
    const state = health.state || {};
    const connectors =
      Array.isArray(health.connectors) ? health.connectors :
      Array.isArray(state.connectors) ? state.connectors :
      Array.isArray(state.discoveredConnectors) ? state.discoveredConnectors :
      [];

    if (!Array.isArray(connectors) || connectors.length === 0) {
      return {
        discovered: Number(state.connectorsDiscovered || state.connectorsAvailable || 0),
        healthy: Number(state.connectorsHealthy || state.connectorsAvailable || 0),
        failed: Number(state.connectorsFailed || 0)
      };
    }

    return {
      discovered: connectors.length,
      healthy: connectors.filter((item) => item.ok !== false && item.status !== 'FAILED').length,
      failed: connectors.filter((item) => item.ok === false || item.status === 'FAILED').length
    };
  }

  async healthCheck() {
    const runtimeHealth =
      this.runtime && typeof this.runtime.healthCheck === 'function'
        ? await this.runtime.healthCheck()
        : this.state.lastHealth;

    return {
      ok: this.state.ok,
      service: this.service,
      version: this.version,
      status: this.state.ok ? 'HEALTHY' : 'DEGRADED',
      running: this.running,
      pollIntervalMs: this.pollIntervalMs,
      runtime: runtimeHealth,
      state: this.getState(),
      generatedAt: new Date().toISOString()
    };
  }

  getExecutiveSummary() {
    return {
      ok: true,
      service: this.service,
      status: 'CONNECTOR_RUNTIME_MANAGER_SUMMARY_READY',
      running: this.running,
      connectorsDiscovered: this.state.connectorsDiscovered,
      connectorsHealthy: this.state.connectorsHealthy,
      connectorsFailed: this.state.connectorsFailed,
      lastCycleAt: this.state.lastCycleAt,
      state: this.getState(),
      generatedAt: new Date().toISOString()
    };
  }

  getState() {
    return {
      ...this.state,
      running: this.running,
      generatedAt: new Date().toISOString()
    };
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

module.exports = ConnectorRuntimeManager;
module.exports.ConnectorRuntimeManager = ConnectorRuntimeManager;
module.exports.default = ConnectorRuntimeManager;