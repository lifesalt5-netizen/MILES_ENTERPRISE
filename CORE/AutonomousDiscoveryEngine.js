const fs = require("fs");
const path = require("path");

const taskQueue = require("./TaskQueue");
const systemIntelligence = require("./SystemIntelligence");

let runtimeController = null;

try {
    runtimeController = require("./RuntimeController");
} catch (err) {
    runtimeController = null;
}

const ROOT = process.cwd();

const DISCOVERY_DIR = path.join(
    ROOT,
    "DATA",
    "discovery"
);

const DISCOVERY_REPORT = path.join(
    DISCOVERY_DIR,
    "autonomous_discovery_report.json"
);

function ensureDirs() {
    fs.mkdirSync(DISCOVERY_DIR, { recursive: true });
}

function now() {
    return new Date().toISOString();
}

function readJsonSafe(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }

        return JSON.parse(
            fs.readFileSync(filePath, "utf8")
        );

    } catch {
        return fallback;
    }
}

function writeJson(filePath, data) {
    fs.writeFileSync(
        filePath,
        JSON.stringify(data, null, 2)
    );
}

class AutonomousDiscoveryEngine {

    constructor() {
        ensureDirs();

        this.discoveryRules = [
            {
                id: "FAILED_TASK_RECOVERY",
                priority: 95,
                type: "RECOVERY",
                description: "Failed tasks exist and should be classified or retried.",
                detect: () => {
                    const status = taskQueue.getStatus();
                    return status.failed > 0;
                },
                createTask: () => {
                    const status = taskQueue.getStatus();

                    return {
                        type: "RECOVERY_REVIEW",
                        payload: {
                            system: "MILES",
                            action: "Review failed tasks",
                            reason: "Failed tasks exist in queue.",
                            failedCount: status.failed,
                            source: "AutonomousDiscoveryEngine"
                        },
                        priority: 95
                    };
                }
            },
            {
                id: "PENDING_TASK_EXECUTION",
                priority: 90,
                type: "EXECUTION",
                description: "Queued tasks exist and should be executed.",
                detect: () => {
                    const status = taskQueue.getStatus();
                    return status.pending > 0;
                },
                createTask: () => {
                    const status = taskQueue.getStatus();

                    return {
                        type: "EXECUTION_CYCLE",
                        payload: {
                            system: "MILES",
                            action: "Run execution cycle",
                            reason: "Queued tasks exist.",
                            pendingCount: status.pending,
                            source: "AutonomousDiscoveryEngine"
                        },
                        priority: 90
                    };
                }
            },
            {
                id: "SYSTEM_GAP_REVIEW",
                priority: 85,
                type: "SELF_BUILD",
                description: "System intelligence should be reviewed for missing capabilities.",
                detect: () => {
                    const report = systemIntelligence.report();
                    return report.summary.missingCapabilities > 0;
                },
                createTask: () => {
                    const report = systemIntelligence.report();

                    return {
                        type: "SELF_BUILD_REVIEW",
                        payload: {
                            system: "MILES",
                            action: "Review system gaps",
                            reason: "Missing core capabilities detected.",
                            missingCapabilities:
                                report.health.gaps || [],
                            source: "AutonomousDiscoveryEngine"
                        },
                        priority: 85
                    };
                }
            },
            {
                id: "OUTBOUND_HEALTH_REVIEW",
                priority: 80,
                type: "REVENUE",
                description: "Outbound health should be checked regularly.",
                detect: () => true,
                createTask: () => {
                    return {
                        type: "BROWSER_INSPECT",
                        payload: {
                            browserSystem: "instantly",
                            system: "INSTANTLY",
                            action: "Inspect Instantly outbound account health",
                            reason: "Regular outbound monitoring.",
                            source: "AutonomousDiscoveryEngine"
                        },
                        priority: 80
                    };
                }
            },
            {
                id: "CALENDAR_REVIEW",
                priority: 70,
                type: "OPERATIONS",
                description: "Calendar should be reviewed for meetings and pipeline signals.",
                detect: () => true,
                createTask: () => {
                    return {
                        type: "BROWSER_INSPECT",
                        payload: {
                            browserSystem: "calendly",
                            system: "CALENDLY",
                            action: "Inspect upcoming meetings",
                            reason: "Regular calendar monitoring.",
                            source: "AutonomousDiscoveryEngine"
                        },
                        priority: 70
                    };
                }
            },
            {
                id: "LINKEDIN_REVIEW",
                priority: 65,
                type: "RELATIONSHIP",
                description: "LinkedIn should be checked for messages and relationship activity.",
                detect: () => true,
                createTask: () => {
                    return {
                        type: "BROWSER_INSPECT",
                        payload: {
                            browserSystem: "linkedin",
                            system: "LINKEDIN",
                            action: "Inspect LinkedIn relationship activity",
                            reason: "Regular relationship monitoring.",
                            source: "AutonomousDiscoveryEngine"
                        },
                        priority: 65
                    };
                }
            },
            {
                id: "DOMAIN_REVIEW",
                priority: 60,
                type: "INFRASTRUCTURE",
                description: "Domains should be monitored for renewal and configuration health.",
                detect: () => true,
                createTask: () => {
                    return {
                        type: "BROWSER_INSPECT",
                        payload: {
                            browserSystem: "namecheap",
                            system: "NAMECHEAP",
                            action: "Inspect domain inventory",
                            reason: "Regular domain monitoring.",
                            source: "AutonomousDiscoveryEngine"
                        },
                        priority: 60
                    };
                }
            },
            {
                id: "MAILBOX_REVIEW",
                priority: 55,
                type: "INFRASTRUCTURE",
                description: "Mailboxes should be monitored for operational health.",
                detect: () => true,
                createTask: () => {
                    return {
                        type: "BROWSER_INSPECT",
                        payload: {
                            browserSystem: "ionos",
                            system: "IONOS",
                            action: "Inspect mailbox health",
                            reason: "Regular mailbox monitoring.",
                            source: "AutonomousDiscoveryEngine"
                        },
                        priority: 55
                    };
                }
            }
        ];
    }

