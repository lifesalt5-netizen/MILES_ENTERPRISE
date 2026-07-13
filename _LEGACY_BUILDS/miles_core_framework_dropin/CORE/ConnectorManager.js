const logger = require("./Logger");
const eventBus = require("./EventBus");

class ConnectorManager {
  constructor() {
    this.connectors = new Map();
  }

  register(name, connector) {
    if (!connector || typeof connector.healthCheck !== "function") {
      throw new Error(`Connector ${name} must expose healthCheck()`);
    }
    this.connectors.set(name, connector);
    logger.info(`Connector registered: ${name}`);
    eventBus.publish("CONNECTOR_REGISTERED", { name });
  }

  get(name) {
    return this.connectors.get(name);
  }

  list() {
    return Array.from(this.connectors.keys());
  }

  async healthCheckAll() {
    const results = [];
    for (const [name, connector] of this.connectors.entries()) {
      try {
        const result = await connector.healthCheck();
        results.push({ name, ...result });
      } catch (error) {
        results.push({
          name,
          status: "ERROR",
          message: error.message,
          checkedAt: new Date().toISOString(),
        });
      }
    }
    return results;
  }
}

module.exports = new ConnectorManager();
