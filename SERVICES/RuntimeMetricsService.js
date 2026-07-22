"use strict";

const fs = require("fs");
const path = require("path");

class RuntimeMetricsService {
    constructor(options = {}) {
        this.root = options.root || process.env.MILES_ROOT || process.cwd();

        this.runtimeDir = path.join(this.root, "DATA", "runtime");

        this.metricsFile = path.join(
            this.runtimeDir,
            "runtime_metrics.json"
        );

        this.historyFile = path.join(
            this.runtimeDir,
            "runtime_metrics_history.jsonl"
        );

        fs.mkdirSync(this.runtimeDir, { recursive: true });
    }

    count(value) {
        return Array.isArray(value) ? value.length : 0;
    }

    async record({
        executiveState = {},
        executionResults = {},
        queueStatus = {},
        connectorStatus = {},
        missions = {}
    } = {}) {

        const business = executiveState.business || {};

        const metrics = {
            generatedAt: new Date().toISOString(),

            runtime: {
                health:
                    executiveState.runtimeHealth?.overallStatus ||
                    executiveState.health ||
                    "UNKNOWN",

                healthScore:
                    executiveState.runtimeHealth?.overallScore ||
                    0,

                cycleId:
                    executiveState.cycleId ||
                    null
            },

            business: {
                campaigns: this.count(business.campaigns),
                replies: this.count(business.replies),
                mailboxes: this.count(business.mailboxes),
                segments: this.count(business.segments),
                deals: this.count(business.deals),
                proposals: this.count(business.proposals),
                opportunities: this.count(business.opportunities),
                contractors: this.count(business.contractors)
            },

            missions: {
                revenue: this.count(missions.revenue),
                proposal: this.count(missions.proposal),
                capture: this.count(missions.capture),
                operations: this.count(missions.operations),
                total:
                    this.count(missions.revenue) +
                    this.count(missions.proposal) +
                    this.count(missions.capture) +
                    this.count(missions.operations)
            },

            execution: {
                queued: executionResults.queued || 0,
                completed: executionResults.completed || 0,
                failed: executionResults.failed || 0,
                requiresKevin:
                    executionResults.requiresKevin || 0
            },

            queue: {
                pending: queueStatus.pending || 0,
                running: queueStatus.running || 0,
                completed: queueStatus.completed || 0,
                failed: queueStatus.failed || 0
            },

            connectors: connectorStatus
        };

        fs.writeFileSync(
            this.metricsFile,
            JSON.stringify(metrics, null, 2)
        );

        fs.appendFileSync(
            this.historyFile,
            JSON.stringify(metrics) + "\n"
        );

        return metrics;
    }
}

module.exports = RuntimeMetricsService;
