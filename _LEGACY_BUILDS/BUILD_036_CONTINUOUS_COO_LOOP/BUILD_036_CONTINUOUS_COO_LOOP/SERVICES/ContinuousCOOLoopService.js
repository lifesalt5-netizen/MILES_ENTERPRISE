"use strict";

/**
 * MILES Continuous COO Loop Service
 * BUILD_036
 * Complete replacement file.
 *
 * Purpose:
 * Runs the autonomous COO orchestration loop without replacing existing business services.
 */

const path = require("path");
const json = require("./JsonFileService");
const time = require("./TimeUtil");

const heartbeat = require("./HeartbeatService");
const queueRecovery = require("./QueueRecoveryService");
const runtimeHealth = require("./RuntimeHealthService");
const restartGuardian = require("./RestartGuardianService");
const scheduler = require("./LoopSchedulerService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const RUNTIME_DIR = path.join(ROOT, "DATA", "runtime");
const LATEST_CYCLE_FILE = path.join(RUNTIME_DIR, "latest_coo_cycle.json");
const CYCLE_HISTORY_FILE = path.join(RUNTIME_DIR, "coo_cycle_history.json");
const LOOP_REPORT_FILE = path.join(RUNTIME_DIR, "coo_loop_report.md");

class ContinuousCOOLoopService {
    constructor() {
        this.stopRequested = false;
        this.consecutiveFailures = 0;
        this.errors = [];
        this.startedAt = null;
    }

    async run(input = {}) {
        this.startedAt = time.nowIso();
        this.stopRequested = false;

        this.attachSignalHandlers();

        const maxCycles = scheduler.getMaxCycles(input);
        const intervalMs = scheduler.getIntervalMs(input);
        const loopMode = maxCycles === 1 ? "ONCE" : "CONTINUOUS";
        let cycleNumber = 0;
        let latest = null;

        console.log("");
        console.log("========================================");
        console.log(" BUILD_036 Continuous COO Loop");
        console.log("========================================");
        console.log(`Mode: ${loopMode}`);
        console.log(`Interval MS: ${intervalMs}`);
        console.log("");

        while (!this.stopRequested) {
            cycleNumber += 1;
            latest = await this.runCycle({
                ...input,
                cycleNumber,
                loopMode,
                intervalMs
            });

            if (maxCycles && cycleNumber >= maxCycles) break;
            if (latest.restartGuardian?.restartRecommended) break;

            await scheduler.sleep({ intervalMs });
        }

        return {
            ok: latest ? latest.ok : true,
            action: "COO_LOOP",
            status: this.stopRequested ? "STOPPED" : "COMPLETE",
            loopMode,
            startedAt: this.startedAt,
            completedAt: time.nowIso(),
            cyclesCompleted: cycleNumber,
            latestCycle: latest,
            outDir: RUNTIME_DIR
        };
    }

    async runCycle(input = {}) {
        const cycleStartedAt = Date.now();
        const generatedAt = time.nowIso();
        const cycleId = `COO-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const results = [];
        const errors = [];

        console.log(`[COO_LOOP] Starting cycle ${input.cycleNumber} (${cycleId})`);

        const step = async (name, fn) => {
            const started = Date.now();
            try {
                const result = await fn();
                const wrapped = {
                    name,
                    ok: result?.ok !== false,
                    durationMs: Date.now() - started,
                    result
                };
                results.push(wrapped);
                return result;
            } catch (err) {
                const errorRecord = {
                    name,
                    ok: false,
                    durationMs: Date.now() - started,
                    error: err.stack || err.message || String(err)
                };
                errors.push(errorRecord);
                results.push(errorRecord);
                return errorRecord;
            }
        };

        await step("HEARTBEAT", () => heartbeat.run({ cycleId, loopMode: input.loopMode }));
        await step("QUEUE_RECOVERY", () => queueRecovery.run(input));
        await step("EXECUTIVE_BRAIN", () => require("./ExecutiveBrainService").run({
            source: "ContinuousCOOLoopService",
            objective: input.objective || "Review P2GC operating state and determine next best action.",
            domain: "executive",
            metadata: {
                cycleId,
                cycleNumber: input.cycleNumber,
                loopMode: input.loopMode
            }
        }));
        await step("COMPANY_STATE", () => require("./CompanyStateService").run({
            source: "ContinuousCOOLoopService",
            cycleId,
            cycleNumber: input.cycleNumber
        }));
        await step("TASK_ROUTER", () => require("./TaskRouterService").run({
            source: "ContinuousCOOLoopService",
            cycleId,
            cycleNumber: input.cycleNumber,
            maxItems: input.maxItems || 10
        }));
        await step("ARCHIVE_CLOSED_WORK", () => {
            const WorkQueueService = require("./WorkQueueService");
            const queue = new WorkQueueService();
            return {
                ok: true,
                action: "ARCHIVE_CLOSED_WORK",
                ...queue.archiveClosed(),
                stats: queue.getStats()
            };
        });

        if (errors.length) {
            this.consecutiveFailures += 1;
            this.errors.push(...errors);
        } else {
            this.consecutiveFailures = 0;
        }

        const health = await step("RUNTIME_HEALTH", () => runtimeHealth.run({
            cycleId,
            results
        }));

        const guardian = await step("RESTART_GUARDIAN", () => restartGuardian.run({
            cycleId,
            consecutiveFailures: this.consecutiveFailures,
            errors: this.errors,
            maxFailuresBeforeRestart: input.maxFailuresBeforeRestart || 3
        }));

        const durationMs = Date.now() - cycleStartedAt;
        const record = {
            ok: errors.length === 0,
            action: "COO_LOOP_CYCLE",
            type: "MILES_CONTINUOUS_COO_LOOP_CYCLE",
            build: "BUILD_036",
            generatedAt,
            completedAt: time.nowIso(),
            cycleId,
            cycleNumber: input.cycleNumber,
            status: errors.length ? "WATCH" : "OK",
            durationMs,
            loop: {
                mode: input.loopMode,
                intervalMs: input.intervalMs,
                startedAt: this.startedAt,
                consecutiveFailures: this.consecutiveFailures
            },
            summary: {
                steps: results.length,
                errors: errors.length,
                runtimeHealth: health?.status || null,
                restartRecommended: Boolean(guardian?.restartRecommended)
            },
            results,
            errors,
            runtimeHealth: health,
            restartGuardian: guardian
        };

        this.saveCycle(record);
        console.log(`[COO_LOOP] Completed cycle ${input.cycleNumber}: ${record.status}`);

        return record;
    }

    saveCycle(record) {
        json.writeJson(LATEST_CYCLE_FILE, record);
        json.appendJsonArray(CYCLE_HISTORY_FILE, record, 1000);
        json.writeJson(path.join(RUNTIME_DIR, `coo_cycle_${record.cycleId}.json`), record);
        json.ensureDir(RUNTIME_DIR);
        require("fs").writeFileSync(LOOP_REPORT_FILE, this.renderReport(record), "utf8");
    }

    renderReport(record) {
        const steps = record.results.map(step => {
            const status = step.ok ? "OK" : "FAILED";
            return `- ${status}: ${step.name} (${step.durationMs || 0} ms)`;
        }).join("\n");

        const errors = record.errors.length
            ? record.errors.map(e => `- ${e.name}: ${e.error}`).join("\n")
            : "- None";

        return `# MILES Continuous COO Loop Report

Generated: ${record.completedAt}
Build: BUILD_036
Cycle: ${record.cycleNumber}
Cycle ID: ${record.cycleId}
Status: ${record.status}
Duration MS: ${record.durationMs}

## Summary

Steps: ${record.summary.steps}  
Errors: ${record.summary.errors}  
Runtime Health: ${record.summary.runtimeHealth || "UNKNOWN"}  
Restart Recommended: ${record.summary.restartRecommended ? "Yes" : "No"}

## Steps

${steps}

## Errors

${errors}
`;
    }

    attachSignalHandlers() {
        if (this.signalHandlersAttached) return;
        this.signalHandlersAttached = true;

        process.on("SIGINT", () => {
            this.stopRequested = true;
            console.log("[COO_LOOP] Stop requested by SIGINT.");
        });

        process.on("SIGTERM", () => {
            this.stopRequested = true;
            console.log("[COO_LOOP] Stop requested by SIGTERM.");
        });
    }
}

module.exports = new ContinuousCOOLoopService();
