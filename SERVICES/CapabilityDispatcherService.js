"use strict";

/*
  MILES ENTERPRISE
  File: SERVICES/CapabilityDispatcherService.js

  Purpose:
    Provide one authoritative capability-to-executor routing layer.

  Responsibilities:
    - Determine which local service or connector owns an action.
    - Preserve planner intent and workflow context.
    - Route repository searches directly to RepositorySearchService.
    - Route engineering proposal work to EngineeringImprovementService.
    - Route self-maintenance work to SelfMaintenanceService.
    - Route ORION actions to the ORION connector.
    - Route supported MILES platform actions to the MILES connector.

  Non-responsibilities:
    - Does not modify TaskQueue status.
    - Does not enforce governance.
    - Does not execute workforce provider tasks.
    - Does not infer intent from natural language.
*/

const LOCAL_SERVICE_LOADERS = {
  RepositorySearchService: () =>
    require("./RepositorySearchService"),

  EngineeringImprovementService: () =>
    require("./EngineeringImprovementService"),

  SelfMaintenanceService: () =>
    require("./SelfMaintenanceService")
};

const REPOSITORY_SEARCH_ACTIONS = new Set([
  "REPOSITORY_SEARCH",
  "CODE_WRITER_CAPABILITY_AUDIT",
  "REPOSITORY_EVIDENCE_REPORT"
]);

const ENGINEERING_ACTIONS = new Set([
  "ENGINEERING_IMPROVEMENT",
  "ENGINEERING_ANALYZE",
  "ENGINEERING_PLAN",
  "ENGINEERING_IMPLEMENT",
  "ENGINEERING_VALIDATE",
  "ENGINEERING_REPORT",
  "ENGINEERING_REPAIR",
  "CAPABILITY_GAP_REVIEW"
]);

const SELF_MAINTENANCE_ACTIONS = new Set([
  "SELF_MAINTENANCE",
  "SELF_MAINTENANCE_DIAGNOSE",
  "SELF_MAINTENANCE_PLAN",
  "SELF_MAINTENANCE_VALIDATE",
  "SELF_MAINTENANCE_REPORT",
  "SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS",
  "SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS"
]);

const ORION_ACTIONS = new Set([
  "ORION_HEALTH",
  "ORION_TABLES",
  "ORION_CONTRACTORS",
  "ORION_BUYERS",
  "ORION_OPPORTUNITIES",
  "ORION_RECOMPETES",
  "ORION_RECOMMENDATIONS",
  "ORION_PERSONAS",
  "ORION_SUMMARY"
]);

const MILES_CONNECTOR_ACTIONS = new Set([
  "SCAN_PROJECT",
  "STATUS",
  "SMOKE_TEST",
  "ANALYZE_PROJECT",
  "BUILD_PLAN",
  "TEST_RUNTIME",
  "BUILD_CONNECTOR",
  "REPOSITORY_REGISTRY",
  "CAPABILITY_REGISTRY",
  "EXECUTIVE_BRAIN",
  "COMPANY_STATE",
  "TASK_ROUTER",
  "COO_LOOP",
  "EXECUTIVE_DASHBOARD",
  "SELF_LEARNING",
  "ACTION_ENGINE",
  "PROVIDER_CONTROLLERS",
  "PROVIDER_CONTROLLER_HEALTH",
  "PROVIDER_CONTROLLER_EXECUTE",
  "INSTANTLY_LIVE",
  "CONTROLLED_WRITE",
  "BUSINESS_EXECUTION",
  "PROVIDER_AUTHORITY",
  "PROVIDER_INTERFACE_ADAPTERS",
  "PROVIDER_CAPABILITY_BINDINGS",
  "PROVIDER_SYNC",
  "WEBSITE_REVIEW"
]);

