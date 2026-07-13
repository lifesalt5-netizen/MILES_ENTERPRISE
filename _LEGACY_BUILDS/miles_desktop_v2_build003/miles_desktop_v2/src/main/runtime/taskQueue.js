class TaskQueue {
  constructor(logger, approvalQueue, notifications) { this.logger = logger; this.approvalQueue = approvalQueue; this.notifications = notifications; this.tasks = []; this.completed = 0; this.failed = 0; }
  seed() {
    if (this.tasks.length) return;
    [
      ['Check connector health', 'operations', 'system'],
      ['Review Instantly outbound health', 'outbound', 'system'],
      ['Check ORION database accessibility', 'orion', 'system'],
      ['Prepare daily CEO attention brief', 'executive', 'system'],
      ['Queue website improvement review', 'website', 'system']
    ].forEach(([title, area, authority]) => this.add({ title, area, authority }));
  }
  add(task) { const t = { id:`task-${Date.now()}-${this.tasks.length}`, title: task.title, area: task.area || 'operations', authority: task.authority || 'system', status:'pending', createdAt:new Date().toISOString() }; this.tasks.push(t); return t; }
  pending() { return this.tasks.filter(t => t.status === 'pending'); }
  status() { return { pending: this.pending().length, completed: this.completed, failed: this.failed, tasks: this.tasks.slice(-50).reverse() }; }
}
module.exports = { TaskQueue };
