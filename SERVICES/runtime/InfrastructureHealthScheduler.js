'use strict';

const InfrastructureHealthAuditService = require('./InfrastructureHealthAuditService');

class InfrastructureHealthScheduler {
  constructor(options = {}) {
    this.audit = options.audit || new InfrastructureHealthAuditService(options);
    this.checkMs = Math.max(60000, Number(options.checkMs || process.env.MILES_INFRA_HEALTH_DUE_CHECK_MS || 3600000));
    this.timer = null;
    this.runningAudit = null;
  }
  async tick() {
    const due = this.audit.due();
    if (!due.due) return { ok:true, status:'NOT_DUE', due };
    if (this.runningAudit) return { ok:true, status:'AUDIT_ALREADY_RUNNING', due };
    this.runningAudit = this.audit.run();
    try {
      const result = await this.runningAudit;
      return { ok:result.ok, status:'AUDIT_COMPLETED', due, result };
    } finally { this.runningAudit = null; }
  }
  start() {
    if (this.timer) return { ok:true, status:'ALREADY_STARTED', checkMs:this.checkMs };
    setImmediate(() => this.tick().catch(error => console.error('[MILES INFRA HEALTH] audit error:', error.message)));
    this.timer = setInterval(() => this.tick().catch(error => console.error('[MILES INFRA HEALTH] audit error:', error.message)), this.checkMs);
    this.timer.unref?.();
    return { ok:true, status:'STARTED', checkMs:this.checkMs, intervalHours:this.audit.intervalHours };
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return { ok:true, status:'STOPPED' };
  }
}
module.exports = InfrastructureHealthScheduler;
