'use strict';

const fs = require('fs');
const path = require('path');

class BaseAutonomousWorker {
  constructor(options = {}) {
    this.service = 'BASE_AUTONOMOUS_WORKER';
    this.version = '1.0.0';

    this.rootDir = options.rootDir || process.cwd();

    this.workerId =
      options.workerId ||
      options.id ||
      this.constructor.name ||
      'BASE_AUTONOMOUS_WORKER';

    this.workerName =
      options.workerName ||
      options.name ||
      this.workerId;

    this.workerType =
      options.workerType ||
      options.type ||
      'AUTONOMOUS_WORKER';

    this.description =
      options.description ||
      'Base autonomous worker runtime class.';

    this.connectorRuntimeManager = options.connectorRuntimeManager || null;
    this.learningEngineManager = options.learningEngineManager || null;
    this.decisionEngineManager = options.decisionEngineManager || null;
    this.capabilityDeploymentEngineManager = options.capabilityDeploymentEngineManager || null;
    this.executiveIntelligence = options.executiveIntelligence || null;

    this.runtimeDir =
      options.runtimeDir ||
      path.join(this.rootDir, 'runtime');

    this.workerRuntimeDir =
      options.workerRuntimeDir ||
      path.join(this.runtimeDir, 'workers', this.workerId);

    this.statePath =
      options.statePath ||
      path.join(this.workerRuntimeDir, 'worker_state.json');

    this.executionLogPath =
      options.executionLogPath ||
      path.join(this.workerRuntimeDir, 'execution_log.jsonl');

    this.errorLogPath =
      options.errorLogPath ||
      path.join(this.workerRuntimeDir, 'error_log.jsonl');

    this.heartbeatPath =
      options.heartbeatPath ||
      path.join(this.workerRuntimeDir, 'heartbeat.json');

    this.maxRetries = Number(options.maxRetries || 2);
    this.retryDelayMs = Number(options.retryDelayMs || 1000);

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      workerId: this.workerId,
      workerName: this.workerName,
      workerType: this.workerType,
      description: this.description,
      status: 'INITIALIZED',
      initialized: false,
      shutdown: false,
      generatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      initializedAt: null,
      shutdownAt: null,
      lastHeartbeatAt: null,
      lastExecutionAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      executionsAttempted: 0,
      executionsCompleted: 0,
      executionsFailed: 0,
      retriesAttempted: 0,
      learningEventsEmitted: 0,
      connectorCalls: 0,
      connectorFailures: 0,
      lastInput: null,
      lastResult: null,
      lastError: null
    };

