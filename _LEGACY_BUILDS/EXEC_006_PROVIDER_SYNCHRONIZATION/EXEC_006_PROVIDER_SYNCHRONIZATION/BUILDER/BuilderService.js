"use strict";

/**
 * MILES Builder Service
 * EXEC_006 Provider Synchronization
 * Complete replacement file.
 */

const scanner = require("./ProjectScanner");
const git = require("./GitManager");
const runtime = require("./RuntimeController");

class BuilderService {

    scanProject() {
        return scanner.writeReport();
    }

    status() {
        return {
            generatedAt: new Date().toISOString(),
            branch: git.currentBranch(),
            gitStatus: git.status()
        };
    }

    smokeTest() {
        return runtime.smokeTest();
    }

    async execute(task = {}) {
        const action = (task.action || task.type || "SCAN_PROJECT").toUpperCase();

        const commands = {

            SCAN_PROJECT: () => {
                const { outFile, report } = this.scanProject();
                return {
                    ok: true,
                    action,
                    outFile,
                    totalFiles: report.totalFiles,
                    summary: report.summary
                };
            },

            STATUS: () => ({
                ok: true,
                action,
                status: this.status()
            }),

            SMOKE_TEST: () => ({
                ok: true,
                action,
                result: this.smokeTest()
            }),

            ANALYZE_PROJECT: () => {
                const { outFile, result } =
                    require("./ProjectAnalyzer").writeReport();

                return {
                    ok: true,
                    action: "ANALYZE_PROJECT",
                    outFile,
                    analysis: result
                };
            },

            BUILD_PLAN: () =>
                require("./BuildPlanner").run(),

            TEST_RUNTIME: () =>
                require("./RuntimeController").fullTest(),

            BUILD_CONNECTOR: () =>
                require("./ConnectorBuilder").run(task),

            REPOSITORY_REGISTRY: () =>
                require("../SERVICES/RepositoryRegistryService").run(task),

            CAPABILITY_REGISTRY: () =>
                require("../SERVICES/CapabilityRegistryService").run(task),

            EXECUTIVE_BRAIN: () =>
                require("../SERVICES/ExecutiveBrainService").run(task),

            COMPANY_STATE: () =>
                require("../SERVICES/CompanyStateService").run(task),

            TASK_ROUTER: () =>
                require("../SERVICES/TaskRouterService").run(task),

            COO_LOOP: () =>
                require("../SERVICES/ContinuousCOOLoopService").run(task),

            EXECUTIVE_DASHBOARD: () =>
                require("../SERVICES/ExecutiveDashboardService").run(task),

            SELF_LEARNING: () =>
                require("../SERVICES/SelfLearningService").run(task),

            ACTION_ENGINE: () =>
                require("../SERVICES/ActionEngineService").run(task),

            PROVIDER_CONTROLLERS: () =>
                require("../SERVICES/ProviderControllerRegistryService").run(task),

            PROVIDER_CONTROLLER_HEALTH: () =>
                require("../SERVICES/ProviderControllerHealthService").run(task),

            PROVIDER_CONTROLLER_EXECUTE: () =>
                require("../SERVICES/ProviderControllerExecutionService").run(task),

            INSTANTLY_LIVE: () =>
                require("../SERVICES/InstantlyLiveIntegrationService").run(task),

            CONTROLLED_WRITE: () =>
                require("../SERVICES/ControlledWriteService").run(task),

            BUSINESS_EXECUTION: () =>
                require("../SERVICES/BusinessExecutionEngineService").run(task),

            PROVIDER_AUTHORITY: () =>
                require("../SERVICES/ProviderAuthorityRegistryService").run(task),

            PROVIDER_INTERFACE_ADAPTERS: () =>
                require("../SERVICES/ProviderInterfaceAdapterService").run(task),

            PROVIDER_CAPABILITY_BINDINGS: () =>
                require("../SERVICES/ProviderCapabilityBindingService").run(task),

            PROVIDER_SYNC: () =>
                require("../SERVICES/ProviderSynchronizationService").run(task)
        };

        if (!commands[action]) {
            return {
                ok: false,
                action,
                error: `Unsupported builder action: ${action}`,
                supportedActions: Object.keys(commands)
            };
        }

        return await commands[action]();
    }
}

module.exports = new BuilderService();
