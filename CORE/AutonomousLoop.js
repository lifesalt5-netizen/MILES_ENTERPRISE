const fs = require("fs");
const path = require("path");

const discovery = require("./AutonomousDiscoveryEngine");
const executionEngine = require("./ExecutionEngine");
const taskQueue = require("./TaskQueue");

const ROOT = process.cwd();

const LOOP_DIR = path.join(ROOT, "DATA", "loop");
const LOOP_REPORT = path.join(LOOP_DIR, "autonomous_loop_report.json");

function ensureDirs() {
    fs.mkdirSync(LOOP_DIR, { recursive: true });
}

function now() {
    return new Date().toISOString();
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class AutonomousLoop {
    constructor() {
        ensureDirs();

        this.running = false;
        this.startedAt = null;
        this.cycles = 0;
        this.lastReport = null;
    }

    status() {
        return {
            ok: true,
            service: "AutonomousLoop",
            running: this.running,
            startedAt: this.startedAt,
            cycles: this.cycles,
            queue: taskQueue.getStatus(),
            lastReport: this.lastReport,
            checkedAt: now()
        };
    }

    async runOnce(options = {}) {
        const executionLimit = options.executionLimit || 5;

        const report = {
            ok: true,
            type: "AUTONOMOUS_LOOP_CYCLE",
            cycle: this.cycles + 1,
            startedAt: now(),
            discovery: null,
            execution: null,
            queueBefore: taskQueue.getStatus(),
            queueAfter: null,
            finishedAt: null
        };

        try {
            report.discovery = discovery.discover();

            report.execution = await executionEngine.runCycle(executionLimit);

            report.queueAfter = taskQueue.getStatus();

            report.finishedAt = now();

            this.cycles += 1;
            this.lastReport = report;

            writeJson(LOOP_REPORT, report);

            return report;

        } catch (err) {
            report.ok = false;
            report.error = err.message;
            report.finishedAt = now();
            report.queueAfter = taskQueue.getStatus();

            this.lastReport = report;

            writeJson(LOOP_REPORT, report);

            return report;
        }
    }

    async start(options = {}) {
        const intervalMs = options.intervalMs || 60000;
        const executionLimit = options.executionLimit || 5;
        const maxCycles = options.maxCycles || null;

        if (this.running) {
            return {
                ok: false,
                error: "Autonomous loop already running."
            };
        }

        this.running = true;
        this.startedAt = now();

        console.log("");
        console.log("====================================");
        console.log("MILES AUTONOMOUS COO LOOP STARTING");
        console.log("====================================");
        console.log("");

        while (this.running) {
            const cycleReport = await this.runOnce({
                executionLimit
            });

            console.log("");
            console.log("===== AUTONOMOUS LOOP CYCLE =====");
            console.log("Cycle      :", this.cycles);
            console.log("OK         :", cycleReport.ok);
            console.log("Created    :", cycleReport.discovery?.created || 0);
            console.log("Executed   :", cycleReport.execution?.executed || 0);
            console.log("Pending    :", cycleReport.queueAfter?.pending || 0);
            console.log("Completed  :", cycleReport.queueAfter?.completed || 0);
            console.log("Failed     :", cycleReport.queueAfter?.failed || 0);
            console.log("Finished   :", cycleReport.finishedAt);
            console.log("=================================");
            console.log("");

            if (maxCycles && this.cycles >= maxCycles) {
                this.running = false;
                break;
            }

            await sleep(intervalMs);
        }

        return {
            ok: true,
            stoppedAt: now(),
            cycles: this.cycles,
            queue: taskQueue.getStatus()
        };
    }

    stop() {
        this.running = false;

        return {
            ok: true,
            message: "Autonomous loop stop requested.",
            stoppedAt: now()
        };
    }
}

module.exports = new AutonomousLoop();