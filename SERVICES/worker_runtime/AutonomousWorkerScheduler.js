'use strict';

const fs = require('fs');
const path = require('path');

class AutonomousWorkerScheduler {
  constructor(options = {}) {
    this.service = 'AUTONOMOUS_WORKER_SCHEDULER';
    this.version = '1.0.0';

    this.rootDir = options.rootDir || process.cwd();

    this.workerRuntimeManager = options.workerRuntimeManager || null;
    this.learningEngineManager = options.learningEngineManager || null;
    this.digitalCOORuntimeManager = options.digitalCOORuntimeManager || null;

    this.runtimeDir =
      options.runtimeDir ||
      path.join(this.rootDir, 'runtime');

    this.schedulerDir =
      options.schedulerDir ||
      path.join(this.runtimeDir, 'worker_scheduler');

    this.statePath =
      options.statePath ||
      path.join(this.schedulerDir, 'scheduler_state.json');

    this.scheduleRegistryPath =
      options.scheduleRegistryPath ||
      path.join(this.schedulerDir, 'schedule_registry.json');

    this.executionLogPath =
      options.executionLogPath ||
      path.join(this.schedulerDir, 'scheduler_execution_log.jsonl');

    this.errorLogPath =
      options.errorLogPath ||
      path.join(this.schedulerDir, 'scheduler_error_log.jsonl');

    this.pollIntervalMs = Number(options.pollIntervalMs || 30000);
    this.maxConcurrentSchedules = Number(options.maxConcurrentSchedules || 1);

    this.running = false;
    this.loopHandle = null;
    this.activeExecutions = new Map();

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
      schedulesRegistered: 0,
      schedulesDue: 0,
      schedulesExecuted: 0,
      schedulesSkipped: 0,
      schedulesFailed: 0,
      duplicateExecutionsPrevented: 0,
      learningEventsEmitted: 0,
      lastScheduleAt: null,
      lastExecutionAt: null,
      lastResult: null,
      lastError: null
    };

