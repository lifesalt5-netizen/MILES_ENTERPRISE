"use strict";

const fs = require("fs");
const path = require("path");
const ConfigService = require("./ConfigService");

class RuntimeActivationAuditService {
    constructor() {
        this.root = ConfigService.getRoot();
        this.servicesDir = ConfigService.getServicesPath();
    }

    exists(relativePath) {
        return fs.existsSync(path.join(this.root, relativePath));
    }

    audit() {
        const checks = [
            ["Core", "ConfigService", "SERVICES/ConfigService.js"],
            ["Core", "WorkerRegistry", "SERVICES/WorkerRegistry.js"],
            ["Core", "WorkerSelector", "SERVICES/WorkerSelector.js"],
            ["Core", "MissionCapabilityResolver", "SERVICES/MissionCapabilityResolver.js"],

            ["Runtime", "WorkerRuntime", "SERVICES/worker_runtime/WorkerRuntime.js"],
            ["Runtime", "WorkerDispatcher", "SERVICES/worker_runtime/WorkerDispatcher.js"],
            ["Runtime", "AutonomousWorkOrchestrator", "SERVICES/worker_runtime/AutonomousWorkOrchestrator.js"],

            ["Business Worker", "InstantlyCOOWorker", "SERVICES/workers/InstantlyCOOWorker.js"],
            ["Business Worker", "GoogleWorkspaceCOOWorker", "SERVICES/workers/GoogleWorkspaceCOOWorker.js"],
            ["Business Worker", "WebsiteCOOWorker", "SERVICES/workers/WebsiteCOOWorker.js"],
            ["Business Worker", "NamecheapCOOWorker", "SERVICES/workers/NamecheapCOOWorker.js"],

            ["Provider", "InstantlyProviderController", "SERVICES/InstantlyProviderController.js"],
            ["Provider", "GoogleWorkspaceProviderController", "SERVICES/GoogleWorkspaceProviderController.js"],
            ["Provider", "WebsiteProviderController", "SERVICES/WebsiteProviderController.js"],
            ["Provider", "OrionProviderController", "SERVICES/OrionProviderController.js"],
            ["Provider", "NamecheapProviderController", "SERVICES/NamecheapProviderController.js"],

            ["Browser", "BrowserSessionManager", "SERVICES/Browser/BrowserSessionManager.js"],
            ["Browser", "BrowserSessionEnroller", "SERVICES/Browser/BrowserSessionEnroller.js"],
            ["Browser", "InstantlyCampaignOperator", "SERVICES/Browser/Workers/InstantlyCampaignOperator.js"],

            ["Executive", "ExecutivePlanner", "SERVICES/Planning/ExecutivePlanner.js"],
            ["Executive", "ExecutiveSupervisor", "SERVICES/Supervisor/ExecutiveSupervisor.js"],
            ["Executive", "ExecutiveMissionRouter", "SERVICES/ExecutiveMissionRouter.js"],

            ["Learning", "SelfLearningService", "SERVICES/SelfLearningService.js"],
            ["Learning", "FailureLearningService", "SERVICES/FailureLearningService.js"],
            ["Learning", "LearningDataService", "SERVICES/LearningDataService.js"]
        ];

        const results = checks.map(([group, name, file]) => ({
            group,
            name,
            file,
            exists: this.exists(file),
            status: this.exists(file) ? "FOUND" : "MISSING"
        }));

        return {
            ok: true,
            generatedAt: new Date().toISOString(),
            root: this.root,
            totalChecked: results.length,
            found: results.filter(r => r.exists).length,
            missing: results.filter(r => !r.exists).length,
            results
        };
    }
}

module.exports = new RuntimeActivationAuditService();