class ExecutiveBrain {
  constructor(runtime) { this.runtime = runtime; }
  handle(message) {
    const m = String(message || '').toLowerCase();
    if (m.includes('attention') || m.includes('approval')) return this.attentionBrief();
    if (m.includes('status') || m.includes('health')) return { type:'status', text:'Current MILES status loaded.', data:this.runtime.status() };
    if (m.includes('connector')) return { type:'connectors', text:'Connector health loaded.', data:this.runtime.connectors.status() };
    if (m.includes('task')) return { type:'tasks', text:'Task queue loaded.', data:this.runtime.taskQueue.status() };
    return { type:'ack', text:'Command received. I will route this through the runtime. CEO-level actions will be placed in approvals.', data:{ received: message, ts:new Date().toISOString() } };
  }
  attentionBrief() {
    const s = this.runtime.status();
    const approvals = this.runtime.approvals.status().filter(a => a.status === 'waiting');
    const high = this.runtime.notifications.status().filter(n => n.priority === 'high' && !n.read);
    return { type:'brief', text:`You have ${approvals.length} CEO approval(s), ${high.length} high-priority alert(s), and ${s.tasks.pending} pending operational task(s).`, data:{ approvals, highPriority: high, status:s } };
  }
}
module.exports = { ExecutiveBrain };
