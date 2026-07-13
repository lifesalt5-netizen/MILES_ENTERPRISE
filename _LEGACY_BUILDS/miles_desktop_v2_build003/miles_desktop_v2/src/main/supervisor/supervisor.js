class Supervisor { constructor(runtime) { this.runtime = runtime; this.recoveries = 0; } status() { return { running: true, recoveries: this.recoveries, lastCheck: new Date().toISOString() }; } }
module.exports = { Supervisor };
