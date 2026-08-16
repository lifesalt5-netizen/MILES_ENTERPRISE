"use strict";

/*
  MILES Enterprise
  File: CONNECTORS/MILES/connector.js
  Canonical production policy:
  - Do not eagerly load the business execution/capability-building stack at connector registration.
  - Resolve each action handler only when that action is executed.
  - Cache resolved handlers after first use.
  - Supported action truth comes from CORE/ExecutionActionContracts.
*/

const {
  MILES_ACTIONS,
  normalizeMilesAction
} = require("../../CORE/ExecutionActionContracts");

const HANDLER_PATHS = Object.freeze({
  BUSINESS_EXECUTION: "../../SERVICES/BusinessExecutionEngineServiceV2",
  PROVIDER_AUTHORITY: "../../SERVICES/ProviderAuthorityRegistryService",
  PROVIDER_AUTHORITY_REGISTRY: "../../SERVICES/ProviderAuthorityRegistryService",
  PROVIDER_SYNC: "../../SERVICES/ProviderSynchronizationService",
  PROVIDER_SYNCHRONIZATION: "../../SERVICES/ProviderSynchronizationService",
  INSTANTLY_LIVE: "../../SERVICES/InstantlyLiveIntegrationService",
  CONTROLLED_WRITE: "../../SERVICES/ControlledWriteService",
  BUILD_CAPABILITY: "../../SERVICES/capability_builder/AutonomousCapabilityBuilderService",
  CAPABILITY_BUILD: "../../SERVICES/capability_builder/AutonomousCapabilityBuilderService",
  AUTONOMOUS_CAPABILITY_BUILD: "../../SERVICES/capability_builder/AutonomousCapabilityBuilderService",
  REPOSITORY_SEARCH: "../../SERVICES/RepositorySearchService",
  CODE_WRITER_CAPABILITY_AUDIT: "../../SERVICES/RepositorySearchService",
  REPOSITORY_EVIDENCE_REPORT: "../../SERVICES/RepositorySearchService"
});

const HANDLER_CACHE = new Map();

function resolveAction(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};
  const requested =
    task.action ||
    payload.action ||
    plan.action ||
    task.type ||
    "BUILD_CAPABILITY";
  return normalizeMilesAction(requested) || String(requested).trim().toUpperCase();
}

function loadHandler(action) {
  const modulePath = HANDLER_PATHS[action];
  if (!modulePath) return null;
  if (HANDLER_CACHE.has(modulePath)) return HANDLER_CACHE.get(modulePath);
  const handler = require(modulePath);
  HANDLER_CACHE.set(modulePath, handler);
  return handler;
}

async function invokeHandler(handler, task, action) {
  if (handler && typeof handler.execute === "function") return handler.execute(task);
  if (handler && typeof handler.run === "function") return handler.run(task);
  if (typeof handler === "function") return handler(task);
  throw new Error(`MILES handler for "${action}" exposes neither execute() nor run().`);
}

function contractIntegrity() {
  const contract = [...MILES_ACTIONS].sort();
  const handlers = Object.keys(HANDLER_PATHS).sort();
  const missingHandlers = contract.filter(action => !HANDLER_PATHS[action]);
  const undeclaredHandlers = handlers.filter(action => !MILES_ACTIONS.includes(action));
  return {
    ok: missingHandlers.length === 0 && undeclaredHandlers.length === 0,
    missingHandlers,
    undeclaredHandlers
  };
}

module.exports = {
  name: "MILES",
  supportedActions: [...MILES_ACTIONS],
  canExecuteAction(action) {
    return Boolean(normalizeMilesAction(action) && HANDLER_PATHS[normalizeMilesAction(action)]);
  },
  contractIntegrity,

  async initialize() {
    const integrity = contractIntegrity();
    return {
      ok: integrity.ok,
      status: integrity.ok ? "READY" : "ACTION_CONTRACT_MISMATCH",
      service: "MILES Internal Capability Connector",
      supportedActions: [...MILES_ACTIONS],
      lazyHandlers: true,
      handlersLoaded: HANDLER_CACHE.size,
      contractIntegrity: integrity,
      initializedAt: new Date().toISOString()
    };
  },

  async healthCheck() {
    const integrity = contractIntegrity();
    return {
      status: integrity.ok ? "OK" : "ERROR",
      ok: integrity.ok,
      service: "MILES Internal Capability Connector",
      message: integrity.ok
        ? "Explicit MILES business and capability routing operational."
        : "MILES action contract and handler map disagree.",
      supportedActionCount: MILES_ACTIONS.length,
      lazyHandlers: true,
      handlersLoaded: HANDLER_CACHE.size,
      contractIntegrity: integrity,
      checkedAt: new Date().toISOString()
    };
  },

  async execute(task = {}) {
    const action = resolveAction(task);
    const handler = loadHandler(action);
    if (!handler) {
      const supportedActions = [...MILES_ACTIONS].sort();
      const error = new Error(
        `Unsupported MILES connector action: ${action}. Supported actions: ${supportedActions.join(", ")}`
      );
      error.code = "MILES_ACTION_NOT_SUPPORTED";
      error.action = action;
      error.supportedActions = supportedActions;
      throw error;
    }
    return invokeHandler(handler, task, action);
  },

  async shutdown() {
    for (const handler of new Set(HANDLER_CACHE.values())) {
      try {
        if (handler && typeof handler.shutdown === "function") await handler.shutdown();
        else if (handler && typeof handler.stop === "function") await handler.stop();
      } catch {}
    }
    HANDLER_CACHE.clear();
    return {
      ok: true,
      status: "SHUTDOWN",
      service: "MILES Internal Capability Connector",
      shutdownAt: new Date().toISOString()
    };
  }
};
