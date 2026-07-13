'use strict';

const fs = require('fs');
const path = require('path');
const COOGoalEngine = require('./COOGoalEngine');

class COOExecutionLoop {
  constructor(options = {}) {
    this.service = 'COO_EXECUTION_LOOP';
    this.version = '1.0.0';
    this.rootDir = options.rootDir || process.cwd();

    this.digitalCOOHost = options.digitalCOOHost || options.host || null;
    this.goalEngine = options.goalEngine || new COOGoalEngine({ rootDir: this.rootDir });

    this.intervalMs = Number(options.intervalMs || 60000);
    this.maxOperationAgeMs = Number(options.maxOperationAgeMs || 24 * 60 * 60 * 1000);

    this.stateDir = path.join(this.rootDir, 'state');
    this.logsDir = path.join(this.rootDir, 'logs');
    this.executiveDir = path.join(this.rootDir, 'executive_intelligence');
    this.learningDir = path.join(this.rootDir, 'learning');
    this.recoveryDir = path.join(this.rootDir, 'recovery');

    this.stateFile = path.join(this.stateDir, 'coo_execution_loop_state.json');
    this.operationLedgerFile = path.join(this.stateDir, 'coo_operation_ledger.json');
    this.executiveFeedFile = path.join(this.executiveDir, 'coo_execution_loop_feed.json');
    this.learningFeedFile = path.join(this.learningDir, 'coo_execution_learning_feed.json');
    this.recoveryFile = path.join(this.recoveryDir, 'coo_execution_recovery.json');
    this.logFile = path.join(this.logsDir, 'coo_execution_loop.log');

    this.running = false;
    this.timer = null;
    this.activeCycle = false;

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      startedAt: null,
      stoppedAt: null,
      cycleCount: 0,
      operationsCreated: 0,
      operationsQueued: 0,
      operationsSkippedDuplicate: 0,
      operationFailures: 0,
      lastCycleAt: null,
      lastError: null,
      generatedAt: new Date().toISOString()
    };

