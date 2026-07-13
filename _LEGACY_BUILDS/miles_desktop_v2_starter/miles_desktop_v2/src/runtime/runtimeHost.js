const { state } = require('../shared/state');

class RuntimeHost {
  constructor(logger, config) {
    this.logger = logger;
    this.config = config;
    this.interval = null;
  }

  status() {
    return {
      ...state.runtime,
      metrics: state.metrics
    };
  }

  start() {
    if (state.runtime.status === 'running') return this.status();
    state.runtime.status = 'running';
    state.runtime.startedAt = new Date().toISOString();
    state.runtime.lastHeartbeat = new Date().toISOString();
    state.metrics.activeWorkers = 3;
    state.metrics.connectorHealth = 'connected';
    this.logger('Runtime started');

    this.interval = setInterval(() => {
      state.runtime.lastHeartbeat = new Date().toISOString();
    }, this.config.runtime.healthCheckIntervalMs || 10000);

    return this.status();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    state.runtime.status = 'stopped';
    state.metrics.activeWorkers = 0;
    this.logger('Runtime stopped');
    return this.status();
  }

  restart() {
    this.stop();
    state.runtime.restartAttempts += 1;
    return this.start();
  }

  healthCheck() {
    const healthy = state.runtime.status === 'running';
    return {
      healthy,
      status: state.runtime.status,
      lastHeartbeat: state.runtime.lastHeartbeat,
      checkedAt: new Date().toISOString()
    };
  }

  execute(commandText) {
    const normalized = String(commandText || '').trim();
    const task = {
      id: `task-${Date.now()}`,
      title: normalized || 'Untitled command',
      source: 'executive_chat',
      status: 'queued',
      createdAt: new Date().toISOString()
    };
    state.tasks.unshift(task);
    state.metrics.pendingTasks += 1;
    this.logger(`Queued executive command: ${normalized}`);
    return task;
  }
}

module.exports = RuntimeHost;
