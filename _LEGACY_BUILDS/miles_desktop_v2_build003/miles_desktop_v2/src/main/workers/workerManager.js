class WorkerManager {
  constructor(logger) {
    this.logger = logger;
    this.workers = [
      { id: 'ops-worker', role: 'Operations', status: 'idle', currentTask: null },
      { id: 'outbound-worker', role: 'Instantly / CRM', status: 'idle', currentTask: null },
      { id: 'orion-worker', role: 'ORION', status: 'idle', currentTask: null },
      { id: 'website-worker', role: 'Website', status: 'idle', currentTask: null },
      { id: 'engineering-worker', role: 'Engineering', status: 'idle', currentTask: null }
    ];
  }
  assign(task) {
    const worker = this.workers.find(w => w.status === 'idle') || this.workers[0];
    worker.status = 'working';
    worker.currentTask = task.id;
    this.logger.info('worker.assigned', { worker: worker.id, task: task.id });
    return worker;
  }
  complete(taskId) {
    const worker = this.workers.find(w => w.currentTask === taskId);
    if (worker) { worker.status = 'idle'; worker.currentTask = null; }
  }
  status() { return this.workers; }
}
module.exports = { WorkerManager };