    this.ensureDirectories();
    this.ensureLedger();
  }

  ensureDirectories() {
    for (const dir of [
      this.stateDir,
      this.logsDir,
      this.executiveDir,
      this.learningDir,
      this.recoveryDir
    ]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  ensureLedger() {
    if (!fs.existsSync(this.operationLedgerFile)) {
      this.writeJson(this.operationLedgerFile, {
        generatedAt: new Date().toISOString(),
        source: this.service,
        operations: []
      });
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

    if (this.goalEngine && typeof this.goalEngine.start === 'function') {
      await this.goalEngine.start();
    }

    this.running = true;
    this.state.ok = true;
    this.state.status = 'RUNNING';
    this.state.startedAt = new Date().toISOString();
    this.state.stoppedAt = null;
    this.state.lastError = null;

    this.log('INFO', 'COO Execution Loop started.');

    await this.runCycle();

    this.timer = setInterval(() => {
      this.runCycle().catch((error) => {
        this.state.ok = false;
        this.state.status = 'CYCLE_FAILED';
        this.state.lastError = error.message;
        this.state.operationFailures += 1;
        this.log('ERROR', error.message);
      });
    }, this.intervalMs);

    return {
      ok: true,
      service: this.service,
      status: 'STARTED',
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

    if (this.goalEngine && typeof this.goalEngine.stop === 'function') {
      await this.goalEngine.stop();
    }

    this.saveState();
    this.log('INFO', 'COO Execution Loop stopped.');

    return {
      ok: true,
      service: this.service,
      status: 'STOPPED',
      state: this.getState()
    };
  }

  async runCycle() {
    if (this.activeCycle) {
      return {
        ok: true,
        service: this.service,
        status: 'CYCLE_ALREADY_ACTIVE',
        state: this.getState()
      };
    }

    this.activeCycle = true;

    try {
      const runtimeHealth = await this.getRuntimeHealth();
      const executiveSummary = await this.getHostExecutiveSummary();

      const goalEvaluation = await this.goalEngine.evaluateGoals({
        runtimeHealth,
        executiveSummary
      });

      const recommendedOperations = Array.isArray(goalEvaluation.recommendedOperations)
        ? goalEvaluation.recommendedOperations
        : [];

      const queueResults = [];

      for (const operation of recommendedOperations) {
        const result = await this.queueOperationOnce(operation);
        queueResults.push(result);
      }

      const cycle = {
        ok: queueResults.every((result) => result.ok !== false),
        service: this.service,
        status: 'CYCLE_COMPLETED',
        generatedAt: new Date().toISOString(),
        runtimeHealth,
        executiveSummary,
        goalEvaluationStatus: goalEvaluation.status,
        recommendedOperationCount: recommendedOperations.length,
        queueResults
      };

      this.state.ok = cycle.ok;
      this.state.status = this.running
        ? cycle.ok
          ? 'RUNNING'
          : 'RUNNING_WITH_WARNINGS'
        : this.state.status;
      this.state.cycleCount += 1;
      this.state.lastCycleAt = cycle.generatedAt;
      this.state.lastError = null;

      this.writeJson(this.executiveFeedFile, cycle);
      this.writeLearningFeed(cycle);
      this.writeRecoveryPlan(cycle);
      this.saveState();

      this.log('INFO', `COO execution cycle completed. Queued: ${queueResults.filter((r) => r.status === 'QUEUED').length}`);

      return cycle;
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'CYCLE_FAILED';
      this.state.lastError = error.message;
      this.state.operationFailures += 1;

      const failure = {
        ok: false,
        service: this.service,
        status: 'CYCLE_FAILED',
        error: error.message,
        generatedAt: new Date().toISOString()
      };

      this.writeJson(this.recoveryFile, {
        generatedAt: new Date().toISOString(),
        source: this.service,
        status: 'RECOVERY_REQUIRED',
        reason: error.message,
        action: 'Review COO execution loop, host health, operation queue, and goal evaluation output.'
      });

      this.saveState();
      this.log('ERROR', error.message);

      return failure;
    } finally {
      this.activeCycle = false;
    }
  }

  async queueOperationOnce(operation = {}) {
    const normalized = this.normalizeOperation(operation);

    if (this.isDuplicateOperation(normalized)) {
      this.state.operationsSkippedDuplicate += 1;

      return {
        ok: true,
        status: 'DUPLICATE_SKIPPED',
        operationId: normalized.id,
        area: normalized.area,
        worker: normalized.worker
      };
    }

    this.state.operationsCreated += 1;

    let queueResult = null;

    if (
      this.digitalCOOHost &&
      typeof this.digitalCOOHost.enqueueOperation === 'function'
    ) {
      queueResult = await this.digitalCOOHost.enqueueOperation(normalized);
    } else {
      queueResult = {
        ok: false,
        status: 'NO_DIGITAL_COO_HOST_QUEUE_AVAILABLE'
      };
    }

    const queued = queueResult && queueResult.ok !== false;

    if (queued) {
      this.state.operationsQueued += 1;
    } else {
      this.state.operationFailures += 1;
    }

    this.recordOperation({
      ...normalized,
      queueStatus: queued ? 'QUEUED' : 'QUEUE_FAILED',
      queueResult,
      queuedAt: new Date().toISOString()
    });

    return {
      ok: queued,
      status: queued ? 'QUEUED' : 'QUEUE_FAILED',
      operationId: normalized.id,
      area: normalized.area,
      worker: normalized.worker,
      queueResult
    };
  }

  normalizeOperation(operation = {}) {
    const now = new Date().toISOString();

    const area = operation.area || 'operations';
    const worker = operation.worker || this.mapAreaToWorker(area);

    return {
      id: operation.id || this.buildOperationId(area, worker),
      type: operation.type || 'COO_OPERATION',
      source: this.service,
      area,
      worker,
      priority: Number(operation.priority || 99),
      action: operation.action || 'Review and execute assigned COO operation.',
      goalId: operation.goalId || null,
      approvalRequired: Boolean(operation.approvalRequired),
      ceoEscalationOnly:
        operation.ceoEscalationOnly === undefined ? true : Boolean(operation.ceoEscalationOnly),
      status: 'NEW',
      createdAt: operation.createdAt || now,
      generatedAt: now,
      metadata: operation.metadata || {}
    };
  }

  isDuplicateOperation(operation) {
    const ledger = this.readJson(this.operationLedgerFile, { operations: [] });
    const operations = Array.isArray(ledger.operations) ? ledger.operations : [];
    const cutoff = Date.now() - this.maxOperationAgeMs;

    return operations.some((existing) => {
      const createdTime = Date.parse(existing.createdAt || existing.queuedAt || 0);

      if (!createdTime || createdTime < cutoff) return false;

      return (
        existing.area === operation.area &&
        existing.worker === operation.worker &&
        existing.action === operation.action &&
        existing.goalId === operation.goalId
      );
    });
  }

  recordOperation(operation) {
    const ledger = this.readJson(this.operationLedgerFile, { operations: [] });
    const operations = Array.isArray(ledger.operations) ? ledger.operations : [];

    operations.push(operation);

    const cutoff = Date.now() - this.maxOperationAgeMs;
    const retained = operations.filter((item) => {
      const createdTime = Date.parse(item.createdAt || item.queuedAt || 0);
      return createdTime && createdTime >= cutoff;
    });

    this.writeJson(this.operationLedgerFile, {
      generatedAt: new Date().toISOString(),
      source: this.service,
      operations: retained
    });
  }

  async getRuntimeHealth() {
    if (
      this.digitalCOOHost &&
      typeof this.digitalCOOHost.healthCheck === 'function'
    ) {
      return await this.digitalCOOHost.healthCheck();
    }

    return {
      ok: false,
      status: 'HOST_HEALTH_UNAVAILABLE',
      generatedAt: new Date().toISOString()
    };
  }

  async getHostExecutiveSummary() {
    if (
      this.digitalCOOHost &&
      typeof this.digitalCOOHost.getExecutiveSummary === 'function'
    ) {
      return this.digitalCOOHost.getExecutiveSummary();
    }

    return {
      ok: false,
      status: 'HOST_EXECUTIVE_SUMMARY_UNAVAILABLE',
      generatedAt: new Date().toISOString()
    };
  }

  writeLearningFeed(cycle) {
    const feed = {
      generatedAt: new Date().toISOString(),
      source: this.service,
      lessonType: 'COO_EXECUTION_CYCLE',
      runtimeStatus: cycle.runtimeHealth ? cycle.runtimeHealth.status : 'UNKNOWN',
      recommendedOperationCount: cycle.recommendedOperationCount,
      queuedOperationCount: cycle.queueResults.filter((item) => item.status === 'QUEUED').length,
      skippedDuplicateCount: cycle.queueResults.filter((item) => item.status === 'DUPLICATE_SKIPPED').length,
      failedOperationCount: cycle.queueResults.filter((item) => item.ok === false).length,
      lesson: 'Miles should continuously convert business goals into queued operations, skip duplicates, and escalate only CEO-authority decisions.'
    };

    this.writeJson(this.learningFeedFile, feed);
  }

  writeRecoveryPlan(cycle) {
    const failed = cycle.queueResults.filter((item) => item.ok === false);

    const recovery = {
      generatedAt: new Date().toISOString(),
      source: this.service,
      status: failed.length === 0 ? 'NO_RECOVERY_REQUIRED' : 'RECOVERY_REQUIRED',
      failedOperationCount: failed.length,
      failedOperations: failed,
      recommendedAction:
        failed.length === 0
          ? 'Continue normal COO execution loop.'
          : 'Review failed queue operations, verify host enqueueOperation path, confirm worker/orchestrator manager availability, and retry next cycle.'
    };

    this.writeJson(this.recoveryFile, recovery);
  }

  mapAreaToWorker(area) {
    const normalized = String(area || '').toLowerCase();

    if (normalized === 'outbound') return 'instantly';
    if (normalized === 'instantly') return 'instantly';
    if (normalized === 'website') return 'website';
    if (normalized === 'linkedin') return 'linkedin';
    if (normalized === 'google_workspace') return 'google_workspace';
    if (normalized === 'namecheap') return 'namecheap';
    if (normalized === 'orion') return 'orion';
    if (normalized === 'sales') return 'sales_operations';
    if (normalized === 'recovery') return 'digital_coo';

    return 'digital_coo';
  }

  buildOperationId(area, worker) {
    const safeArea = String(area || 'area').replace(/[^a-zA-Z0-9_]/g, '_');
    const safeWorker = String(worker || 'worker').replace(/[^a-zA-Z0-9_]/g, '_');
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const random = Math.random().toString(36).slice(2, 8);

    return `${safeArea}_${safeWorker}_${stamp}_${random}`;
  }

  async healthCheck() {
    const ledger = this.readJson(this.operationLedgerFile, { operations: [] });

    return {
      ok: this.state.ok,
      service: this.service,
      version: this.version,
      status: this.state.ok ? 'HEALTHY' : 'DEGRADED',
      running: this.running,
      activeCycle: this.activeCycle,
      operationLedgerCount: Array.isArray(ledger.operations) ? ledger.operations.length : 0,
      state: this.getState(),
      generatedAt: new Date().toISOString()
    };
  }

  getExecutiveSummary() {
    return {
      ok: true,
      service: this.service,
      status: 'COO_EXECUTION_SUMMARY_READY',
      running: this.running,
      cycleCount: this.state.cycleCount,
      operationsCreated: this.state.operationsCreated,
      operationsQueued: this.state.operationsQueued,
      operationsSkippedDuplicate: this.state.operationsSkippedDuplicate,
      operationFailures: this.state.operationFailures,
      lastCycleAt: this.state.lastCycleAt,
      state: this.getState(),
      generatedAt: new Date().toISOString()
    };
  }

  getState() {
    return {
      ...this.state,
      running: this.running,
      activeCycle: this.activeCycle,
      generatedAt: new Date().toISOString()
    };
  }

  saveState() {
    this.writeJson(this.stateFile, this.getState());
  }

  readJson(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      return fallback;
    }
  }

  writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
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

module.exports = COOExecutionLoop;