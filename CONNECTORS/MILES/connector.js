"use strict";

/*
  MILES Enterprise
  File: CONNECTORS/MILES/connector.js

  Purpose:
  Route MILES-native connector actions to their authoritative
  internal execution services.

  Routing policy:
  - Business orchestration actions go to runtime business services.
  - Capability-building actions go to the autonomous capability builder.
  - Repository actions go to RepositorySearchService.
  - Unsupported actions fail explicitly and are never silently rerouted.
*/

const businessExecutionEngine =
  require("../../SERVICES/BusinessExecutionEngineService");

const providerAuthority =
  require("../../SERVICES/ProviderAuthorityRegistryService");

const providerSynchronization =
  require("../../SERVICES/ProviderSynchronizationService");

const instantlyLive =
  require("../../SERVICES/InstantlyLiveIntegrationService");

const controlledWrite =
  require("../../SERVICES/ControlledWriteService");

const builder =
  require("../../SERVICES/capability_builder/AutonomousCapabilityBuilderService");

const repositorySearch =
  require("../../SERVICES/RepositorySearchService");

/*
  Authoritative MILES connector routing.

  BUSINESS_EXECUTION owns the complete orchestration sequence.

  The individual phase routes remain available because
  CapabilityDispatcherService may dispatch them independently.
*/
const ACTION_HANDLERS = Object.freeze({
  BUSINESS_EXECUTION:
    businessExecutionEngine,

  PROVIDER_AUTHORITY:
    providerAuthority,

  PROVIDER_AUTHORITY_REGISTRY:
    providerAuthority,

  PROVIDER_SYNC:
    providerSynchronization,

  PROVIDER_SYNCHRONIZATION:
    providerSynchronization,

  INSTANTLY_LIVE:
    instantlyLive,

  CONTROLLED_WRITE:
    controlledWrite,

  BUILD_CAPABILITY:
    builder,

  CAPABILITY_BUILD:
    builder,

  AUTONOMOUS_CAPABILITY_BUILD:
    builder,

  REPOSITORY_SEARCH:
    repositorySearch,

  CODE_WRITER_CAPABILITY_AUDIT:
    repositorySearch,

  REPOSITORY_EVIDENCE_REPORT:
    repositorySearch
});

function resolveAction(task = {}) {
  const payload =
    task.payload || {};

  const plan =
    payload.plan ||
    task.plan ||
    {};

  return String(
    task.action ||
    payload.action ||
    plan.action ||
    task.type ||
    "BUILD_CAPABILITY"
  )
    .trim()
    .toUpperCase();
}

async function invokeHandler(
  handler,
  task,
  action
) {
  if (
    handler &&
    typeof handler.execute === "function"
  ) {
    return handler.execute(task);
  }

  if (
    handler &&
    typeof handler.run === "function"
  ) {
    return handler.run(task);
  }

  if (typeof handler === "function") {
    return handler(task);
  }

  throw new Error(
    `MILES handler for "${action}" exposes neither execute() nor run().`
  );
}

module.exports = {
  name: "MILES",

  async initialize() {
    return {
      ok: true,
      status: "READY",
      service:
        "MILES Internal Capability Connector",
      supportedActions:
        Object.keys(ACTION_HANDLERS),
      initializedAt:
        new Date().toISOString()
    };
  },

  async healthCheck() {
    return {
      status: "OK",
      ok: true,
      service:
        "MILES Internal Capability Connector",
      message:
        "Explicit MILES business and capability routing operational.",
      supportedActionCount:
        Object.keys(ACTION_HANDLERS).length,
      checkedAt:
        new Date().toISOString()
    };
  },

  async execute(task = {}) {
    const action =
      resolveAction(task);

    const handler =
      ACTION_HANDLERS[action];

    if (!handler) {
      const supportedActions =
        Object.keys(ACTION_HANDLERS)
          .sort();

      const error =
        new Error(
          `Unsupported MILES connector action: ${action}. ` +
          `Supported actions: ${supportedActions.join(", ")}`
        );

      error.code =
        "MILES_ACTION_NOT_SUPPORTED";

      error.action =
        action;

      error.supportedActions =
        supportedActions;

      throw error;
    }

    return invokeHandler(
      handler,
      task,
      action
    );
  },

  async shutdown() {
    return {
      ok: true,
      status: "SHUTDOWN",
      service:
        "MILES Internal Capability Connector",
      shutdownAt:
        new Date().toISOString()
    };
  }
};
