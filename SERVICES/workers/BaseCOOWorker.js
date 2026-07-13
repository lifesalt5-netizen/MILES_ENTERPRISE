'use strict';

const fs = require('fs');
const path = require('path');

const TaskExecutionWorker = require('../worker_runtime/TaskExecutionWorker');

class BaseCOOWorker extends TaskExecutionWorker {
  constructor(options = {}) {
    super({
      ...options,
      workerId: options.workerId || 'BASE_COO_WORKER',
      workerName: options.workerName || 'Base COO Worker',
      workerType: options.workerType || 'COO_WORKER',
      description:
        options.description ||
        'Base class for domain-specific Digital COO workers.'
    });

    this.service = 'BASE_COO_WORKER';
    this.version = '1.0.0';

    this.domain =
      options.domain ||
      options.cooDomain ||
      'GENERAL';

    this.runtimeDir =
      options.runtimeDir ||
      path.join(this.rootDir, 'runtime');

    this.cooRuntimeDir =
      options.cooRuntimeDir ||
      path.join(this.runtimeDir, 'coo_workers', this.workerId);

    this.workQueuePath =
      options.workQueuePath ||
      path.join(this.cooRuntimeDir, 'work_queue.json');

    this.completedWorkPath =
      options.completedWorkPath ||
      path.join(this.cooRuntimeDir, 'completed_work.jsonl');

    this.failedWorkPath =
      options.failedWorkPath ||
      path.join(this.cooRuntimeDir, 'failed_work.jsonl');

    this.reportPath =
      options.reportPath ||
      path.join(this.cooRuntimeDir, 'coo_report.json');

    this.approvalRequiredActions = options.approvalRequiredActions || [
      'SEND_EXTERNAL_MESSAGE',
      'SEND_PROPOSAL',
      'CHANGE_PRICING',
      'DELETE_DATA',
      'SIGN_AGREEMENT',
      'HIRE_CONTRACTOR'
    ];

    this.supportedActions = Array.from(
      new Set([
        ...this.supportedActions,
        'QUEUE_WORK',
        'PROCESS_WORK_QUEUE',
        'GENERATE_REPORT',
        'DOMAIN_TASK'
      ])
    );

    this.ensureCOOStorage();
  }

  ensureCOOStorage() {
    if (!fs.existsSync(this.cooRuntimeDir)) {
      fs.mkdirSync(this.cooRuntimeDir, { recursive: true });
    }

    if (!fs.existsSync(this.workQueuePath)) {
      fs.writeFileSync(this.workQueuePath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.completedWorkPath)) {
      fs.writeFileSync(this.completedWorkPath, '', 'utf8');
    }

    if (!fs.existsSync(this.failedWorkPath)) {
      fs.writeFileSync(this.failedWorkPath, '', 'utf8');
    }

    if (!fs.existsSync(this.reportPath)) {
      fs.writeFileSync(this.reportPath, JSON.stringify({}, null, 2), 'utf8');
    }
  }

  readWorkQueue() {
    try {
      if (!fs.existsSync(this.workQueuePath)) {
        fs.writeFileSync(this.workQueuePath, JSON.stringify([], null, 2), 'utf8');
      }

      const raw = fs.readFileSync(this.workQueuePath, 'utf8');

      if (!raw.trim()) {
        return [];
      }

      const parsed = JSON.parse(raw);

      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'WORK_QUEUE_READ_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      return [];
    }
  }

  writeWorkQueue(queue) {
    fs.writeFileSync(this.workQueuePath, JSON.stringify(queue, null, 2), 'utf8');
  }