function normalize(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getPlan(task = {}) {
  const payload = task.payload || {};

  return (
    payload.plan ||
    task.plan ||
    {}
  );
}

function buildServiceRoute({
  action,
  serviceName,
  department = "Engineering",
  reason
}) {
  return {
    ok: true,
    resolved: true,
    mode: "SERVICE",
    action,
    provider: serviceName,
    system: "MILES",
    connector: null,
    department,
    serviceName,
    reason
  };
}

function buildConnectorRoute({
  action,
  provider,
  connector,
  department,
  reason
}) {
  return {
    ok: true,
    resolved: true,
    mode: "CONNECTOR",
    action,
    provider,
    system: provider,
    connector,
    department,
    serviceName: null,
    reason
  };
}

class CapabilityDispatcherService {
  resolve(input = {}, context = {}) {
    const task =
      input && typeof input === "object"
        ? input
        : {};

    const plan =
      context.plan ||
      getPlan(task);

    const requestedAction = normalize(
      context.action ||
      task.action ||
      task.payload?.action ||
      plan.action ||
      task.type
    );

    const workflow = normalize(
      context.workflow ||
      task.workflow ||
      task.payload?.workflow ||
      plan.workflow
    );

    const capability = normalize(
      context.capability ||
      task.capability ||
      task.payload?.capability ||
      plan.capability
    );

    /*
      Workflow-aware routing must occur before generic action routing.

      The current planner may emit REPOSITORY_REGISTRY as the capability
      while preserving ENGINEERING_REPOSITORY_SEARCH as the workflow.
      This dispatcher restores the intended executable action.
    */
    if (
      workflow === "ENGINEERING_REPOSITORY_SEARCH"
    ) {
      return buildServiceRoute({
        action: "REPOSITORY_SEARCH",
        serviceName: "RepositorySearchService",
        department: "Engineering",
        reason:
          "Engineering repository-search workflow routed directly to RepositorySearchService."
      });
    }

    if (
      workflow === "ENGINEERING_CODE_WRITER_AUDIT"
    ) {
      return buildServiceRoute({
        action: "CODE_WRITER_CAPABILITY_AUDIT",
        serviceName: "RepositorySearchService",
        department: "Engineering",
        reason:
          "Code-writer audit workflow routed directly to RepositorySearchService."
      });
    }

    if (
      workflow === "ENGINEERING_SELF_MAINTENANCE"
    ) {
      return buildServiceRoute({
        action:
          SELF_MAINTENANCE_ACTIONS.has(requestedAction)
            ? requestedAction
            : "SELF_MAINTENANCE",
        serviceName: "SelfMaintenanceService",
        department: "Engineering",
        reason:
          "Engineering self-maintenance workflow routed directly to SelfMaintenanceService."
      });
    }

    /*
      Direct repository search actions.
    */
    if (
      REPOSITORY_SEARCH_ACTIONS.has(requestedAction)
    ) {
      return buildServiceRoute({
        action: requestedAction,
        serviceName: "RepositorySearchService",
        department: "Engineering",
        reason:
          "Repository capability is owned by RepositorySearchService."
      });
    }

    /*
      EngineeringImprovementService remains the governed proposal,
      analysis, validation, and reporting engine.
    */
    if (
      ENGINEERING_ACTIONS.has(requestedAction)
    ) {
      return buildServiceRoute({
        action: requestedAction,
        serviceName: "EngineeringImprovementService",
        department: "Engineering",
        reason:
          "Engineering proposal capability is owned by EngineeringImprovementService."
      });
    }

    /*
      Self-maintenance actions execute independently from the engineering
      proposal workflow.
    */
    if (
      SELF_MAINTENANCE_ACTIONS.has(requestedAction)
    ) {
      return buildServiceRoute({
        action: requestedAction,
        serviceName: "SelfMaintenanceService",
        department: "Engineering",
        reason:
          "Self-maintenance capability is owned by SelfMaintenanceService."
      });
    }

    /*
      ORION capabilities remain external connector operations.
    */
    if (
      ORION_ACTIONS.has(requestedAction) ||
      requestedAction.startsWith("ORION_") ||
      capability.startsWith("ORION_")
    ) {
      return buildConnectorRoute({
        action:
          requestedAction ||
          capability ||
          "ORION_HEALTH",
        provider: "ORION",
        connector: "ORION",
        department: "ORION",
        reason:
          "ORION capability routed to the registered ORION connector."
      });
    }

    /*
      Existing MILES platform and business actions continue through the
      registered MILES connector.
    */
    if (
      MILES_CONNECTOR_ACTIONS.has(requestedAction)
    ) {
      return buildConnectorRoute({
        action: requestedAction,
        provider: "MILES",
        connector: "MILES",
        department:
          requestedAction === "BUSINESS_EXECUTION" ||
          requestedAction === "INSTANTLY_LIVE" ||
          requestedAction === "PROVIDER_SYNC"
            ? "Revenue Operations"
            : "Executive",
        reason:
          "Supported MILES capability routed to the registered MILES connector."
      });
    }

    /*
      Preserve a valid planner-supplied connector route when the action is
      not owned by a local service and the planner already supplied a real
      provider and connector.
    */
    const plannedProvider = String(
      context.provider ||
      task.provider ||
      task.payload?.provider ||
      plan.provider ||
      ""
    ).trim();

    const plannedConnector = String(
      context.connector ||
      task.connector ||
      task.payload?.connector ||
      plan.connector ||
      ""
    ).trim();

    const plannedDepartment = String(
      context.department ||
      task.department ||
      task.payload?.department ||
      plan.department ||
      plannedProvider ||
      "Operations"
    ).trim();

    if (
      plannedProvider &&
      plannedProvider !== "UNKNOWN" &&
      plannedConnector &&
      plannedConnector !== "UNKNOWN"
    ) {
      return buildConnectorRoute({
        action:
          requestedAction ||
          capability ||
          "UNKNOWN_ACTION",
        provider: plannedProvider,
        connector: plannedConnector,
        department: plannedDepartment,
        reason:
          "Preserved valid planner-supplied provider and connector route."
      });
    }

    return {
      ok: false,
      resolved: false,
      mode: "UNRESOLVED",
      action:
        requestedAction ||
        capability ||
        "UNKNOWN_ACTION",
      provider: null,
      system: null,
      connector: null,
      department: null,
      serviceName: null,
      reason:
        "No registered capability owner or valid connector route was found.",
      error:
        `CAPABILITY_DISPATCH_UNRESOLVED: ${
          requestedAction ||
          capability ||
          "UNKNOWN_ACTION"
        }`
    };
  }

  loadService(serviceName) {
    const loader =
      LOCAL_SERVICE_LOADERS[serviceName];

    if (!loader) {
      throw new Error(
        `CAPABILITY_SERVICE_NOT_REGISTERED: ${serviceName}`
      );
    }

    const service = loader();

    if (!service) {
      throw new Error(
        `CAPABILITY_SERVICE_LOAD_FAILED: ${serviceName}`
      );
    }

    return service;
  }

  async executeService(route, task = {}) {
    if (
      !route ||
      route.mode !== "SERVICE" ||
      !route.serviceName
    ) {
      throw new Error(
        "CAPABILITY_SERVICE_ROUTE_INVALID"
      );
    }

    const service =
      this.loadService(route.serviceName);

    const dispatchedTask = {
      ...task,
      action: route.action,
      provider: route.provider,
      system: route.system,
      connector: route.connector,
      department: route.department,

      payload: {
        ...(task.payload || {}),
        action: route.action,
        provider: route.provider,
        system: route.system,
        connector: route.connector,
        department: route.department,

        plan: {
          ...(task.payload?.plan || task.plan || {}),
          action: route.action,
          provider: route.provider,
          system: route.system,
          connector: route.connector,
          department: route.department
        }
      }
    };

    if (
      typeof service.execute === "function"
    ) {
      return await service.execute(
        dispatchedTask
      );
    }

    if (
      typeof service.run === "function"
    ) {
      return await service.run(
        dispatchedTask
      );
    }

    if (
      typeof service.report === "function"
    ) {
      return await service.report(
        dispatchedTask
      );
    }

    throw new Error(
      `CAPABILITY_SERVICE_MISSING_EXECUTOR: ${route.serviceName}`
    );
  }

  validate(
    connectorManager =
      require("../CORE/ConnectorManager")
  ) {
    const localServices = [];
    const connectorRoutes = [];
    const errors = [];

    for (
      const serviceName of
      Object.keys(
        LOCAL_SERVICE_LOADERS
      )
    ) {
      try {
        const service =
          this.loadService(
            serviceName
          );

        const executable =
          typeof service.execute ===
            "function" ||
          typeof service.run ===
            "function" ||
          typeof service.report ===
            "function";

        localServices.push({
          serviceName,
          executable
        });

        if (!executable) {
          errors.push(
            `Local capability service has no executor: ${serviceName}`
          );
        }
      } catch (error) {
        localServices.push({
          serviceName,
          executable: false,
          error:
            error.message
        });

        errors.push(
          error.message
        );
      }
    }

    for (
      const connectorName of
      ["MILES", "ORION"]
    ) {
      const connector =
        connectorManager.get(
          connectorName
        );

      const validation =
        connector
          ? connectorManager
              .validateConnector(
                connectorName,
                connector
              )
          : {
              ok: false,
              name:
                connectorName,
              errors: [
                "connector is not registered"
              ]
            };

      connectorRoutes.push(
        validation
      );

      if (!validation.ok) {
        errors.push(
          `Connector route unavailable: ${connectorName}`
        );
      }
    }

    const routeChecks = [
      this.resolve({
        action:
          "ORION_HEALTH"
      }),
      this.resolve({
        action:
          "BUSINESS_EXECUTION"
      }),
      this.resolve({
        action:
          "REPOSITORY_SEARCH"
      })
    ];

    for (
      const route of
      routeChecks
    ) {
      if (
        !route.resolved ||
        route.ok !== true
      ) {
        errors.push(
          `Capability route unresolved: ${route.action}`
        );
      }
    }

    return {
      ok:
        errors.length === 0,

      localServices,
      connectorRoutes,
      routeChecks,
      errors
    };
  }

  describe() {
    return {
      ok: true,
      service:
        "CapabilityDispatcherService",

      localServices: {
        RepositorySearchService:
          Array.from(
            REPOSITORY_SEARCH_ACTIONS
          ),

        EngineeringImprovementService:
          Array.from(
            ENGINEERING_ACTIONS
          ),

        SelfMaintenanceService:
          Array.from(
            SELF_MAINTENANCE_ACTIONS
          )
      },

      connectors: {
        ORION:
          Array.from(
            ORION_ACTIONS
          ),

        MILES:
          Array.from(
            MILES_CONNECTOR_ACTIONS
          )
      },

      workflowOverrides: {
        ENGINEERING_REPOSITORY_SEARCH:
          "RepositorySearchService:REPOSITORY_SEARCH",

        ENGINEERING_CODE_WRITER_AUDIT:
          "RepositorySearchService:CODE_WRITER_CAPABILITY_AUDIT",

        ENGINEERING_SELF_MAINTENANCE:
          "SelfMaintenanceService:SELF_MAINTENANCE"
      }
    };
  }
}

module.exports =
  new CapabilityDispatcherService();


