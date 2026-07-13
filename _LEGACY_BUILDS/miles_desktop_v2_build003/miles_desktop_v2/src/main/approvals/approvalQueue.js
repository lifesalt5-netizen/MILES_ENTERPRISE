const CEO_REQUIRED = ['pricing', 'hiring', 'client_commitment', 'contract', 'spending', 'legal', 'strategic_direction', 'delete_data'];
class ApprovalQueue {
  constructor(logger) { this.logger = logger; this.items = []; }
  requiresApproval(task) { return CEO_REQUIRED.includes(task.authority || ''); }
  add(task, reason = 'CEO approval required') {
    const item = { id: `approval-${Date.now()}-${this.items.length}`, taskId: task.id, title: task.title, reason, status: 'waiting', createdAt: new Date().toISOString() };
    this.items.unshift(item); this.logger.warn('approval.created', item); return item;
  }
  decide(id, decision) { const item = this.items.find(i => i.id === id); if (!item) return { ok:false, error:'Approval not found' }; item.status = decision; item.decidedAt = new Date().toISOString(); return { ok:true, item }; }
  status() { return this.items; }
}
module.exports = { ApprovalQueue };