  queueWork(work = {}) {
    const queue = this.readWorkQueue();

    const workItem = {
      ...work,
      workId:
        work.workId ||
        work.id ||
        `WORK_${this.domain}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      domain: work.domain || this.domain,
      action: String(work.action || work.operation || 'DOMAIN_TASK').toUpperCase(),
      priority: Number(work.priority || 3),
      confidence:
        typeof work.confidence === 'number'
          ? work.confidence
          : 0.9,
      requiresApproval:
        typeof work.requiresApproval === 'boolean'
          ? work.requiresApproval
          : this.actionRequiresApproval(work.action || work.operation),
      status: work.status || 'QUEUED',
      payload: work.payload || {},
      metadata: work.metadata || {},
      queuedAt: work.queuedAt || new Date().toISOString()
    };

    queue.push(workItem);
    this.writeWorkQueue(queue);

    this.state.status = 'WORK_QUEUED';
    this.state.lastResult = workItem;
    this.persistState();

    return {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      status: 'WORK_QUEUED',
      work: workItem,
      queueLength: queue.length
    };
  }

  actionRequiresApproval(action) {
    const normalized = String(action || '').toUpperCase();

    return this.approvalRequiredActions.includes(normalized);
  }

  async run(input = {}, context = {}) {
    const task = this.normalizeTask(input);

    if (task.action === 'QUEUE_WORK') {
      return this.queueWork(task.payload || {});
    }

    if (task.action === 'PROCESS_WORK_QUEUE') {
      return await this.processWorkQueue(task.payload || {}, context);
    }

    if (task.action === 'GENERATE_REPORT') {
      return await this.generateCOOReport();
    }

    if (task.action === 'DOMAIN_TASK') {
      return await this.executeDomainTask(task, context);
    }

    return await super.run(input, context);
  }

  async processWorkQueue(options = {}, context = {}) {
    const limit = Number(options.limit || 1);
    const queue = this.readWorkQueue();

    const selected = queue.slice(0, limit);
    const remaining = queue.slice(limit);

    this.writeWorkQueue(remaining);

    const results = [];

    for (const work of selected) {
      const result = await this.processWorkItem(work, context);
      results.push(result);
    }

    return {
      ok: results.every((result) => result.ok),
      service: this.service,
      workerId: this.workerId,
      status: 'WORK_QUEUE_PROCESSED',
      processed: results.length,
      remaining: remaining.length,
      results
    };
  }

  async processWorkItem(work = {}, context = {}) {
    const startedAt = new Date().toISOString();

    try {
      if (work.requiresApproval) {
        const decision = await this.requestDecision({
          operationId: work.workId,
          operationType: work.action,
          priority: work.priority,
          confidence: work.confidence,
          requiresApproval: true,
          payload: work.payload
        });

        if (!decision || !decision.ok) {
          const rejected = {
            ok: false,
            service: this.service,
            workerId: this.workerId,
            status: 'WORK_REQUIRES_APPROVAL',
            work,
            decision
          };

          this.appendJsonLine(this.failedWorkPath, {
            ...rejected,
            startedAt,
            failedAt: new Date().toISOString()
          });

          return rejected;
        }
      }

      const result = await this.executeDomainWork(work, context);

      if (result && result.ok) {
        this.appendJsonLine(this.completedWorkPath, {
          work,
          result,
          startedAt,
          completedAt: new Date().toISOString()
        });

        await this.emitLearningEvent({
          eventType: 'WORKER_EXECUTION',
          target: this.workerId,
          ok: true,
          status: 'COO_WORK_COMPLETED',
          raw: {
            work,
            result
          }
        });

        return {
          ok: true,
          service: this.service,
          workerId: this.workerId,
          status: 'COO_WORK_COMPLETED',
          work,
          result
        };
      }

      this.appendJsonLine(this.failedWorkPath, {
        work,
        result,
        startedAt,
        failedAt: new Date().toISOString()
      });

      await this.emitLearningEvent({
        eventType: 'WORKER_EXECUTION',
        target: this.workerId,
        ok: false,
        status: 'COO_WORK_FAILED',
        error: result && result.error ? result.error : null,
        raw: {
          work,
          result
        }
      });

      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'COO_WORK_FAILED',
        work,
        result
      };
    } catch (error) {
      const failure = {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'COO_WORK_FAILED',
        work,
        error: error.message
      };

      this.appendJsonLine(this.failedWorkPath, {
        ...failure,
        startedAt,
        failedAt: new Date().toISOString()
      });

      await this.emitLearningEvent({
        eventType: 'WORKER_EXECUTION',
        target: this.workerId,
        ok: false,
        status: 'COO_WORK_FAILED',
        error: error.message,
        raw: work
      });

      return failure;
    }
  }

  async executeDomainTask(task = {}, context = {}) {
    return await this.executeDomainWork(
      {
        workId: task.taskId,
        domain: this.domain,
        action: task.payload.action || 'DOMAIN_TASK',
        priority: task.priority,
        confidence: task.confidence,
        requiresApproval: task.requiresApproval,
        payload: task.payload,
        metadata: task.metadata
      },
      context
    );
  }

  async executeDomainWork(work = {}) {
    return {
      ok: false,
      service: this.service,
      workerId: this.workerId,
      status: 'DOMAIN_WORK_NOT_IMPLEMENTED',
      domain: this.domain,
      work
    };
  }

  async generateCOOReport() {
    const queue = this.readWorkQueue();

    const report = {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      workerName: this.workerName,
      domain: this.domain,
      status: 'COO_REPORT_READY',
      generatedAt: new Date().toISOString(),
      queueLength: queue.length,
      approvalRequiredActions: this.approvalRequiredActions,
      metadata: this.getMetadata(),
      workerState: this.getState()
    };

    fs.writeFileSync(this.reportPath, JSON.stringify(report, null, 2), 'utf8');

    await this.recordExecutiveEvent({
      eventType: 'COO_REPORT',
      domain: this.domain,
      report
    });

    return report;
  }

  async healthCheck() {
    const baseHealth = await super.healthCheck();

    const cooRuntimeDirExists = fs.existsSync(this.cooRuntimeDir);
    const workQueueExists = fs.existsSync(this.workQueuePath);
    const completedWorkExists = fs.existsSync(this.completedWorkPath);
    const failedWorkExists = fs.existsSync(this.failedWorkPath);
    const reportExists = fs.existsSync(this.reportPath);

    const ok =
      baseHealth.ok &&
      cooRuntimeDirExists &&
      workQueueExists &&
      completedWorkExists &&
      failedWorkExists &&
      reportExists;

    return {
      ok,
      service: this.service,
      version: this.version,
      workerId: this.workerId,
      workerName: this.workerName,
      workerType: this.workerType,
      domain: this.domain,
      status: ok ? 'HEALTHY' : 'DEGRADED',
      baseHealth,
      paths: {
        cooRuntimeDir: this.cooRuntimeDir,
        workQueuePath: this.workQueuePath,
        completedWorkPath: this.completedWorkPath,
        failedWorkPath: this.failedWorkPath,
        reportPath: this.reportPath
      },
      storage: {
        cooRuntimeDirExists,
        workQueueExists,
        completedWorkExists,
        failedWorkExists,
        reportExists
      },
      state: this.getState()
    };
  }

  getMetadata() {
    return {
      ...super.getMetadata(),
      service: this.service,
      domain: this.domain,
      approvalRequiredActions: this.approvalRequiredActions
    };
  }
}

module.exports = BaseCOOWorker;