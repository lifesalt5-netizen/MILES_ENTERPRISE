"use strict";

/**
 * MILES Builder Service
 * EXEC_004 compatible replacement dispatcher.
 */

class BuilderService {
  async execute(task = {}) {
    const action = (task.action || task.type || "SCAN_PROJECT").toUpperCase();
    const commands = {
      SCAN_PROJECT: () => require("./ProjectScanner").writeReport(),
      STATUS: () => ({ ok: true, action, generatedAt: new Date().toISOString() }),
      REPOSITORY_REGISTRY: () => require("../SERVICES/RepositoryRegistryService").run(task),
      CAPABILITY_REGISTRY: () => require("../SERVICES/CapabilityRegistryService").run(task),
      EXECUTIVE_BRAIN: () => require("../SERVICES/ExecutiveBrainService").run(task),
      COMPANY_STATE: () => require("../SERVICES/CompanyStateService").run(task),
      TASK_ROUTER: () => require("../SERVICES/TaskRouterService").run(task),
      COO_LOOP: () => require("../SERVICES/ContinuousCOOLoopService").run(task),
      EXECUTIVE_DASHBOARD: () => require("../SERVICES/ExecutiveDashboardService").run(task),
      SELF_LEARNING: () => require("../SERVICES/SelfLearningService").run(task),
      ACTION_ENGINE: () => require("../SERVICES/ActionEngineService").run(task),
      PROVIDER_CONTROLLERS: () => require("../SERVICES/ProviderControllerRegistryService").run(task),
      PROVIDER_CONTROLLER_HEALTH: () => require("../SERVICES/ProviderControllerHealthService").run(task),
      INSTANTLY_LIVE: () => require("../SERVICES/InstantlyLiveIntegrationService").run(task),
      CONTROLLED_WRITE: () => require("../SERVICES/ControlledWriteService").run(task),
      CONTROLLED_WRITE_POLICY: () => require("../SERVICES/ControlledWritePolicyService").run(task),
      CONTROLLED_WRITE_AUDIT: () => require("../SERVICES/ControlledWriteAuditService").run(task)
    };
    if (!commands[action]) {
      return { ok: false, action, error: `Unsupported builder action: ${action}`, supportedActions: Object.keys(commands) };
    }
    return await commands[action]();
  }
}
module.exports = new BuilderService();