    this.ensureStorage();
    this.loadState();
  }

  ensureStorage() {
    if (!fs.existsSync(this.schedulerDir)) {
      fs.mkdirSync(this.schedulerDir, { recursive: true });
    }

    if (!fs.existsSync(this.scheduleRegistryPath)) {
      fs.writeFileSync(this.scheduleRegistryPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.executionLogPath)) {
      fs.writeFileSync(this.executionLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.errorLogPath)) {
      fs.writeFileSync(this.errorLogPath, '', 'utf8');
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

  readRegistry() {
    try {
      if (!fs.existsSync(this.scheduleRegistryPath)) {
        fs.writeFileSync(this.scheduleRegistryPath, JSON.stringify([], null, 2), 'utf8');
      }

      const raw = fs.readFileSync(this.scheduleRegistryPath, 'utf8');

      if (!raw.trim()) {
        return [];
      }

      const parsed = JSON.parse(raw);

      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'SCHEDULE_REGISTRY_READ_FAILED';
      this.state.lastError = error.message;
      this.persistState();
      return [];
    }
  }

  writeRegistry(registry) {
    fs.writeFileSync(this.scheduleRegistryPath, JSON.stringify(registry, null, 2), 'utf8');
    this.state.schedulesRegistered = registry.length;
    this.persistState();
  }

  registerSchedule(schedule = {}) {
    try {
      const registry = this.readRegistry();

      const workerId =
        schedule.workerId ||
        schedule.worker ||
        schedule.assignedWorker;

      if (!workerId) {
        return {
          ok: false,
          service: this.service,
          status: 'WORKER_ID_REQUIRED'
        };
      }

      const scheduleId =
        schedule.scheduleId ||
        `${workerId}_${schedule.intervalMs || schedule.cron || 'manual'}_${Date.now()}`;

      const normalized = {
        scheduleId,
        workerId,
        enabled: schedule.enabled !== false,
        intervalMs: schedule.intervalMs ? Number(schedule.intervalMs) : null,
        cron: schedule.cron || null,
        payload: schedule.payload || {},
        maxRetries: Number(schedule.maxRetries || 1),
        retryCount: Number(schedule.retryCount || 0),
        preventOverlap: schedule.preventOverlap !== false,
        lastRunAt: schedule.lastRunAt || null,
        nextRunAt: schedule.nextRunAt || this.calculateNextRunAt(schedule),
        lastStatus: schedule.lastStatus || 'REGISTERED',
        createdAt: schedule.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const filtered = registry.filter((item) => item.scheduleId !== scheduleId);
      filtered.push(normalized);

      this.writeRegistry(filtered);

      this.state.status = 'SCHEDULE_REGISTERED';
      this.state.lastScheduleAt = new Date().toISOString();
      this.state.lastResult = normalized;
      this.state.lastError = null;
      this.persistState();

      return {
        ok: true,
        service: this.service,
        status: 'SCHEDULE_REGISTERED',
        schedule: normalized,
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'SCHEDULE_REGISTER_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      return {
        ok: false,
        service: this.service,
        status: 'SCHEDULE_REGISTER_FAILED',
        error: error.message
      };
    }
  }

  removeSchedule(scheduleId) {
    const registry = this.readRegistry();
    const filtered = registry.filter((schedule) => schedule.scheduleId !== scheduleId);

    this.writeRegistry(filtered);

    return {
      ok: true,
      service: this.service,
      status: 'SCHEDULE_REMOVED',
      scheduleId,
      removed: registry.length - filtered.length
    };
  }

  calculateNextRunAt(schedule = {}, fromDate = new Date()) {
    if (schedule.nextRunAt) {
      return schedule.nextRunAt;
    }

    if (schedule.intervalMs) {
      return new Date(fromDate.getTime() + Number(schedule.intervalMs)).toISOString();
    }

    if (schedule.cron) {
      return this.calculateSimpleCronNextRun(schedule.cron, fromDate);
    }

    return new Date(fromDate.getTime() + this.pollIntervalMs).toISOString();
  }

  calculateSimpleCronNextRun(cron, fromDate = new Date()) {
    const parts = String(cron).trim().split(/\s+/);

    if (parts.length !== 5) {
      return new Date(fromDate.getTime() + this.pollIntervalMs).toISOString();
    }

    const [minute, hour] = parts;

    const next = new Date(fromDate.getTime());
    next.setSeconds(0, 0);

    if (minute !== '*') {
      next.setMinutes(Number(minute));
    } else {
      next.setMinutes(next.getMinutes() + 1);
    }

    if (hour !== '*') {
      next.setHours(Number(hour));
    }

    if (next <= fromDate) {
      next.setDate(next.getDate() + 1);
    }

    return next.toISOString();
  }

  getDueSchedules() {
    const registry = this.readRegistry();
    const now = new Date();

    return registry.filter((schedule) => {
      if (!schedule.enabled) {
        return false;
      }

      if (!schedule.nextRunAt) {
        return true;
      }

      return new Date(schedule.nextRunAt) <= now;
    });
  }

  updateSchedule(scheduleId, updates = {}) {
    const registry = this.readRegistry();

    const updated = registry.map((schedule) => {
      if (schedule.scheduleId !== scheduleId) {
        return schedule;
      }

      return {
        ...schedule,
        ...updates,
        updatedAt: new Date().toISOString()
      };
    });

    this.writeRegistry(updated);

    return {
      ok: true,
      service: this.service,
      status: 'SCHEDULE_UPDATED',
      scheduleId,
      updates
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

      const dueSchedules = this.getDueSchedules();

      this.state.schedulesDue = dueSchedules.length;

      const results = [];

      for (const schedule of dueSchedules) {
        if (results.length >= this.maxConcurrentSchedules) {
          this.state.schedulesSkipped += 1;
          continue;
        }

        const result = await this.executeSchedule(schedule);
        results.push(result);
      }

      this.state.ok = true;
      this.state.status = this.running ? 'RUNNING' : 'CYCLE_COMPLETE';
      this.state.lastResult = {
        due: dueSchedules.length,
        executed: results.length,
        results
      };
      this.state.lastError = null;
      this.persistState();

      return {
        ok: true,
        service: this.service,
        status: 'CYCLE_COMPLETE',
        due: dueSchedules.length,
        executed: results.length,
        results,
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'CYCLE_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      this.appendJsonLine(this.errorLogPath, {
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

  async executeSchedule(schedule = {}) {
    const executionId =
      `${schedule.scheduleId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (
      schedule.preventOverlap !== false &&
      this.activeExecutions.has(schedule.scheduleId)
    ) {
      this.state.duplicateExecutionsPrevented += 1;
      this.persistState();

      return {
        ok: true,
        service: this.service,
        status: 'DUPLICATE_EXECUTION_PREVENTED',
        scheduleId: schedule.scheduleId,
        workerId: schedule.workerId
      };
    }

    this.activeExecutions.set(schedule.scheduleId, {
      executionId,
      startedAt: new Date().toISOString()
    });

    this.appendJsonLine(this.executionLogPath, {
      executionId,
      scheduleId: schedule.scheduleId,
      workerId: schedule.workerId,
      status: 'STARTED',
      schedule
    });

    try {
      const operation = {
        operationId: executionId,
        operationType: 'SCHEDULED_WORKER_EXECUTION',
        workerId: schedule.workerId,
        payload: schedule.payload || {},
        priority: 3,
        confidence: 0.95,
        requiresApproval: false,
        scheduled: true,
        scheduleId: schedule.scheduleId
      };

      let result;

      if (
        this.digitalCOORuntimeManager &&
        typeof this.digitalCOORuntimeManager.enqueueOperation === 'function'
      ) {
        result = this.digitalCOORuntimeManager.enqueueOperation(operation);
      } else if (
        this.workerRuntimeManager &&
        this.workerRuntimeManager.runtime &&
        typeof this.workerRuntimeManager.runtime.executeWorker === 'function'
      ) {
        result = await this.workerRuntimeManager.runtime.executeWorker(operation);
      } else if (
        this.workerRuntimeManager &&
        typeof this.workerRuntimeManager.runCycle === 'function'
      ) {
        result = await this.workerRuntimeManager.runCycle();
      } else {
        throw new Error('No Digital COO queue or Worker Runtime execution route is available.');
      }

      const ok = Boolean(result && result.ok);

      if (ok) {
        this.state.schedulesExecuted += 1;
      } else {
        this.state.schedulesFailed += 1;
      }

      const nextRunAt = this.calculateNextRunAt(
        {
          ...schedule,
          nextRunAt: null
        },
        new Date()
      );

      this.updateSchedule(schedule.scheduleId, {
        lastRunAt: new Date().toISOString(),
        nextRunAt,
        lastStatus: ok ? 'EXECUTED' : 'FAILED',
        retryCount: ok ? 0 : Number(schedule.retryCount || 0) + 1
      });

      this.state.lastExecutionAt = new Date().toISOString();
      this.state.lastResult = result;
      this.persistState();

      this.appendJsonLine(this.executionLogPath, {
        executionId,
        scheduleId: schedule.scheduleId,
        workerId: schedule.workerId,
        status: ok ? 'COMPLETED' : 'FAILED',
        result
      });

      await this.emitLearningEvent({
        eventType: 'WORKER_EXECUTION',
        target: schedule.workerId,
        ok,
        status: ok ? 'SCHEDULED_WORKER_EXECUTION_COMPLETED' : 'SCHEDULED_WORKER_EXECUTION_FAILED',
        error: result && result.error ? result.error : null,
        raw: {
          schedule,
          result
        }
      });

      this.activeExecutions.delete(schedule.scheduleId);

      return {
        ok,
        service: this.service,
        status: ok ? 'SCHEDULE_EXECUTED' : 'SCHEDULE_EXECUTION_FAILED',
        scheduleId: schedule.scheduleId,
        workerId: schedule.workerId,
        executionId,
        result
      };
    } catch (error) {
      this.activeExecutions.delete(schedule.scheduleId);

      this.state.schedulesFailed += 1;
      this.state.lastError = error.message;
      this.persistState();

      this.updateSchedule(schedule.scheduleId, {
        lastRunAt: new Date().toISOString(),
        nextRunAt: this.calculateNextRunAt(
          {
            ...schedule,
            nextRunAt: null
          },
          new Date()
        ),
        lastStatus: 'FAILED',
        retryCount: Number(schedule.retryCount || 0) + 1
      });

      this.appendJsonLine(this.errorLogPath, {
        executionId,
        scheduleId: schedule.scheduleId,
        workerId: schedule.workerId,
        status: 'FAILED',
        error: error.message
      });

      await this.emitLearningEvent({
        eventType: 'WORKER_EXECUTION',
        target: schedule.workerId,
        ok: false,
        status: 'SCHEDULE_EXECUTION_FAILED',
        error: error.message,
        raw: schedule
      });

      return {
        ok: false,
        service: this.service,
        status: 'SCHEDULE_EXECUTION_FAILED',
        scheduleId: schedule.scheduleId,
        workerId: schedule.workerId,
        executionId,
        error: error.message
      };
    }
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
    } else if (typeof this.learningEngineManager.recordWorkerExecution === 'function') {
      result = this.learningEngineManager.recordWorkerExecution(event);
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

  listSchedules() {
    return {
      ok: true,
      service: this.service,
      status: 'SCHEDULES_LISTED',
      schedules: this.readRegistry()
    };
  }

  async healthCheck() {
    const schedulerDirExists = fs.existsSync(this.schedulerDir);
    const statePathExists = fs.existsSync(this.statePath);
    const registryExists = fs.existsSync(this.scheduleRegistryPath);
    const executionLogExists = fs.existsSync(this.executionLogPath);
    const errorLogExists = fs.existsSync(this.errorLogPath);

    const ok =
      schedulerDirExists &&
      statePathExists &&
      registryExists &&
      executionLogExists &&
      errorLogExists;

    return {
      ok,
      service: this.service,
      version: this.version,
      status: ok ? 'HEALTHY' : 'DEGRADED',
      running: this.running,
      pollIntervalMs: this.pollIntervalMs,
      maxConcurrentSchedules: this.maxConcurrentSchedules,
      paths: {
        schedulerDir: this.schedulerDir,
        statePath: this.statePath,
        scheduleRegistryPath: this.scheduleRegistryPath,
        executionLogPath: this.executionLogPath,
        errorLogPath: this.errorLogPath
      },
      storage: {
        schedulerDirExists,
        statePathExists,
        registryExists,
        executionLogExists,
        errorLogExists
      },
      state: this.getState()
    };
  }

  getState() {
    const registry = this.readRegistry();

    return {
      ...this.state,
      schedulesRegistered: registry.length,
      activeExecutions: Array.from(this.activeExecutions.keys()),
      running: this.running,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = AutonomousWorkerScheduler;