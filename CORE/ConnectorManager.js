"use strict";

const logger = require("./Logger");
const eventBus = require("./EventBus");

function normalizeName(name) {
  const normalized = String(name || "")
    .trim()
    .toUpperCase();

  if (!normalized) {
    throw new Error("Connector name is required.");
  }

  return normalized;
}

class ConnectorManager {
  constructor() {
    this.connectors = new Map();
  }

  validateConnector(name, connector) {
    const normalizedName = normalizeName(name);
    const errors = [];

    if (!connector || typeof connector !== "object") {
      errors.push("connector must be an object");
    } else {
      if (typeof connector.healthCheck !== "function") {
        errors.push("healthCheck() is required");
      }

      if (typeof connector.execute !== "function") {
        errors.push("execute() is required");
      }
    }

    return {
      ok: errors.length === 0,
      name: normalizedName,
      errors
    };
  }

  register(name, connector) {
    const validation = this.validateConnector(name, connector);

    if (!validation.ok) {
      throw new Error(
        `Connector ${validation.name} is invalid: ${validation.errors.join(", ")}`
      );
    }

    const existing = this.connectors.get(validation.name);

    if (existing && existing !== connector) {
      throw new Error(
        `Connector already registered with a different implementation: ${validation.name}`
      );
    }

    if (existing === connector) {
      return existing;
    }

    this.connectors.set(validation.name, connector);
    logger.info(`Connector registered: ${validation.name}`);
    eventBus.publish("CONNECTOR_REGISTERED", {
      name: validation.name
    });

    return connector;
  }

  unregister(name) {
    return this.connectors.delete(normalizeName(name));
  }

  has(name) {
    if (name === null || name === undefined || String(name).trim() === "") {
      return false;
    }

    return this.connectors.has(normalizeName(name));
  }

  get(name) {
    if (name === null || name === undefined || String(name).trim() === "") {
      return undefined;
    }

    return this.connectors.get(normalizeName(name));
  }

  list() {
    return Array.from(this.connectors.keys()).sort();
  }

  validateAll() {
    const connectors = this.list().map(name =>
      this.validateConnector(name, this.connectors.get(name))
    );

    return {
      ok:
        connectors.length > 0 &&
        connectors.every(connector => connector.ok),
      connectorCount: connectors.length,
      connectors,
      checkedAt: new Date().toISOString()
    };
  }

  async healthCheckAll() {
    const results = [];

    for (const name of this.list()) {
      const connector = this.connectors.get(name);

      try {
        const result = await connector.healthCheck();

        results.push({
          name,
          ...result,
          ok: result?.ok !== false
        });
      } catch (error) {
        results.push({
          name,
          ok: false,
          status: "ERROR",
          message: error.message,
          checkedAt: new Date().toISOString()
        });
      }
    }

    return results;
  }
}

module.exports = new ConnectorManager();