    this.ensureStorage();
    this.loadState();
  }

  ensureStorage() {
    if (!fs.existsSync(this.workerRuntimeDir)) {
      fs.mkdirSync(this.workerRuntimeDir, { recursive: true });
    }

    if (!fs.existsSync(this.executionLogPath)) {
      fs.writeFileSync(this.executionLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.errorLogPath)) {
      fs.writeFileSync(this.errorLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.heartbeatPath)) {
      fs.writeFileSync(this.heartbeatPath, JSON.stringify({}, null, 2), 'utf8');
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
        version: this.version,
        workerId: this.workerId,
        workerName: this.workerName,
        workerType: this.workerType,
        description: this.description
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

  async initialize(context = {}) {
    try {
      this.state.initialized = true;
      this.state.shutdown = false;
      this.state.status = 'READY';
      this.state.initializedAt = new Date().toISOString();
      this.state.lastError = null;

      await this.onInitialize(context);
      await this.heartbeat();

      this.persistState();

      return {
        ok: true,
        service: this.service,
        workerId: this.workerId,
        status: 'READY',
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'INITIALIZE_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      this.appendJsonLine(this.errorLogPath, {
        workerId: this.workerId,
        status: 'INITIALIZE_FAILED',
        error: error.message,
        context
      });

      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'INITIALIZE_FAILED',
        error: error.message,
        state: this.getState()
      };
    }
  }

  async onInitialize() {
    return {
      ok: true,
      status: 'NO_CUSTOM_INITIALIZE'
    };
  }

  async execute(input = {}) {
    const executionId =
      input.executionId ||
      `${this.workerId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const startedAt = new Date().toISOString();

    if (!this.state.initialized) {
      await this.initialize({
        reason: 'AUTO_INITIALIZE_BEFORE_EXECUTE'
      });
    }

    this.state.executionsAttempted += 1;
    this.state.status = 'EXECUTING';
    this.state.lastExecutionAt = startedAt;
    this.state.lastInput = input;
    this.persistState();

    this.appendJsonLine(this.executionLogPath, {
      executionId,
      workerId: this.workerId,
      status: 'STARTED',
      input,
      startedAt
    });

    let attempt = 0;
    let lastError = null;

    while (attempt <= this.maxRetries) {
      try {
        const result = await this.run(input, {
          executionId,
          attempt,
          startedAt
        });

        this.state.executionsCompleted += 1;
        this.state.status = 'COMPLETED';
        this.state.lastSuccessAt = new Date().toISOString();
        this.state.lastResult = result;
        this.state.lastError = null;

        this.persistState();

        const payload = {
          ok: true,
          service: this.service,
          workerId: this.workerId,
          status: 'WORKER_EXECUTION_COMPLETED',
          executionId,
          attempt,
          startedAt,
          completedAt: new Date().toISOString(),
          result,
          state: this.getState()
        };

        this.appendJsonLine(this.executionLogPath, payload);

        await this.emitLearningEvent({
          eventType: 'WORKER_EXECUTION',
          target: this.workerId,
          ok: true,
          status: 'WORKER_EXECUTION_COMPLETED',
          raw: payload
        });

        return payload;
      } catch (error) {
        lastError = error;
        attempt += 1;

        this.state.retriesAttempted += attempt <= this.maxRetries ? 1 : 0;
        this.state.lastError = error.message;

        this.appendJsonLine(this.errorLogPath, {
          executionId,
          workerId: this.workerId,
          status: 'ATTEMPT_FAILED',
          attempt,
          maxRetries: this.maxRetries,
          error: error.message,
          input
        });

        if (attempt <= this.maxRetries) {
          await this.delay(this.retryDelayMs);
        }
      }
    }

    this.state.executionsFailed += 1;
    this.state.status = 'FAILED';
    this.state.lastFailureAt = new Date().toISOString();
    this.state.lastError = lastError ? lastError.message : 'Unknown worker execution failure';
    this.persistState();

    const failure = {
      ok: false,
      service: this.service,
      workerId: this.workerId,
      status: 'WORKER_EXECUTION_FAILED',
      executionId,
      startedAt,
      failedAt: new Date().toISOString(),
      error: this.state.lastError,
      state: this.getState()
    };

    this.appendJsonLine(this.errorLogPath, failure);

    await this.emitLearningEvent({
      eventType: 'WORKER_EXECUTION',
      target: this.workerId,
      ok: false,
      status: 'WORKER_EXECUTION_FAILED',
      error: this.state.lastError,
      raw: failure
    });

    return failure;
  }

  async run() {
    throw new Error(`${this.workerId} must implement run(input, context).`);
  }

  async callConnector(connectorId, action, payload = {}, request = {}) {
    if (!connectorId) {
      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'CONNECTOR_ID_REQUIRED'
      };
    }

    if (
      !this.connectorRuntimeManager ||
      typeof this.connectorRuntimeManager.execute !== 'function'
    ) {
      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'CONNECTOR_RUNTIME_MANAGER_UNAVAILABLE'
      };
    }

    this.state.connectorCalls += 1;
    this.persistState();

    const result = await this.connectorRuntimeManager.execute({
      connectorId,
      action,
      payload,
      request: {
        ...request,
        workerId: this.workerId
      }
    });

    if (!result || !result.ok) {
      this.state.connectorFailures += 1;
      this.state.lastError =
        result && result.error
          ? result.error
          : 'Connector call failed.';
      this.persistState();
    }

    await this.emitLearningEvent({
      eventType: 'CONNECTOR_EXECUTION',
      target: connectorId,
      ok: Boolean(result && result.ok),
      status: result && result.status ? result.status : 'CONNECTOR_EXECUTION_RESULT',
      error: result && result.error ? result.error : null,
      raw: {
        connectorId,
        action,
        payload,
        result
      }
    });

    return result;
  }

  async requestDecision(operation = {}) {
    if (
      !this.decisionEngineManager ||
      typeof this.decisionEngineManager.submitDecision !== 'function'
    ) {
      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'DECISION_ENGINE_MANAGER_UNAVAILABLE'
      };
    }

    return await this.decisionEngineManager.submitDecision({
      operation: {
        ...operation,
        requestedByWorkerId: this.workerId
      }
    });
  }

  async emitLearningEvent(event = {}) {
    if (!this.learningEngineManager) {
      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'LEARNING_ENGINE_MANAGER_UNAVAILABLE'
      };
    }

    let result;

    if (typeof this.learningEngineManager.recordEvent === 'function') {
      result = this.learningEngineManager.recordEvent(event);
    } else if (typeof this.learningEngineManager.recordWorkerExecution === 'function') {
      result = this.learningEngineManager.recordWorkerExecution(event);
    } else {
      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'LEARNING_RECORD_METHOD_UNAVAILABLE'
      };
    }

    if (result && result.ok) {
      this.state.learningEventsEmitted += 1;
      this.persistState();
    }

    return result;
  }

  async recordExecutiveEvent(event = {}) {
    if (!this.executiveIntelligence) {
      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'EXECUTIVE_INTELLIGENCE_UNAVAILABLE'
      };
    }

    if (typeof this.executiveIntelligence.recordEvent === 'function') {
      return this.executiveIntelligence.recordEvent({
        ...event,
        workerId: this.workerId
      });
    }

    if (typeof this.executiveIntelligence.update === 'function') {
      return this.executiveIntelligence.update({
        workerEvent: {
          ...event,
          workerId: this.workerId
        }
      });
    }

    return {
      ok: false,
      service: this.service,
      workerId: this.workerId,
      status: 'EXECUTIVE_INTELLIGENCE_UPDATE_METHOD_UNAVAILABLE'
    };
  }

  async heartbeat() {
    const heartbeat = {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      workerName: this.workerName,
      workerType: this.workerType,
      status: this.state.status,
      generatedAt: new Date().toISOString(),
      state: this.getState()
    };

    this.state.lastHeartbeatAt = heartbeat.generatedAt;

    fs.writeFileSync(this.heartbeatPath, JSON.stringify(heartbeat, null, 2), 'utf8');
    this.persistState();

    return heartbeat;
  }

  async shutdown(context = {}) {
    try {
      await this.onShutdown(context);

      this.state.shutdown = true;
      this.state.initialized = false;
      this.state.status = 'SHUTDOWN';
      this.state.shutdownAt = new Date().toISOString();
      this.state.lastError = null;

      this.persistState();

      return {
        ok: true,
        service: this.service,
        workerId: this.workerId,
        status: 'SHUTDOWN',
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'SHUTDOWN_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      this.appendJsonLine(this.errorLogPath, {
        workerId: this.workerId,
        status: 'SHUTDOWN_FAILED',
        error: error.message,
        context
      });

      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'SHUTDOWN_FAILED',
        error: error.message,
        state: this.getState()
      };
    }
  }

  async onShutdown() {
    return {
      ok: true,
      status: 'NO_CUSTOM_SHUTDOWN'
    };
  }

  async healthCheck() {
    const workerRuntimeDirExists = fs.existsSync(this.workerRuntimeDir);
    const statePathExists = fs.existsSync(this.statePath);
    const executionLogExists = fs.existsSync(this.executionLogPath);
    const errorLogExists = fs.existsSync(this.errorLogPath);
    const heartbeatExists = fs.existsSync(this.heartbeatPath);

    const ok =
      workerRuntimeDirExists &&
      statePathExists &&
      executionLogExists &&
      errorLogExists &&
      heartbeatExists &&
      this.state.status !== 'FAILED' &&
      this.state.status !== 'INITIALIZE_FAILED' &&
      this.state.status !== 'SHUTDOWN_FAILED';

    return {
      ok,
      service: this.service,
      version: this.version,
      workerId: this.workerId,
      workerName: this.workerName,
      workerType: this.workerType,
      status: ok ? 'HEALTHY' : 'DEGRADED',
      paths: {
        workerRuntimeDir: this.workerRuntimeDir,
        statePath: this.statePath,
        executionLogPath: this.executionLogPath,
        errorLogPath: this.errorLogPath,
        heartbeatPath: this.heartbeatPath
      },
      storage: {
        workerRuntimeDirExists,
        statePathExists,
        executionLogExists,
        errorLogExists,
        heartbeatExists
      },
      state: this.getState()
    };
  }

  getMetadata() {
    return {
      workerId: this.workerId,
      workerName: this.workerName,
      workerType: this.workerType,
      description: this.description,
      version: this.version,
      service: this.service
    };
  }

  getState() {
    return {
      ...this.state,
      generatedAt: new Date().toISOString()
    };
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = BaseAutonomousWorker;