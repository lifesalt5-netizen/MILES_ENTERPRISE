"use strict";

/**
 * MILES Learning Data Service
 * BUILD_038
 * Reads runtime history produced by BUILD_033 through BUILD_037.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "DATA");

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function readJsonRelative(relativePath, fallback) {
    return readJson(path.join(DATA, ...relativePath.split(/[\\/]+/)), fallback);
}

function normalizeArray(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.items)) return value.items;
    return [];
}

class LearningDataService {
    collect() {
        const executiveDecisionLog = readJsonRelative("executive_brain/executive_brain_decisions.json", []);
        const latestExecutiveDecision = readJsonRelative("executive_brain/latest_executive_decision.json", {});
        const companyState = readJsonRelative("company_state/company_state.json", {});
        const taskRouterHistory = readJsonRelative("task_router/task_router_history.json", []);
        const latestTaskRouterRun = readJsonRelative("task_router/latest_task_router_run.json", {});
        const workQueueFile = readJsonRelative("runtime/work_queue.json", { items: [] });
        const workQueueArchive = readJsonRelative("runtime/work_queue_archive.json", []);
        const latestCOOCycle = readJsonRelative("runtime/latest_coo_cycle.json", {});
        const cooCycleHistory = readJsonRelative("runtime/coo_cycle_history.json", []);
        const runtimeHealth = readJsonRelative("runtime/latest_runtime_health.json", latestCOOCycle.runtimeHealth || {});
        const dashboardState = readJsonRelative("executive_dashboard/dashboard_state.json", {});
        const resolutionHistory = readJsonRelative(
    "self_learning/resolution_history.json",
    []
);

        return {
            ok: true,
            generatedAt: new Date().toISOString(),
            executive: {
                decisions: normalizeArray(executiveDecisionLog),
                latest: latestExecutiveDecision
            },
            companyState,
            routing: {
                history: normalizeArray(taskRouterHistory),
                latest: latestTaskRouterRun
            },
            queue: {
                current: normalizeArray(workQueueFile),
                archive: normalizeArray(workQueueArchive),
                metadata: workQueueFile.metadata || {}
            },
            runtime: {
                latestCOOCycle,
                cooCycleHistory: normalizeArray(cooCycleHistory),
                runtimeHealth
            },learning: {
    resolutions: normalizeArray(resolutionHistory)
},
            dashboard: dashboardState

        };
    }
}

module.exports = new LearningDataService();
