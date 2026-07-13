'use strict';

const CapabilityDeploymentEngine = require('./CapabilityDeploymentEngine');

class CapabilityDeploymentEngineManager {
  constructor(options = {}) {
    this.service = 'CAPABILITY_DEPLOYMENT_ENGINE_MANAGER';
    this.version = '1.0.0';

    this.rootDir = options.rootDir || process.cwd();

    this.engine =
      options.engine ||
      new CapabilityDeploymentEngine({
        rootDir: this.rootDir,
        capabilityBuilder: options.capabilityBuilder || null,
        workerRegistry: options.workerRegistry || null,
        workerRuntimeManager: options.workerRuntimeManager || null,
        connectorRuntimeManager: options.connectorRuntimeManager || null,
        learningEngineManager: options.learningEngineManager || null,
        executiveIntelligence: options.executiveIntelligence || null
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
      deploymentsChecked: 0,
      deploymentsCompleted: 0,
      deploymentsFailed: 0,
      recoveriesAttempted: 0,
      recoveriesCompleted: 0,
      lastHealth: null,
      lastDeploymentResult: null,
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

      const deploymentResult = this.deployAllReadyCapabilities();

      this.state.deploymentsChecked += 1;
      this.state.lastHealth = health;
      this.state.lastDeploymentResult = deploymentResult;

      if (deploymentResult && typeof deploymentResult.deployed === 'number') {
        this.state.deploymentsCompleted += deploymentResult.deployed;
      }

      if (deploymentResult && typeof deploymentResult.failed === 'number') {
        this.state.deploymentsFailed += deploymentResult.failed;
      }

      this.state.ok = true;
      this.state.status = this.running ? 'RUNNING' : 'CYCLE_COMPLETE';
      this.state.lastResult = {
        health,
        recovery,
        deploymentResult
      };
      this.state.lastError = null;

      return {
        ok: true,
        service: this.service,
        status: 'CYCLE_COMPLETE',
        health,
        recovery,
        deploymentResult,
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

  deployCapability(capability = {}) {
    if (!this.engine || typeof this.engine.deployCapability !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'DEPLOY_CAPABILITY_UNAVAILABLE'
      };
    }

    const result = this.engine.deployCapability(capability);

    this.state.lastDeploymentResult = result;

    if (result && result.ok) {
      this.state.deploymentsCompleted += 1;
      this.state.status = 'CAPABILITY_DEPLOYED';
      this.state.lastError = null;
    } else {
      this.state.deploymentsFailed += 1;
      this.state.status = 'CAPABILITY_DEPLOYMENT_FAILED';
      this.state.lastError =
        result && result.error
          ? result.error
          : 'Unknown capability deployment failure.';
    }

    return {
      ok: Boolean(result && result.ok),
      service: this.service,
      status: this.state.status,
      result,
      state: this.getState()
    };
  }

  deployAllReadyCapabilities() {
    if (!this.engine || typeof this.engine.deployAllReadyCapabilities !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'DEPLOY_ALL_READY_CAPABILITIES_UNAVAILABLE',
        deployed: 0,
        failed: 0
      };
    }

    return this.engine.deployAllReadyCapabilities();
  }

  rollbackDeployment(deploymentId) {
    if (!this.engine || typeof this.engine.rollbackDeployment !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'ROLLBACK_DEPLOYMENT_UNAVAILABLE'
      };
    }

    const result = this.engine.rollbackDeployment(deploymentId);

    this.state.lastResult = result;

    if (result && result.ok) {
      this.state.status = 'DEPLOYMENT_ROLLED_BACK';
      this.state.lastError = null;
    } else {
      this.state.status = 'DEPLOYMENT_ROLLBACK_FAILED';
      this.state.lastError =
        result && result.error
          ? result.error
          : 'Unknown rollback failure.';
    }

    return {
      ok: Boolean(result && result.ok),
      service: this.service,
      status: this.state.status,
      result,
      state: this.getState()
    };
  }

  listDeployments() {
    if (!this.engine || typeof this.engine.listDeployments !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'LIST_DEPLOYMENTS_UNAVAILABLE',
        deployments: []
      };
    }

    return this.engine.listDeployments();
  }

  async recover() {
    this.state.recoveriesAttempted += 1;
    this.state.status = 'RECOVERY_ATTEMPTING';

    try {
      if (this.engine && typeof this.engine.ensureStorage === 'function') {
        this.engine.ensureStorage();
      }

      if (this.engine && typeof this.engine.loadState === 'function') {
        this.engine.loadState();
      }

      const health = await this.safeHealthCheck();
      const recovered = Boolean(health && health.ok);

      if (recovered) {
        this.state.recoveriesCompleted += 1;
        this.state.status = 'RECOVERY_COMPLETED';
        this.state.lastError = null;
      } else {
        this.state.status = 'RECOVERY_INCOMPLETE';
        this.state.lastError = 'Capability Deployment Engine remains degraded after recovery attempt.';
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
    if (!this.engine || typeof this.engine.healthCheck !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'CAPABILITY_DEPLOYMENT_ENGINE_HEALTHCHECK_UNAVAILABLE'
      };
    }

    return await this.engine.healthCheck();
  }

  getExecutiveSummary() {
    return {
      ok: true,
      service: this.service,
      status: 'CAPABILITY_DEPLOYMENT_SUMMARY_READY',
      deployments:
        this.engine && typeof this.engine.listDeployments === 'function'
          ? this.engine.listDeployments()
          : null,
      engineState:
        this.engine && typeof this.engine.getState === 'function'
          ? this.engine.getState()
          : null,
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

module.exports = CapabilityDeploymentEngineManager;