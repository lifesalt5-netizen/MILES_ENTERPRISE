"use strict";

const registry = require("./WorkerRegistry");

function materializeAdapter(modulePath) {
  const exported = require(modulePath);

  if (exported && typeof exported.execute === "function") {
    return exported;
  }

  if (typeof exported === "function") {
    try {
      const instance = new exported();
      if (instance && typeof instance.execute === "function") {
        return instance;
      }
    } catch (constructorError) {
      try {
        const instance = exported();
        if (instance && typeof instance.execute === "function") {
          return instance;
        }
      } catch (_) {
        // Fall through to explicit validation error below.
      }

      const error = new Error(`INVALID_WORKER_ADAPTER_EXPORT: ${modulePath}`);
      error.cause = constructorError;
      throw error;
    }
  }

  throw new Error(`INVALID_WORKER_ADAPTER_EXPORT: ${modulePath}`);
}

const WORKERS = Object.freeze({
  SELF_DEVELOPMENT: { path: "./WORKER_ADAPTERS/SelfDevelopmentAdapter", required: true },
  ATLAS: { path: "./WORKER_ADAPTERS/AtlasWorkerAdapter", required: false },
  ARCHITECT: { path: "./WORKER_ADAPTERS/ArchitectAdapter", required: true },
  BUILDER: { path: "./WORKER_ADAPTERS/BuilderAdapter", required: true },
  VALIDATOR: { path: "./WORKER_ADAPTERS/ValidatorAdapter", required: false },
  TESTER: { path: "./WORKER_ADAPTERS/TesterAdapter", required: false },
  DEPLOYER: { path: "./WORKER_ADAPTERS/DeployerAdapter", required: false },
  RECOVERY: { path: "./WORKER_ADAPTERS/RecoveryAdapter", required: false }
});

function bootstrapWorkers() {
  const registered = [];
  const skipped = [];

  for (const [type, config] of Object.entries(WORKERS)) {
    try {
      const adapter = materializeAdapter(config.path);
      registry.register(type, adapter);
      registered.push(type);
    } catch (error) {
      if (config.required) {
        error.message = `REQUIRED_WORKER_BOOTSTRAP_FAILED: ${type}: ${error.message}`;
        throw error;
      }

      skipped.push({
        type,
        modulePath: config.path,
        reason: error.message
      });

      console.warn(`[WORKERS] Optional worker skipped: ${type}: ${error.message}`);
    }
  }

  console.log("[WORKERS] Registered:", registry.list());

  return {
    ok: true,
    registered,
    skipped
  };
}

module.exports = bootstrapWorkers;
