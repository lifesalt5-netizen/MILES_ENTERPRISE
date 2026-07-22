'use strict';

const fs = require('fs');
const path = require('path');

class AutonomousWorkOrchestrator {
  constructor(options = {}) {
    this.service = 'AUTONOMOUS_WORK_ORCHESTRATOR';
    this.version = '1.0.0';

    this.rootDir = options.rootDir || process.cwd();

    this.operationExecutionKernel = options.operationExecutionKernel || null;
    this.workerRegistry = options.workerRegistry || null;
    this.workerDispatcher = options.workerDispatcher || null;
    this.workerRuntimeManager = options.workerRuntimeManager || null;
    this.autonomousWorkerScheduler = options.autonomousWorkerScheduler || null;
    this.learningEngineManager = options.learningEngineManager || null;
    this.executiveIntelligence = options.executiveIntelligence || null;
    this.decisionEngineManager = options.decisionEngineManager || null;
    this.digitalCOORuntimeManager = options.digitalCOORuntimeManager || null;

    this.runtimeDir =
      options.runtimeDir ||
      path.join(this.rootDir, 'runtime');

    this.orchestratorDir =
      options.orchestratorDir ||
      path.join(this.runtimeDir, 'work_orchestrator');

    this.statePath =
      options.statePath ||
      path.join(this.orchestratorDir, 'orchestrator_state.json');

    this.pendingQueuePath =
      options.pendingQueuePath ||
      path.join(this.orchestratorDir, 'pending_operations.json');

    this.activeOperationsPath =
      options.activeOperationsPath ||
      path.join(this.orchestratorDir, 'active_operations.json');

    this.completedOperationsPath =
      options.completedOperationsPath ||
      path.join(this.orchestratorDir, 'completed_operations.jsonl');

    this.failedOperationsPath =
      options.failedOperationsPath ||
      path.join(this.orchestratorDir, 'failed_operations.jsonl');

    this.escalationLogPath =
      options.escalationLogPath ||
      path.join(this.orchestratorDir, 'escalations.jsonl');

    this.executionLogPath =
      options.executionLogPath ||
      path.join(this.orchestratorDir, 'execution_log.jsonl');

    this.pollIntervalMs = Number(options.pollIntervalMs || 30000);
    this.maxOperationsPerCycle = Number(options.maxOperationsPerCycle || 3);
    this.maxConcurrentOperations = Number(options.maxConcurrentOperations || 3);
    this.maxRetries = Number(options.maxRetries || 2);
    this.retryDelayMs = Number(options.retryDelayMs || 1000);

    this.running = false;
    this.loopHandle = null;
    this.activeOperations = new Map();

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      generatedAt: new Date().toISOString(),
      startedAt: null,
      stoppedAt: null,
      lastCycleAt: null,
      cycleCount: 0,
      operationsPulled: 0,
      operationsQueued: 0,
      operationsDispatched: 0,
      operationsCompleted: 0,
      operationsFailed: 0,
      operationsEscalated: 0,
      operationsRetried: 0,
      duplicateOperationsPrevented: 0,
      learningEventsEmitted: 0,
      executiveEventsEmitted: 0,
      schedulerFeeds: 0,
      lastPullAt: null,
      lastDispatchAt: null,
      lastCompletionAt: null,
      lastFailureAt: null,
      lastEscalationAt: null,
      lastHealthAt: null,
      lastResult: null,
      lastError: null
    };

