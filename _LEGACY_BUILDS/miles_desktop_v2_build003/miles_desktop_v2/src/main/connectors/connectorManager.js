class ManagedConnector {
  constructor(name, mode = 'api-preferred') {
    this.name = name;
    this.mode = mode;
    this.lastCheck = null;
    this.healthy = true;
    this.lastAction = 'initialized';
  }
  healthCheck() {
    this.lastCheck = new Date().toISOString();
    return { name: this.name, healthy: this.healthy, mode: this.mode, lastCheck: this.lastCheck, lastAction: this.lastAction };
  }
  execute(action, payload = {}) {
    this.lastAction = action;
    return { ok: true, connector: this.name, action, payload, ts: new Date().toISOString() };
  }
  status() { return this.healthCheck(); }
}

class ConnectorManager {
  constructor(logger) {
    this.logger = logger;
    this.connectors = new Map();
    ['ORION', 'Instantly', 'Google Workspace', 'IONOS', 'Namecheap', 'Calendly', 'LinkedIn', 'Website'].forEach(name => {
      this.connectors.set(name, new ManagedConnector(name));
    });
  }
  status() { return Array.from(this.connectors.values()).map(c => c.status()); }
  healthCheck() { return this.status(); }
  execute(name, action, payload = {}) {
    const c = this.connectors.get(name);
    if (!c) return { ok: false, error: `Unknown connector: ${name}` };
    const result = c.execute(action, payload);
    this.logger.info('connector.execute', result);
    return result;
  }
}
module.exports = { ConnectorManager };
