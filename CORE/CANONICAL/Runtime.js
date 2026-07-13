"use strict";

const logger = require("./Logger");
const eventBus = require("./EventBus");
const CanonicalRegistry = require("./Registry");
const taskQueue = require("./TaskQueue");

class CanonicalRuntime {
  constructor() {
    this.startedAt = null;
    this.registries = {
      departments: new CanonicalRegistry("Departments"),
      providers: new CanonicalRegistry("Providers"),
      connectors: new CanonicalRegistry("Connectors"),
      capabilities: new CanonicalRegistry("Capabilities")
    };
  }

  start() {
    this.startedAt = new Date().toISOString();

    logger.info("CANONICAL_RUNTIME_STARTED", {
      startedAt: this.startedAt
    });

    eventBus.publish("RUNTIME_STARTED", {
      startedAt: this.startedAt
    });

    return this.status();
  }

  status() {
    return {
      ok: true,
      runtime: "MILES_ENTERPRISE_CANONICAL",
      startedAt: this.startedAt,
      taskQueue: taskQueue.summary(),
      registries: {
        departments: this.registries.departments.list().length,
        providers: this.registries.providers.list().length,
        connectors: this.registries.connectors.list().length,
        capabilities: this.registries.capabilities.list().length
      }
    };
  }
}

module.exports = new CanonicalRuntime();
