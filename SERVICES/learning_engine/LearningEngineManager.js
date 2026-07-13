'use strict';

const LearningEngine = require('./LearningEngine');

class LearningEngineManager {
  constructor(options = {}) {
    this.service = 'LEARNING_ENGINE_MANAGER';
    this.version = '1.0.0';

    this.rootDir = options.rootDir || process.cwd();

    this.learningEngine =
      options.learningEngine ||
      new LearningEngine({
        rootDir: this.rootDir,
        runtimeDir: options.runtimeDir,
        learningDir: options.learningDir,
        repeatedFailureThreshold: options.repeatedFailureThreshold
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
      eventsIngested: 0,
      recommendationsGenerated: 0,
      recoveriesAttempted: 0,
      recoveriesCompleted: 0,
      lastMetrics: null,
      lastRecommendations: [],
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

      const health = await this.safeHealthCheck();
      const metrics = this.safeGetMetrics();
      const recommendations = this.safeGetRecommendations();

      let recovery = null;

      if (!health.ok) {
        recovery = await this.recover();
      }

      this.state.ok = true;
      this.state.status = this.running ? 'RUNNING' : 'CYCLE_COMPLETE';
      this.state.lastHealth = health;
      this.state.lastMetrics = metrics;
      this.state.lastRecommendations =
        recommendations && Array.isArray(recommendations.recommendations)
          ? recommendations.recommendations
          : [];

      this.state.recommendationsGenerated = this.state.lastRecommendations.length;

      this.state.lastResult = {
        health,
        metrics,
        recommendations,
        recovery
      };

      this.state.lastError = null;

      return {
        ok: true,
        service: this.service,
        status: 'CYCLE_COMPLETE',
        health,
        metrics,
        recommendations,
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

  recordWorkerExecution(event = {}) {
    if (
      !this.learningEngine ||
      typeof this.learningEngine.recordWorkerExecution !== 'function'
    ) {
      return {
        ok: false,
        service: this.service,
        status: 'RECORD_WORKER_EXECUTION_UNAVAILABLE'
      };
    }

    const result = this.learningEngine.recordWorkerExecution(event);

    if (result && result.ok) {
      this.state.eventsIngested += 1;
      this.state.status = 'WORKER_EXECUTION_RECORDED';
      this.state.lastResult = result;
      this.state.lastError = null;
    } else {
      this.state.status = 'WORKER_EXECUTION_RECORD_FAILED';
      this.state.lastError =
        result && result.error
          ? result.error
          : 'Unknown worker execution record failure';
    }

    return result;
  }

  recordConnectorExecution(event = {}) {
    if (
      !this.learningEngine ||
      typeof this.learningEngine.recordConnectorExecution !== 'function'
    ) {
      return {
        ok: false,
        service: this.service,
        status: 'RECORD_CONNECTOR_EXECUTION_UNAVAILABLE'
      };
    }

    const result = this.learningEngine.recordConnectorExecution(event);

    if (result && result.ok) {
      this.state.eventsIngested += 1;
      this.state.status = 'CONNECTOR_EXECUTION_RECORDED';
      this.state.lastResult = result;
      this.state.lastError = null;
    } else {
      this.state.status = 'CONNECTOR_EXECUTION_RECORD_FAILED';
      this.state.lastError =
        result && result.error
          ? result.error
          : 'Unknown connector execution record failure';
    }

    return result;
  }

  recordOperationOutcome(event = {}) {
    if (
      !this.learningEngine ||
      typeof this.learningEngine.recordOperationOutcome !== 'function'
    ) {
      return {
        ok: false,
        service: this.service,
        status: 'RECORD_OPERATION_OUTCOME_UNAVAILABLE'
      };
    }

    const result = this.learningEngine.recordOperationOutcome(event);

    if (result && result.ok) {
      this.state.eventsIngested += 1;
      this.state.status = 'OPERATION_OUTCOME_RECORDED';
      this.state.lastResult = result;
      this.state.lastError = null;
    } else {
      this.state.status = 'OPERATION_OUTCOME_RECORD_FAILED';
      this.state.lastError =
        result && result.error
          ? result.error
          : 'Unknown operation outcome record failure';
    }

    return result;
  }

  recordEvent(event = {}) {
    if (!this.learningEngine || typeof this.learningEngine.recordEvent !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'RECORD_EVENT_UNAVAILABLE'
      };
    }

    const result = this.learningEngine.recordEvent(event);

    if (result && result.ok) {
      this.state.eventsIngested += 1;
      this.state.status = 'EVENT_RECORDED';
      this.state.lastResult = result;
      this.state.lastError = null;
    } else {
      this.state.status = 'EVENT_RECORD_FAILED';
      this.state.lastError =
        result && result.error
          ? result.error
          : 'Unknown learning event record failure';
    }

    return result;
  }

  safeGetMetrics() {
    if (!this.learningEngine || typeof this.learningEngine.getMetrics !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'GET_METRICS_UNAVAILABLE'
      };
    }

    return this.learningEngine.getMetrics();
  }

  safeGetRecommendations() {
    if (
      !this.learningEngine ||
      typeof this.learningEngine.getRecommendations !== 'function'
    ) {
      return {
        ok: false,
        service: this.service,
        status: 'GET_RECOMMENDATIONS_UNAVAILABLE',
        recommendations: []
      };
    }

    return this.learningEngine.getRecommendations();
  }

  async safeHealthCheck() {
    if (!this.learningEngine || typeof this.learningEngine.healthCheck !== 'function') {
      return {
        ok: false,
        service: this.service,
        status: 'LEARNING_ENGINE_HEALTHCHECK_UNAVAILABLE'
      };
    }

    return await this.learningEngine.healthCheck();
  }

  async recover() {
    this.state.recoveriesAttempted += 1;
    this.state.status = 'RECOVERY_ATTEMPTING';

    try {
      if (
        this.learningEngine &&
        typeof this.learningEngine.ensureStorage === 'function'
      ) {
        this.learningEngine.ensureStorage();
      }

      if (
        this.learningEngine &&
        typeof this.learningEngine.loadState === 'function'
      ) {
        this.learningEngine.loadState();
      }

      const health = await this.safeHealthCheck();
      const recovered = Boolean(health && health.ok);

      if (recovered) {
        this.state.recoveriesCompleted += 1;
        this.state.status = 'RECOVERY_COMPLETED';
        this.state.lastError = null;
      } else {
        this.state.status = 'RECOVERY_INCOMPLETE';
        this.state.lastError = 'Learning Engine remains degraded after recovery attempt';
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

  getExecutiveSummary() {
    const metrics = this.safeGetMetrics();
    const recommendations = this.safeGetRecommendations();

    const summary = {
      ok: true,
      service: this.service,
      status: 'EXECUTIVE_SUMMARY_READY',
      runtimeStatus: this.state.status,
      eventsIngested: this.state.eventsIngested,
      metrics: metrics && metrics.metrics ? metrics.metrics : null,
      recommendations:
        recommendations && Array.isArray(recommendations.recommendations)
          ? recommendations.recommendations
          : [],
      state: this.getState()
    };

    this.state.lastResult = summary;

    return summary;
  }

  getState() {
    return {
      ...this.state,
      running: this.running,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = LearningEngineManager;