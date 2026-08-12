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
  SELF_DEVELOPMENT: "./WORKER_ADAPTERS/SelfDevelopmentAdapter",
  ATLAS: "./WORKER_ADAPTERS/AtlasWorkerAdapter",
  ARCHITECT: "./WORKER_ADAPTERS/ArchitectAdapter",
  BUILDER: "./WORKER_ADAPTERS/BuilderAdapter",
  VALIDATOR: "./WORKER_ADAPTERS/ValidatorAdapter",
  TESTER: "./WORKER_ADAPTERS/TesterAdapter",
  DEPLOYER: "./WORKER_ADAPTERS/DeployerAdapter",
  RECOVERY: "./WORKER_ADAPTERS/RecoveryAdapter"
});

function bootstrapWorkers() {
  const registered = [];

  for (const [type, modulePath] of Object.entries(WORKERS)) {
    const adapter = materializeAdapter(modulePath);
    registry.register(type, adapter);
    registered.push(type);
  }

  console.log("[WORKERS] Registered:", registry.list());

  return {
    ok: true,
    registered
  };
}

module.exports = bootstrapWorkers;
