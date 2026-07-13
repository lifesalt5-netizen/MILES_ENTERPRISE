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
        const action = (
            task.action ||
            task.type ||
            task.payload?.action ||
            task.payload?.plan?.action ||
            "SCAN_PROJECT"
        ).toUpperCase();

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
                require("../SERVICES/ProviderSynchronizationService").run(task),

            ENGINEERING_IMPROVEMENT: () =>
                require("../SERVICES/EngineeringImprovementService").run(task),

            ENGINEERING_ANALYZE: () =>
                require("../SERVICES/EngineeringImprovementService").analyze(task),

            ENGINEERING_PLAN: () =>
                require("../SERVICES/EngineeringImprovementService").plan(task),

            ENGINEERING_IMPLEMENT: () =>
                require("../SERVICES/EngineeringImprovementService").implement(task),

            ENGINEERING_VALIDATE: () =>
                require("../SERVICES/EngineeringImprovementService").validate(task),

            ENGINEERING_REPORT: () =>
                require("../SERVICES/EngineeringImprovementService").report(task),

            SELF_MAINTENANCE: () =>
                require("../SERVICES/SelfMaintenanceService").run(task),

            SELF_MAINTENANCE_DIAGNOSE: () =>
                require("../SERVICES/SelfMaintenanceService").diagnose(task),

            SELF_MAINTENANCE_PLAN: () =>
                require("../SERVICES/SelfMaintenanceService").planRepair(task),

            SELF_MAINTENANCE_VALIDATE: () =>
                require("../SERVICES/SelfMaintenanceService").validate(task),

            SELF_MAINTENANCE_REPORT: () =>
                require("../SERVICES/SelfMaintenanceService").report(task),

            REPOSITORY_SEARCH: () =>
                require("../SERVICES/RepositorySearchService").run(task),

            CODE_WRITER_CAPABILITY_AUDIT: () =>
                require("../SERVICES/RepositorySearchService").run(task),

            REPOSITORY_EVIDENCE_REPORT: () =>
                require("../SERVICES/RepositorySearchService").run(task),

            WEBSITE_REVIEW: () => ({
                ok: true,
                service: "WebsiteReviewService",
                status: "PENDING_IMPLEMENTATION",
                message: "Website review workflow recognized. Capability is registered but not yet implemented.",
                action: "WEBSITE_REVIEW",
                provider: "Website",
                connector: "MILES",
                receivedAt: new Date().toISOString()
            })
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