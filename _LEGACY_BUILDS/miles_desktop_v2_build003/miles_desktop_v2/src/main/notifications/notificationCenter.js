class NotificationCenter {
  constructor(logger) { this.logger = logger; this.items = []; }
  push(type, title, message, priority = 'normal') { const n = { id:`note-${Date.now()}-${this.items.length}`, type, title, message, priority, read:false, ts:new Date().toISOString() }; this.items.unshift(n); this.logger.info('notification', n); return n; }
  status() { return this.items; }
}
module.exports = { NotificationCenter };
