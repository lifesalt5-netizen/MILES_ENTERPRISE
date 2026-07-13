"use strict";

/*
  MILES Enterprise
  File: CONNECTORS/MILES/connector.js
  Purpose: Route MILES-native actions to existing internal capability services.
*/

const builder = require("../../SERVICES/capability_builder/AutonomousCapabilityBuilderService");
const repositorySearch = require("../../SERVICES/RepositorySearchService");

const ACTION_HANDLERS = Object.freeze({
  REPOSITORY_SEARCH: repositorySearch,
  CODE_WRITER_CAPABILITY_AUDIT: repositorySearch,
  REPOSITORY_EVIDENCE_REPORT: repositorySearch
});

function resolveAction(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};

  return String(
    task.action ||
    plan.action ||
    payload.action ||
    task.type ||
    "BUILD_CAPABILITY"
  ).toUpperCase();
}

module.exports = {
  name: "MILES",

  async initialize() {
    return {
      ok: true,
      service: "MILES Internal Capability Connector"
    };
  },

  async healthCheck() {
    return {
      status: "OK",
      ok: true,
      service: "MILES Internal Capability Connector",
      message: "Internal capability routing operational.",
      checkedAt: new Date().toISOString()
    };
  },

  async execute(task = {}) {
    const action = resolveAction(task);
    const handler = ACTION_HANDLERS[action] || builder;

    if (typeof handler.execute === "function") {
      return handler.execute(task);
    }

    if (typeof handler.run === "function") {
      return handler.run(task);
    }

    throw new Error(
      `MILES capability "${action}" exposes neither execute() nor run().`
    );
  },

  async shutdown() {
    return { ok: true };
  }
};