    this.ensureStorage();
    this.loadState();
    this.loadActiveOperations();
  }

  ensureStorage() {
    if (!fs.existsSync(this.orchestratorDir)) {
      fs.mkdirSync(this.orchestratorDir, { recursive: true });
    }

    if (!fs.existsSync(this.pendingQueuePath)) {
      fs.writeFileSync(this.pendingQueuePath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.activeOperationsPath)) {
      fs.writeFileSync(this.activeOperationsPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.completedOperationsPath)) {
      fs.writeFileSync(this.completedOperationsPath, '', 'utf8');
    }

    if (!fs.existsSync(this.failedOperationsPath)) {
      fs.writeFileSync(this.failedOperationsPath, '', 'utf8');
    }

    if (!fs.existsSync(this.escalationLogPath)) {
      fs.writeFileSync(this.escalationLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.executionLogPath)) {
      fs.writeFileSync(this.executionLogPath, '', 'utf8');
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

  readJsonArray(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
      }

      const raw = fs.readFileSync(filePath, 'utf8');

      if (!raw.trim()) {
        return [];
      }

      const parsed = JSON.parse(raw);

      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'JSON_ARRAY_READ_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      return [];
    }
  }

  writeJsonArray(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(Array.isArray(value) ? value : [], null, 2), 'utf8');
  }

  loadActiveOperations() {
    const active = this.readJsonArray(this.activeOperationsPath);

    this.activeOperations.clear();

    for (const operation of active) {
      if (operation && operation.operationId) {
        this.activeOperations.set(operation.operationId, operation);
      }
    }
  }

  persistActiveOperations() {
    this.writeJsonArray(
      this.activeOperationsPath,
      Array.from(this.activeOperations.values())
    );
  }

  normalizeOperation(operation = {}) {
    return {
      operationId:
        operation.operationId ||
        operation.id ||
        `ORCH_OP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,

      operationType:
        operation.operationType ||
        operation.type ||
        operation.action ||
        'UNKNOWN_OPERATION',

      workerId:
        operation.workerId ||
        operation.worker ||
        operation.assignedWorker ||
        null,

      connectorId:
        operation.connectorId ||
        operation.connector ||
        null,

      priority: Number(operation.priority || 3),

      confidence:
        typeof operation.confidence === 'number'
          ? operation.confidence
          : 0.9,

      requiresApproval: Boolean(
        operation.requiresApproval ||
          operation.approvalRequired ||
          operation.requiresKevinApproval
      ),

      payload: operation.payload || operation.input || operation.data || {},

      metadata: operation.metadata || {},

      status: operation.status || 'PENDING',

      retryCount: Number(operation.retryCount || 0),

      maxRetries:
        typeof operation.maxRetries === 'number'
          ? operation.maxRetries
          : this.maxRetries,

      createdAt: operation.createdAt || operation.queuedAt || new Date().toISOString(),

      updatedAt: new Date().toISOString(),

      raw: operation
    };
  }

  enqueueOperation(operation = {}) {
    const queue = this.readJsonArray(this.pendingQueuePath);
    const normalized = this.normalizeOperation(operation);

    const exists =
      queue.some((item) => item.operationId === normalized.operationId) ||
      this.activeOperations.has(normalized.operationId);

    if (exists) {
      this.state.duplicateOperationsPrevented += 1;
      this.persistState();

      return {
        ok: true,
        service: this.service,
        status: 'DUPLICATE_OPERATION_PREVENTED',
        operationId: normalized.operationId
      };
    }

    queue.push(normalized);
    this.writeJsonArray(this.pendingQueuePath, queue);

    this.state.operationsQueued = queue.length;
    this.state.status = 'OPERATION_QUEUED';
    this.state.lastResult = normalized;
    this.state.lastError = null;
    this.persistState();

    return {
      ok: true,
      service: this.service,
      status: 'OPERATION_QUEUED',
      operation: normalized,
      queueLength: queue.length
    };
  }

  dequeueOperations(limit = this.maxOperationsPerCycle) {
    const queue = this.readJsonArray(this.pendingQueuePath);
    const selected = queue.slice(0, limit);
    const remaining = queue.slice(limit);

    this.writeJsonArray(this.pendingQueuePath, remaining);

    this.state.operationsQueued = remaining.length;
    this.persistState();

    return selected;
  }

  async pullOperationsFromKernel() {
    if (!this.operationExecutionKernel) {
      return {
        ok: true,
        service: this.service,
        status: 'OPERATION_KERNEL_UNAVAILABLE_SKIPPED',
        operations: []
      };
    }

    let operations = [];

    try {
      if (typeof this.operationExecutionKernel.getPendingOperations === 'function') {
        operations = await this.operationExecutionKernel.getPendingOperations();
      } else if (typeof this.operationExecutionKernel.poll === 'function') {
        const result = await this.operationExecutionKernel.poll();
        operations = Array.isArray(result) ? result : result && Array.isArray(result.operations) ? result.operations : [];
      } else if (typeof this.operationExecutionKernel.getQueue === 'function') {
        const result = await this.operationExecutionKernel.getQueue();
        operations = Array.isArray(result) ? result : result && Array.isArray(result.operations) ? result.operations : [];
      } else {
        return {
          ok: true,
          service: this.service,
          status: 'OPERATION_KERNEL_POLL_METHOD_UNAVAILABLE_SKIPPED',
          operations: []
        };
      }

      if (!Array.isArray(operations)) {
        operations = [];
      }

      const enqueueResults = operations.map((operation) => this.enqueueOperation(operation));

      this.state.operationsPulled += operations.length;
      this.state.lastPullAt = new Date().toISOString();
      this.persistState();

      return {
        ok: true,
        service: this.service,
        status: 'OPERATIONS_PULLED',
        operations,
        enqueueResults
      };
    } catch (error) {
      this.state.status = 'OPERATION_PULL_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      return {
        ok: false,
        service: this.service,
        status: 'OPERATION_PULL_FAILED',
        error: error.message,
        operations: []
      };
    }
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

      const pullResult = await this.pullOperationsFromKernel();
      const health = await this.healthCheck();

      const availableSlots =
        this.maxConcurrentOperations - this.activeOperations.size;

      const operations =
        availableSlots > 0
          ? this.dequeueOperations(Math.min(this.maxOperationsPerCycle, availableSlots))
          : [];

      const dispatchResults = [];

      for (const operation of operations) {
        const result = await this.dispatchOperation(operation);
        dispatchResults.push(result);
      }

      const schedulerFeed = await this.feedScheduler();

      this.state.ok = true;
      this.state.status = this.running ? 'RUNNING' : 'CYCLE_COMPLETE';
      this.state.lastHealthAt = new Date().toISOString();
      this.state.lastResult = {
        pullResult,
        health,
        dispatchResults,
        schedulerFeed
      };
      this.state.lastError = null;
      this.persistState();

      return {
        ok: true,
        service: this.service,
        status: 'CYCLE_COMPLETE',
        pullResult,
        health,
        dispatchResults,
        schedulerFeed,
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'CYCLE_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      this.appendJsonLine(this.executionLogPath, {
        status: 'CYCLE_FAILED',
        error: error.message
      });

      return {
        ok: false,
        service: this.service,
        status: 'CYCLE_FAILED',
        error: error.message,
        state: this.getState()
      };
    }
  }

  async dispatchOperation(operation = {}) {
    const normalized = this.normalizeOperation(operation);

    if (this.activeOperations.has(normalized.operationId)) {
      this.state.duplicateOperationsPrevented += 1;
      this.persistState();

      return {
        ok: true,
        service: this.service,
        status: 'DUPLICATE_OPERATION_PREVENTED',
        operationId: normalized.operationId
      };
    }

    this.activeOperations.set(normalized.operationId, {
      ...normalized,
      status: 'ACTIVE',
      startedAt: new Date().toISOString()
    });

    this.persistActiveOperations();

    this.appendJsonLine(this.executionLogPath, {
      operationId: normalized.operationId,
      status: 'DISPATCH_STARTED',
      operation: normalized
    });

    try {
      const decision = await this.requestDecisionIfNeeded(normalized);

      if (decision && decision.ok === false) {
        const rejected = {
          ok: false,
          service: this.service,
          status: 'OPERATION_REJECTED_BY_DECISION_ENGINE',
          operationId: normalized.operationId,
          decision
        };

        await this.failOperation(normalized, rejected, false);

        return rejected;
      }

      const workerResolution = await this.resolveWorker(normalized);

      if (!workerResolution.ok) {
        throw new Error(workerResolution.error || workerResolution.status || 'Worker resolution failed.');
      }

      const execution = await this.executeWithWorker(normalized, workerResolution.worker);

      if (execution && execution.ok) {
        await this.completeOperation(normalized, execution);

        return {
          ok: true,
          service: this.service,
          status: 'OPERATION_COMPLETED',
          operationId: normalized.operationId,
          worker: workerResolution.worker,
          execution
        };
      }

      const shouldRetry = normalized.retryCount < normalized.maxRetries;

      if (shouldRetry) {
        await this.retryOperation(normalized, execution);

        return {
          ok: false,
          service: this.service,
          status: 'OPERATION_RETRY_QUEUED',
          operationId: normalized.operationId,
          worker: workerResolution.worker,
          execution
        };
      }

      await this.failOperation(normalized, execution, true);

      return {
        ok: false,
        service: this.service,
        status: 'OPERATION_FAILED',
        operationId: normalized.operationId,
        worker: workerResolution.worker,
        execution
      };
    } catch (error) {
      const shouldRetry = normalized.retryCount < normalized.maxRetries;

      if (shouldRetry) {
        await this.retryOperation(normalized, {
          ok: false,
          error: error.message
        });

        return {
          ok: false,
          service: this.service,
          status: 'OPERATION_RETRY_QUEUED',
          operationId: normalized.operationId,
          error: error.message
        };
      }

      const failure = {
        ok: false,
        service: this.service,
        status: 'OPERATION_FAILED',
        operationId: normalized.operationId,
        error: error.message
      };

      await this.failOperation(normalized, failure, true);

      return failure;
    }
  }

  async requestDecisionIfNeeded(operation) {
    if (!operation.requiresApproval && !this.decisionEngineManager) {
      return {
        ok: true,
        status: 'DECISION_NOT_REQUIRED'
      };
    }

    if (!this.decisionEngineManager) {
      return {
        ok: false,
        status: 'DECISION_ENGINE_MANAGER_UNAVAILABLE'
      };
    }

    if (typeof this.decisionEngineManager.evaluateOnly === 'function') {
      const result = await this.decisionEngineManager.evaluateOnly({
        operation
      });

      if (operation.requiresApproval && result && result.result && result.result.decision) {
        return {
          ok: Boolean(result.result.decision.approved),
          status: result.status,
          result
        };
      }

      return {
        ok: true,
        status: 'DECISION_EVALUATED',
        result
      };
    }

    if (typeof this.decisionEngineManager.submitDecision === 'function') {
      return await this.decisionEngineManager.submitDecision({
        operation
      });
    }

    return {
      ok: false,
      status: 'DECISION_ENGINE_METHOD_UNAVAILABLE'
    };
  }

  async resolveWorker(operation = {}) {
    if (operation.workerId) {
      return {
        ok: true,
        service: this.service,
        status: 'WORKER_RESOLVED_FROM_OPERATION',
        worker: {
          workerId: operation.workerId
        }
      };
    }

    if (this.workerRegistry) {
      if (typeof this.workerRegistry.findWorkerForOperation === 'function') {
        const worker = await this.workerRegistry.findWorkerForOperation(operation);
        if (worker) {
          return {
            ok: true,
            service: this.service,
            status: 'WORKER_RESOLVED_BY_REGISTRY',
            worker
          };
        }
      }

      if (typeof this.workerRegistry.resolveWorker === 'function') {
        const worker = await this.workerRegistry.resolveWorker(operation);
        if (worker) {
          return {
            ok: true,
            service: this.service,
            status: 'WORKER_RESOLVED_BY_REGISTRY',
            worker
          };
        }
      }

      if (typeof this.workerRegistry.listWorkers === 'function') {
        const workers = await this.workerRegistry.listWorkers();
        if (Array.isArray(workers) && workers.length > 0) {
          return {
            ok: true,
            service: this.service,
            status: 'WORKER_RESOLVED_FROM_LIST',
            worker: workers[0]
          };
        }
      }
    }

    if (operation.connectorId) {
      return {
        ok: true,
        service: this.service,
        status: 'CONNECTOR_OPERATION_ROUTED_TO_TASK_WORKER',
        worker: {
          workerId: 'TASK_EXECUTION_WORKER'
        }
      };
    }

    return {
      ok: false,
      service: this.service,
      status: 'NO_WORKER_AVAILABLE',
      error: 'No worker could be resolved for operation.'
    };
  }

  async executeWithWorker(operation = {}, worker = {}) {
    const workerId =
      worker.workerId ||
      worker.id ||
      worker.name ||
      operation.workerId;

    const workerRequest = {
      ...operation,
      workerId,
      payload: operation.payload || {},
      metadata: {
        ...operation.metadata,
        orchestrator: this.service
      }
    };

    if (this.workerDispatcher) {
      if (typeof this.workerDispatcher.dispatch === 'function') {
        return await this.workerDispatcher.dispatch(workerRequest);
      }

      if (typeof this.workerDispatcher.execute === 'function') {
        return await this.workerDispatcher.execute(workerRequest);
      }

      if (typeof this.workerDispatcher.run === 'function') {
        return await this.workerDispatcher.run(workerRequest);
      }
    }

    if (
      this.workerRuntimeManager &&
      this.workerRuntimeManager.runtime &&
      typeof this.workerRuntimeManager.runtime.executeWorker === 'function'
    ) {
      return await this.workerRuntimeManager.runtime.executeWorker(workerRequest);
    }

    if (
      this.workerRuntimeManager &&
      typeof this.workerRuntimeManager.executeWorker === 'function'
    ) {
      return await this.workerRuntimeManager.executeWorker(workerRequest);
    }

    if (
      this.digitalCOORuntimeManager &&
      typeof this.digitalCOORuntimeManager.enqueueOperation === 'function'
    ) {
      return this.digitalCOORuntimeManager.enqueueOperation(workerRequest);
    }

    return {
      ok: false,
      service: this.service,
      status: 'WORKER_EXECUTION_ROUTE_UNAVAILABLE',
      workerId
    };
  }

  async completeOperation(operation = {}, execution = {}) {
    this.activeOperations.delete(operation.operationId);
    this.persistActiveOperations();

    this.state.operationsCompleted += 1;
    this.state.lastCompletionAt = new Date().toISOString();
    this.state.status = 'OPERATION_COMPLETED';
    this.persistState();

    const completion = {
      operationId: operation.operationId,
      operation,
      execution,
      completedAt: new Date().toISOString()
    };

    this.appendJsonLine(this.completedOperationsPath, completion);

    await this.emitLearningEvent({
      eventType: 'OPERATION_OUTCOME',
      target: operation.operationId,
      ok: true,
      status: 'ORCHESTRATED_OPERATION_COMPLETED',
      raw: completion
    });

    await this.emitExecutiveEvent({
      eventType: 'ORCHESTRATED_OPERATION_COMPLETED',
      operationId: operation.operationId,
      operationType: operation.operationType,
      execution
    });

    return {
      ok: true,
      service: this.service,
      status: 'OPERATION_COMPLETED',
      completion
    };
  }

  async retryOperation(operation = {}, execution = {}) {
    this.activeOperations.delete(operation.operationId);
    this.persistActiveOperations();

    const retryOperation = {
      ...operation,
      retryCount: Number(operation.retryCount || 0) + 1,
      status: 'RETRY_QUEUED',
      updatedAt: new Date().toISOString()
    };

    await this.delay(this.retryDelayMs);

    const enqueueResult = this.enqueueOperation(retryOperation);

    this.state.operationsRetried += 1;
    this.state.status = 'OPERATION_RETRY_QUEUED';
    this.persistState();

    this.appendJsonLine(this.executionLogPath, {
      operationId: operation.operationId,
      status: 'RETRY_QUEUED',
      retryOperation,
      execution
    });

    await this.emitLearningEvent({
      eventType: 'OPERATION_OUTCOME',
      target: operation.operationId,
      ok: false,
      status: 'ORCHESTRATED_OPERATION_RETRY_QUEUED',
      error: execution && execution.error ? execution.error : null,
      raw: {
        operation,
        retryOperation,
        execution
      }
    });

    return enqueueResult;
  }

  async failOperation(operation = {}, execution = {}, escalate = true) {
    this.activeOperations.delete(operation.operationId);
    this.persistActiveOperations();

    this.state.operationsFailed += 1;
    this.state.lastFailureAt = new Date().toISOString();
    this.state.status = 'OPERATION_FAILED';
    this.persistState();

    const failure = {
      operationId: operation.operationId,
      operation,
      execution,
      failedAt: new Date().toISOString()
    };

    this.appendJsonLine(this.failedOperationsPath, failure);

    await this.emitLearningEvent({
      eventType: 'OPERATION_OUTCOME',
      target: operation.operationId,
      ok: false,
      status: 'ORCHESTRATED_OPERATION_FAILED',
      error: execution && execution.error ? execution.error : null,
      raw: failure
    });

    await this.emitExecutiveEvent({
      eventType: 'ORCHESTRATED_OPERATION_FAILED',
      operationId: operation.operationId,
      operationType: operation.operationType,
      execution
    });

    if (escalate) {
      await this.escalateOperation(operation, execution);
    }

    return {
      ok: false,
      service: this.service,
      status: 'OPERATION_FAILED',
      failure
    };
  }

  async escalateOperation(operation = {}, execution = {}) {
    this.state.operationsEscalated += 1;
    this.state.lastEscalationAt = new Date().toISOString();
    this.state.status = 'OPERATION_ESCALATED';
    this.persistState();

    const escalation = {
      escalationId:
        `ESC_${operation.operationId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      operationId: operation.operationId,
      operationType: operation.operationType,
      priority: operation.priority,
      reason:
        execution && execution.error
          ? execution.error
          : 'Operation failed and reached escalation threshold.',
      operation,
      execution,
      escalatedAt: new Date().toISOString()
    };

    this.appendJsonLine(this.escalationLogPath, escalation);

    await this.emitExecutiveEvent({
      eventType: 'OPERATION_ESCALATED',
      escalation
    });

    return {
      ok: true,
      service: this.service,
      status: 'OPERATION_ESCALATED',
      escalation
    };
  }

  async feedScheduler() {
    if (
      !this.autonomousWorkerScheduler ||
      typeof this.autonomousWorkerScheduler.listSchedules !== 'function'
    ) {
      return {
        ok: true,
        service: this.service,
        status: 'SCHEDULER_UNAVAILABLE_SKIPPED'
      };
    }

    const schedules = this.autonomousWorkerScheduler.listSchedules();

    this.state.schedulerFeeds += 1;
    this.persistState();

    return {
      ok: true,
      service: this.service,
      status: 'SCHEDULER_OBSERVED',
      schedules
    };
  }

  async emitLearningEvent(event = {}) {
    if (!this.learningEngineManager) {
      return {
        ok: false,
        service: this.service,
        status: 'LEARNING_ENGINE_MANAGER_UNAVAILABLE'
      };
    }

    let result;

    if (typeof this.learningEngineManager.recordEvent === 'function') {
      result = this.learningEngineManager.recordEvent(event);
    } else if (typeof this.learningEngineManager.recordOperationOutcome === 'function') {
      result = this.learningEngineManager.recordOperationOutcome(event);
    } else {
      return {
        ok: false,
        service: this.service,
        status: 'LEARNING_RECORD_METHOD_UNAVAILABLE'
      };
    }

    if (result && result.ok) {
      this.state.learningEventsEmitted += 1;
      this.persistState();
    }

    return result;
  }

  async emitExecutiveEvent(event = {}) {
    if (!this.executiveIntelligence) {
      return {
        ok: false,
        service: this.service,
        status: 'EXECUTIVE_INTELLIGENCE_UNAVAILABLE'
      };
    }

    let result;

    if (typeof this.executiveIntelligence.recordEvent === 'function') {
      result = this.executiveIntelligence.recordEvent(event);
    } else if (typeof this.executiveIntelligence.update === 'function') {
      result = this.executiveIntelligence.update({
        orchestratorEvent: event
      });
    } else {
      return {
        ok: false,
        service: this.service,
        status: 'EXECUTIVE_EVENT_METHOD_UNAVAILABLE'
      };
    }

    if (result && result.ok !== false) {
      this.state.executiveEventsEmitted += 1;
      this.persistState();
    }

    return result;
  }

  async healthCheck() {
    const orchestratorDirExists = fs.existsSync(this.orchestratorDir);
    const statePathExists = fs.existsSync(this.statePath);
    const pendingQueueExists = fs.existsSync(this.pendingQueuePath);
    const activeOperationsExists = fs.existsSync(this.activeOperationsPath);
    const completedOperationsExists = fs.existsSync(this.completedOperationsPath);
    const failedOperationsExists = fs.existsSync(this.failedOperationsPath);
    const escalationLogExists = fs.existsSync(this.escalationLogPath);
    const executionLogExists = fs.existsSync(this.executionLogPath);

    const ok =
      orchestratorDirExists &&
      statePathExists &&
      pendingQueueExists &&
      activeOperationsExists &&
      completedOperationsExists &&
      failedOperationsExists &&
      escalationLogExists &&
      executionLogExists;

    return {
      ok,
      service: this.service,
      version: this.version,
      status: ok ? 'HEALTHY' : 'DEGRADED',
      running: this.running,
      pollIntervalMs: this.pollIntervalMs,
      maxOperationsPerCycle: this.maxOperationsPerCycle,
      maxConcurrentOperations: this.maxConcurrentOperations,
      activeOperations: Array.from(this.activeOperations.keys()),
      paths: {
        orchestratorDir: this.orchestratorDir,
        statePath: this.statePath,
        pendingQueuePath: this.pendingQueuePath,
        activeOperationsPath: this.activeOperationsPath,
        completedOperationsPath: this.completedOperationsPath,
        failedOperationsPath: this.failedOperationsPath,
        escalationLogPath: this.escalationLogPath,
        executionLogPath: this.executionLogPath
      },
      storage: {
        orchestratorDirExists,
        statePathExists,
        pendingQueueExists,
        activeOperationsExists,
        completedOperationsExists,
        failedOperationsExists,
        escalationLogExists,
        executionLogExists
      },
      state: this.getState()
    };
  }

  listPendingOperations() {
    return {
      ok: true,
      service: this.service,
      status: 'PENDING_OPERATIONS_LISTED',
      operations: this.readJsonArray(this.pendingQueuePath)
    };
  }

  listActiveOperations() {
    return {
      ok: true,
      service: this.service,
      status: 'ACTIVE_OPERATIONS_LISTED',
      operations: Array.from(this.activeOperations.values())
    };
  }

  getExecutiveSummary() {
    const pending = this.readJsonArray(this.pendingQueuePath);

    return {
      ok: true,
      service: this.service,
      status: 'ORCHESTRATOR_SUMMARY_READY',
      pendingOperations: pending.length,
      activeOperations: this.activeOperations.size,
      state: this.getState(),
      generatedAt: new Date().toISOString()
    };
  }

  getState() {
    const pending = this.readJsonArray(this.pendingQueuePath);

    return {
      ...this.state,
      running: this.running,
      pendingOperations: pending.length,
      activeOperations: this.activeOperations.size,
      generatedAt: new Date().toISOString()
    };
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = AutonomousWorkOrchestrator;