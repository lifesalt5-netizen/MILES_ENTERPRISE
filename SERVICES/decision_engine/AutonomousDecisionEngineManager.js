'use strict';

const AutonomousDecisionEngine = require('./AutonomousDecisionEngine');

class AutonomousDecisionEngineManager {
  constructor(options = {}) {
    this.service = 'AUTONOMOUS_DECISION_ENGINE_MANAGER';
    this.version = '1.0.0';

    this.rootDir = options.rootDir || process.cwd();

    this.engine =
      options.engine ||
      new AutonomousDecisionEngine({
        rootDir: this.rootDir,
        executiveIntelligence: options.executiveIntelligence || null,
        missionEngine: options.missionEngine || null,
        capabilityBuilder: options.capabilityBuilder || null,
        operationExecutionKernel: options.operationExecutionKernel || null,
        learningEngineManager: options.learningEngineManager || null,
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
      decisionsSubmitted: 0,
      decisionsEvaluated: 0,
      decisionsApproved: 0,
      decisionsRejected: 0,
      decisionsRouted: 0,
      decisionsFailed: 0,
      recoveriesAttempted: 0,
      recoveriesCompleted: 0,
      lastDecisionAt: null,
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

      this.state.ok = true;
      this.state.status = this.running ? 'RUNNING' : 'CYCLE_COMPLETE';
      this.state.lastHealth = health;
      this.state.lastResult = {
        health,
        recovery
      };
      this.state.lastError = null;

      return {
        ok: true,
        service: this.service,
        status: 'CYCLE_COMPLETE',
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

  async submitDecision(input = {}) {
    this.state.decisionsSubmitted += 1;
    this.state.lastDecisionAt = new Date().toISOString();

    if (!this.engine || typeof this.engine.decideAndRoute !== 'function') {
      this.state.decisionsFailed += 1;
      this.state.status = 'DECIDE_AND_ROUTE_UNAVAILABLE';
      this.state.lastError = 'AutonomousDecisionEngine does not expose decideAndRoute().';

      return {
        ok: false,
        service: this.service,
        status: 'DECIDE_AND_ROUTE_UNAVAILABLE',
        error: this.state.lastError,
        state: this.getState()
      };
    }

    const result = await this.engine.decideAndRoute(input);

    this.state.lastResult = result;

    if (result && result.decision) {
      this.state.decisionsEvaluated += 1;

      if (result.decision.approved) {
        this.state.decisionsApproved += 1;
      } else {
        this.state.decisionsRejected += 1;
      }
    }

    if (result && result.ok) {
      this.state.decisionsRouted += 1;
      this.state.status = 'DECISION_SUBMITTED_AND_ROUTED';
      this.state.lastError = null;
    } else {
      this.state.decisionsFailed += 1;
      this.state.status = result && result.status ? result.status : 'DECISION_SUBMIT_FAILED';
      this.state.lastError =
        result && result.error
          ? result.error
          : 'Decision was not routed successfully.';
    }

    return {
      ok: Boolean(result && result.ok),
      service: this.service,
      status: this.state.status,
      result,
      state: this.getState()
    };
  }

  async evaluateOnly(input = {}) {
    this.state.decisionsSubmitted += 1;
    this.state.lastDecisionAt = new Date().toISOString();

    if (!this.engine || typeof this.engine.evaluate !== 'function') {
      this.state.decisionsFailed += 1;
      this.state.status = 'EVALUATE_UNAVAILABLE';
      this.state.lastError = 'AutonomousDecisionEngine does not expose evaluate().';

      return {
        ok: false,
        service: this.service,
        status: 'EVALUATE_UNAVAILABLE',
        error: this.state.lastError,
        state: this.getState()
      };
    }

    const result = await this.engine.evaluate(input);

    this.state.lastResult = result;

    if (result && result.decision) {
      this.state.decisionsEvaluated += 1;

      if (result.decision.approved) {
        this.state.decisionsApproved += 1;
      } else {
        this.state.decisionsRejected += 1;
      }
    }

    if (result && result.ok) {
      this.state.status = 'DECISION_EVALUATED';
      this.state.lastError = null;
    } else {
      this.state.decisionsFailed += 1;
      this.state.status = result && result.status ? result.status : 'DECISION_EVALUATION_FAILED';
      this.state.lastError =
        result && result.error
          ? result.error
          : 'Decision evaluation failed.';
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
        this.state.lastError = 'Decision Engine remains degraded after recovery attempt.';
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
        status: 'DECISION_ENGINE_HEALTHCHECK_UNAVAILABLE'
      };
    }

    return await this.engine.healthCheck();
  }

  getExecutiveSummary() {
    return {
      ok: true,
      service: this.service,
      status: 'DECISION_ENGINE_SUMMARY_READY',
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

module.exports = AutonomousDecisionEngineManager;