    loadPreviousReport() {
        return readJsonSafe(DISCOVERY_REPORT, null);
    }

    existingAutonomousTasks() {
        return taskQueue
            .list()
            .filter(t =>
                t.payload &&
                t.payload.source === "AutonomousDiscoveryEngine" &&
                ["QUEUED", "RUNNING"].includes(t.status)
            );
    }

    alreadyQueued(ruleId) {
        return this.existingAutonomousTasks()
            .some(t => t.payload.discoveryRuleId === ruleId);
    }

    discover(options = {}) {
        ensureDirs();

        const created = [];
        const skipped = [];
        const findings = [];

        const allowDuplicates =
            options.allowDuplicates === true;

        for (const rule of this.discoveryRules) {
            let detected = false;
            let error = null;

            try {
                detected = Boolean(rule.detect());
            } catch (err) {
                error = err.message;
            }

            const finding = {
                ruleId: rule.id,
                type: rule.type,
                priority: rule.priority,
                description: rule.description,
                detected,
                error,
                checkedAt: now()
            };

            findings.push(finding);

            if (!detected) {
                skipped.push({
                    ruleId: rule.id,
                    reason: "Not detected"
                });
                continue;
            }

            if (!allowDuplicates && this.alreadyQueued(rule.id)) {
                skipped.push({
                    ruleId: rule.id,
                    reason: "Already queued"
                });
                continue;
            }

            const taskSpec = rule.createTask();

            taskSpec.payload.discoveryRuleId = rule.id;

            const task = taskQueue.add(
                taskSpec.type,
                taskSpec.payload,
                taskSpec.priority
            );

            created.push(task);
        }

        const report = {
            ok: true,
            generatedAt: now(),
            created: created.length,
            skipped: skipped.length,
            findings,
            createdTasks: created,
            skippedRules: skipped,
            queue: taskQueue.getStatus()
        };

        writeJson(DISCOVERY_REPORT, report);

        return report;
    }

    status() {
        return {
            ok: true,
            service: "AutonomousDiscoveryEngine",
            rules: this.discoveryRules.length,
            previousReport: this.loadPreviousReport(),
            queue: taskQueue.getStatus(),
            checkedAt: now()
        };
    }
}

module.exports = new AutonomousDiscoveryEngine();