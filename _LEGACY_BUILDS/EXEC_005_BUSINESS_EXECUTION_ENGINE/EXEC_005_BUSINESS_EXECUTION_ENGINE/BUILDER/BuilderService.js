"use strict";

function safeRequire(path) {
    try { return require(path); } catch (error) { return null; }
}

class BuilderService {
    async execute(task = {}) {
        const action = (task.action || task.type || "SCAN_PROJECT").toUpperCase();
        const map = {
            SCAN_PROJECT: ["./ProjectScanner", "writeReport"],
            STATUS: ["./GitManager", "status"],
            SMOKE_TEST: ["./RuntimeController", "smokeTest"],
            ANALYZE_PROJECT: ["./ProjectAnalyzer", "writeReport"],
            BUILD_PLAN: ["./BuildPlanner", "run"],
            TEST_RUNTIME: ["./RuntimeController", "fullTest"],
            BUILD_CONNECTOR: ["./ConnectorBuilder", "run"],
            REPOSITORY_REGISTRY: ["../SERVICES/RepositoryRegistryService", "run"],
            CAPABILITY_REGISTRY: ["../SERVICES/CapabilityRegistryService", "run"],
            EXECUTIVE_BRAIN: ["../SERVICES/ExecutiveBrainService", "run"],
            COMPANY_STATE: ["../SERVICES/CompanyStateService", "run"],
            TASK_ROUTER: ["../SERVICES/TaskRouterService", "run"],
            COO_LOOP: ["../SERVICES/ContinuousCOOLoopService", "run"],
            EXECUTIVE_DASHBOARD: ["../SERVICES/ExecutiveDashboardService", "run"],
            SELF_LEARNING: ["../SERVICES/SelfLearningService", "run"],
            ACTION_ENGINE: ["../SERVICES/ActionEngineService", "run"],
            PROVIDER_CONTROLLERS: ["../SERVICES/ProviderControllerRegistryService", "run"],
            PROVIDER_CONTROLLER_HEALTH: ["../SERVICES/ProviderControllerHealthService", "run"],
            PROVIDER_CONTROLLER_EXECUTION: ["../SERVICES/ProviderControllerExecutionService", "run"],
            INSTANTLY_LIVE: ["../SERVICES/InstantlyLiveIntegrationService", "run"],
            CONTROLLED_WRITE: ["../SERVICES/ControlledWriteService", "run"],
            BUSINESS_EXECUTION_ENGINE: ["../SERVICES/BusinessExecutionEngineService", "run"]
        };
        const target = map[action];
        if (!target) return { ok: false, action, error: `Unsupported builder action: ${action}`, supportedActions: Object.keys(map) };
        const mod = safeRequire(target[0]);
        if (!mod) return { ok: false, action, error: `Module not available: ${target[0]}`, supportedActions: Object.keys(map) };
        const fn = mod[target[1]];
        if (typeof fn !== "function") return { ok: false, action, error: `Function not available: ${target[1]} on ${target[0]}` };
        return await fn.call(mod, task);
    }
}

module.exports = new BuilderService();
