"use strict";

const fs = require("fs");
const path = require("path");
const capabilityDispatcher = require("../CapabilityDispatcherService");
const {
  resolveConnectorAction
} = require("../../CORE/ExecutionActionContracts");

const LOCAL_SERVICE_FILES = Object.freeze({
  RepositorySearchService: "SERVICES/RepositorySearchService.js",
  EngineeringImprovementService: "SERVICES/EngineeringImprovementService.js",
  SelfMaintenanceService: "SERVICES/SelfMaintenanceService.js"
});

class ExecutionActionCapabilityService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..");
    this.dispatcher = options.dispatcher || capabilityDispatcher;
  }

  buildDispatchInput(operation = {}, task = {}) {
    const payload = task.payload || {};
    const plan = payload.plan || task.plan || operation.plan || {};
    const action =
      operation.action ||
      operation.capability ||
      task.type ||
      payload.action ||
      plan.action ||
      null;

    const provider =
      operation.provider ||
      payload.provider ||
      plan.provider ||
      null;

    const connector =
      operation.connector ||
      payload.connector ||
      plan.connector ||
      provider ||
      null;

    const department =
      operation.department ||
      payload.department ||
      plan.department ||
      provider ||
      null;

    return {
      task: {
        ...task,
        action,
        provider,
        connector,
        department,
        payload: {
          ...payload,
          action,
          provider,
          connector,
          department,
          plan
        }
      },
      context: {
        action,
        workflow: operation.workflow || payload.workflow || plan.workflow || null,
        capability: operation.capability || payload.capability || plan.capability || null,
        provider,
        connector,
        department,
        plan
      }
    };
  }

  evaluate({ operation = {}, task = {} } = {}) {
    const dispatchInput = this.buildDispatchInput(operation, task);
    let route;

    try {
      route = this.dispatcher.resolve(dispatchInput.task, dispatchInput.context);
    } catch (error) {
      return {
        ok: false,
        code: "ACTION_ROUTE_RESOLUTION_FAILED",
        detail: error.message,
        route: null
      };
    }

    if (!route || route.ok !== true || route.resolved !== true) {
      return {
        ok: false,
        code: "ACTION_ROUTE_UNRESOLVED",
        detail: route?.error || route?.reason || "No executable capability route resolved.",
        route: route || null
      };
    }

    if (route.mode === "SERVICE") {
      const relativeFile = LOCAL_SERVICE_FILES[route.serviceName];
      if (!relativeFile) {
        return {
          ok: false,
          code: "LOCAL_SERVICE_NOT_IN_EXECUTION_CONTRACT",
          detail: { serviceName: route.serviceName, action: route.action },
          route
        };
      }

      const absoluteFile = path.join(this.rootDir, relativeFile);
      if (!fs.existsSync(absoluteFile)) {
        return {
          ok: false,
          code: "LOCAL_SERVICE_SOURCE_MISSING",
          detail: { serviceName: route.serviceName, action: route.action, file: relativeFile },
          route
        };
      }

      return {
        ok: true,
        code: "LOCAL_SERVICE_ACTION_READY",
        detail: { serviceName: route.serviceName, action: route.action, file: relativeFile },
        route
      };
    }

    if (route.mode !== "CONNECTOR") {
      return {
        ok: false,
        code: "EXECUTION_MODE_NOT_SUPPORTED",
        detail: { mode: route.mode, action: route.action },
        route
      };
    }

    const contract = resolveConnectorAction(route.connector, route.action);

    if (!contract.ephemeralConnectorAvailable) {
      return {
        ok: false,
        code: "EPHEMERAL_CONNECTOR_UNAVAILABLE",
        detail: {
          connector: route.connector,
          action: route.action,
          executableConnectors: ["MILES", "INSTANTLY", "ORION"]
        },
        route,
        contract
      };
    }

    if (!contract.supported) {
      return {
        ok: false,
        code: "ACTION_NOT_SUPPORTED",
        detail: {
          connector: route.connector,
          requestedAction: route.action,
          supportedActions: contract.supportedActions
        },
        route,
        contract
      };
    }

    return {
      ok: true,
      code: "CONNECTOR_ACTION_READY",
      detail: {
        connector: contract.connector,
        requestedAction: route.action,
        canonicalAction: contract.canonicalAction
      },
      route,
      contract
    };
  }
}

module.exports = ExecutionActionCapabilityService;
