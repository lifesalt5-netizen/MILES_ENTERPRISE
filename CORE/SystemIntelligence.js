const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const REPORT_PATH = path.join(ROOT, "DATA", "system", "system_intelligence_report.json");
const BUILD_QUEUE_PATH = path.join(ROOT, "DATA", "build_queue", "build_queue.json");

const IMPORTANT_DIRS = [
    "CORE",
    "SERVICES",
    "CONNECTORS",
    "CONFIG",
    "DATA",
    "TESTS",
    "BUILDER"
];

const REQUIRED_CAPABILITIES = [
    {
        id: "COMMAND_GATEWAY",
        file: "CORE/GATEWAY/CommandGateway.js",
        priority: "CRITICAL",
        reason: "Single command entry point for Miles COO."
    },
    {
        id: "RUNTIME_CONTROLLER",
        file: "CORE/RuntimeController.js",
        priority: "CRITICAL",
        reason: "Central runtime brainstem."
    },
    {
        id: "SUPERVISOR",
        file: "CORE/Supervisor.js",
        priority: "CRITICAL",
        reason: "Runtime orchestration and heartbeat."
    },
    {
        id: "EXECUTION_ORCHESTRATOR",
        file: "CORE/ExecutionOrchestrator.js",
        priority: "CRITICAL",
        reason: "Turns workflows into executed work."
    },
    {
        id: "EXECUTIVE_STATE",
        file: "CORE/STATE/ExecutiveState.js",
        priority: "HIGH",
        reason: "Single live operating state."
    },
    {
        id: "RECOVERY_ENGINE",
        file: "CORE/RECOVERY/RecoveryEngine.js",
        priority: "HIGH",
        reason: "Classifies and manages failures."
    },
    {
        id: "WORKFORCE_SERVICE",
        file: "SERVICES/WorkforceService.js",
        priority: "HIGH",
        reason: "Loads workers and capabilities."
    },
    {
        id: "PLANNER_SERVICE",
        file: "SERVICES/PlannerService.js",
        priority: "HIGH",
        reason: "Creates plans from objectives."
    },
    {
        id: "WORKFLOW_SERVICE",
        file: "SERVICES/WorkflowService.js",
        priority: "HIGH",
        reason: "Creates executable workflows."
    },
    {
        id: "INSTANTLY_CONNECTOR",
        file: "CONNECTORS/INSTANTLY/connector.js",
        priority: "HIGH",
        reason: "Outbound campaign automation."
    },
    {
        id: "ORION_CONNECTOR",
        file: "CONNECTORS/ORION/connector.js",
        priority: "HIGH",
        reason: "ORION intelligence access."
    },
    {
        id: "START_MILES",
        file: "StartMiles.js",
        priority: "CRITICAL",
        reason: "Interactive Miles COO runtime."
    }
];

function exists(relativePath) {
    return fs.existsSync(path.join(ROOT, relativePath));
}

function walk(dir) {
    const full = path.join(ROOT, dir);

    if (!fs.existsSync(full)) {
        return [];
    }

    const results = [];

    for (const item of fs.readdirSync(full, { withFileTypes: true })) {
        const itemPath = path.join(full, item.name);
        const relative = path.relative(ROOT, itemPath).replace(/\\/g, "/");

        if (relative.includes("node_modules")) {
            continue;
        }

        if (item.isDirectory()) {
            results.push(...walk(relative));
        } else {
            results.push(relative);
        }
    }

    return results;
}

function readJsonSafe(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJson(filePath, data) {
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

class SystemIntelligence {
    inventory() {
        const files = [];

        for (const dir of IMPORTANT_DIRS) {
            files.push(...walk(dir));
        }

        const jsFiles = files.filter(f => f.endsWith(".js"));

        return {
            root: ROOT,
            generatedAt: new Date().toISOString(),
            totalFiles: files.length,
            jsFiles: jsFiles.length,
            directories: IMPORTANT_DIRS.map(dir => ({
                name: dir,
                exists: exists(dir),
                fileCount: walk(dir).length
            })),
            files
        };
    }

    assessCapabilities() {
        return REQUIRED_CAPABILITIES.map(cap => ({
            ...cap,
            present: exists(cap.file),
            status: exists(cap.file) ? "PRESENT" : "MISSING"
        }));
    }

    detectGaps() {
        const capabilities = this.assessCapabilities();

        return capabilities
            .filter(c => !c.present)
            .map(c => ({
                id: "BUILD-" + c.id,
                title: "Build " + c.id,
                capability: c.id,
                targetFile: c.file,
                priority: c.priority,
                reason: c.reason,
                status: "READY",
                createdAt: new Date().toISOString()
            }));
    }

    updateBuildQueue() {
        const existing = readJsonSafe(BUILD_QUEUE_PATH, []);
        const gaps = this.detectGaps();

        const byId = {};

        for (const item of existing) {
            byId[item.id] = item;
        }

        for (const gap of gaps) {
            if (!byId[gap.id]) {
                byId[gap.id] = gap;
            }
        }

        const queue = Object.values(byId);

        writeJson(BUILD_QUEUE_PATH, queue);

        return queue;
    }

    report() {
        const inventory = this.inventory();
        const capabilities = this.assessCapabilities();
        const gaps = this.detectGaps();
        const buildQueue = this.updateBuildQueue();

        const report = {
            generatedAt: new Date().toISOString(),
            summary: {
                totalFiles: inventory.totalFiles,
                jsFiles: inventory.jsFiles,
                requiredCapabilities: capabilities.length,
                presentCapabilities: capabilities.filter(c => c.present).length,
                missingCapabilities: gaps.length,
                buildQueueItems: buildQueue.length
            },
            health: {
                status: gaps.length === 0 ? "COMPLETE_CORE" : "GAPS_FOUND",
                gaps: gaps.map(g => g.capability)
            },
            inventory,
            capabilities,
            gaps,
            buildQueue
        };

        writeJson(REPORT_PATH, report);

        return report;
    }
}

module.exports = new SystemIntelligence();