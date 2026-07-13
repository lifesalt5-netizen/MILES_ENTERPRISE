"use strict";

/**
 * MILES Builder Service
 * EXEC_003 cumulative replacement.
 */

class BuilderService {
    safeRequire(modulePath) {
        try { return require(modulePath); }
        catch (error) {
            return { run: async () => ({ ok: false, error: error.message, modulePath }) };
        }
    }

    async execute(task = {}) {
        const action = String(task.action || task.type || "SCAN_PROJECT").toUpperCase();
        const commands = {
            SCAN_PROJECT: () => this.safeRequire("./ProjectScanner").writeReport ? this.safeRequire("./ProjectScanner").writeReport() : { ok:false, error:"ProjectScanner not available" },
            STATUS: () => ({ ok: true, action, generatedAt: new Date().toISOString() }),
            SMOKE_TEST: () => ({ ok: true, action, generatedAt: new Date().toISOString() }),
            ANALYZE_PROJECT: () => this.safeRequire("./ProjectAnalyzer").writeReport(),
            BUILD_PLAN: () => this.safeRequire("./BuildPlanner").run(task),
            TEST_RUNTIME: () => this.safeRequire("./RuntimeController").fullTest(),
            BUILD_CONNECTOR: () => this.safeRequire("./ConnectorBuilder").run(task),
            REPOSITORY_REGISTRY: () => this.safeRequire("../SERVICES/RepositoryRegistryService").run(task),
            CAPABILITY_REGISTRY: () => this.safeRequire("../SERVICES/CapabilityRegistryService").run(task),
            EXECUTIVE_BRAIN: () => this.safeRequire("../SERVICES/ExecutiveBrainService").run(task),
            COMPANY_STATE: () => this.safeRequire("../SERVICES/CompanyStateService").run(task),
            TASK_ROUTER: () => this.safeRequire("../SERVICES/TaskRouterService").run(task),
            COO_LOOP: () => this.safeRequire("../SERVICES/ContinuousCOOLoopService").run(task),
            EXECUTIVE_DASHBOARD: () => this.safeRequire("../SERVICES/ExecutiveDashboardService").run(task),
            DASHBOARD_SERVER: () => this.safeRequire("../SERVICES/DashboardServerService").run(task),
            SELF_LEARNING: () => this.safeRequire("../SERVICES/SelfLearningService").run(task),
            ACTION_ENGINE: () => this.safeRequire("../SERVICES/ActionEngineService").run(task),
            PROVIDER_CONTROLLERS: () => this.safeRequire("../SERVICES/ProviderControllerRegistryService").run(task),
            PROVIDER_CONTROLLER_HEALTH: () => this.safeRequire("../SERVICES/ProviderControllerHealthService").run(task),
            PROVIDER_CONTROLLER_EXECUTE: () => this.safeRequire("../SERVICES/ProviderControllerExecutionService").run(task),
            INSTANTLY_LIVE: () => this.safeRequire("../SERVICES/InstantlyLiveIntegrationService").run(task),
            INSTANTLY_HEALTH: () => this.safeRequire("../SERVICES/InstantlyLiveIntegrationService").run({ ...task, operation: "HEALTH_CHECK" }),
            INSTANTLY_BRIDGE_ACTION: () => this.safeRequire("../SERVICES/InstantlyActionBridgeService").runLatestActionEngineInstantlyAction(task)
        };
        if (!commands[action]) {
            return { ok: false, action, error: `Unsupported builder action: ${action}`, supportedActions: Object.keys(commands) };
        }
        return await commands[action]();
    }
}

module.exports = new BuilderService();
