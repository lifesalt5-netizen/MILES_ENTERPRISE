class Scheduler {
  constructor(runtime) { this.runtime = runtime; this.timer = null; this.startedAt = null; }
  start() { if (this.timer) return; this.startedAt = new Date().toISOString(); this.timer = setInterval(() => this.runtime.tick(), 15000); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  status() { return { running: Boolean(this.timer), startedAt: this.startedAt, cadenceSeconds: 15 }; }
}
module.exports = { Scheduler };
