const path = require('path');
const { Logger } = require('../logging/logger');
const { ConnectorManager } = require('../connectors/connectorManager');
const { WorkerManager } = require('../workers/workerManager');
const { ApprovalQueue } = require('../approvals/approvalQueue');
const { NotificationCenter } = require('../notifications/notificationCenter');
const { TaskQueue } = require('./taskQueue');
const { Scheduler } = require('../scheduler/scheduler');
const { Supervisor } = require('../supervisor/supervisor');
const { ExecutiveBrain } = require('../executive/executiveBrain');

class MilesRuntime {
  constructor(rootDir) {
    this.rootDir = rootDir || path.resolve(__dirname, '../../..');
    this.startedAt = null;
    this.running = false;
    this.tickCount = 0;
    this.logger = new Logger(this.rootDir);
    this.notifications = new NotificationCenter(this.logger);
    this.approvals = new ApprovalQueue(this.logger);
    this.connectors = new ConnectorManager(this.logger);
    this.workers = new WorkerManager(this.logger);
    this.taskQueue = new TaskQueue(this.logger, this.approvals, this.notifications);
    this.scheduler = new Scheduler(this);
    this.supervisor = new Supervisor(this);
    this.brain = new ExecutiveBrain(this);
  }
  start() {
    if (this.running) return this.status();
    this.running = true; this.startedAt = new Date().toISOString();
    this.taskQueue.seed();
    this.scheduler.start();
    this.notifications.push('runtime','MILES Runtime started','Autonomous runtime is online.','high');
    this.logger.info('runtime.started');
    return this.status();
  }
  stop() { this.scheduler.stop(); this.running = false; this.notifications.push('runtime','MILES Runtime stopped','Runtime was stopped by command.','high'); return this.status(); }
  restart() { this.stop(); return this.start(); }
  tick() {
    if (!this.running) return;
    this.tickCount += 1;
    this.connectors.healthCheck();
    const next = this.taskQueue.pending()[0];
    if (next) {
      if (this.approvals.requiresApproval(next)) { next.status = 'waiting_approval'; this.approvals.add(next); return; }
      next.status = 'running'; next.startedAt = new Date().toISOString();
      const worker = this.workers.assign(next);
      next.status = 'completed'; next.completedAt = new Date().toISOString(); next.worker = worker.id;
      this.workers.complete(next.id); this.taskQueue.completed += 1;
      this.notifications.push('task','Task completed',next.title,'normal');
      this.logger.info('task.completed', next);
    }
  }
  command(message) { return this.brain.handle(message); }
  status() {
    return {
      running: this.running, startedAt: this.startedAt, tickCount: this.tickCount,
      scheduler: this.scheduler.status(), supervisor: this.supervisor.status(),
      connectors: this.connectors.status(), workers: this.workers.status(),
      tasks: this.taskQueue.status(), approvals: this.approvals.status(), notifications: this.notifications.status()
    };
  }
}
module.exports = { MilesRuntime };
