const fs = require("fs");
const path = require("path");

const COOOrchestratorService = require("./SERVICES/COOOrchestratorService");

class AutonomousCOOLoopService {
    constructor(options = {}) {
        this.intervalMs = options.intervalMs || 5 * 60 * 1000;
        this.maxCycles = options.maxCycles || null;
        this.cyclesRun = 0;
        this.running = false;

        this.outputDir =
            options.outputDir ||
            path.join(process.cwd(), "DATA", "executive");

        this.orchestrator =
            options.orchestrator ||
            new COOOrchestratorService({
                executeRuntimeTasks: Boolean(options.executeRuntimeTasks)
            });
    }

    async runOnce() {
        this.cyclesRun += 1;

        const result = await this.orchestrator.runOnce();

        const cycleResult = {
            ...result,
            cycle: this.cyclesRun
        };

        this.writeOutputs(cycleResult);

        return cycleResult;
    }

    async start() {
        if (this.running) {
            return {
                ok: false,
                message: "Autonomous COO loop already running."
            };
        }

        this.running = true;

        while (this.running) {
            await this.runOnce();

            if (this.maxCycles && this.cyclesRun >= this.maxCycles) {
                this.running = false;
                break;
            }

            await this.sleep(this.intervalMs);
        }

        return {
            ok: true,
            status: "STOPPED",
            cyclesRun: this.cyclesRun
        };
    }

    stop() {
        this.running = false;

        return {
            ok: true,
            status: "STOPPING"
        };
    }

    writeOutputs(result) {
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }

        fs.writeFileSync(
            path.join(this.outputDir, "latest_executive_state.json"),
            JSON.stringify(result.executiveState || {}, null, 2),
            "utf8"
        );

        fs.writeFileSync(
            path.join(this.outputDir, "latest_executive_brief.json"),
            JSON.stringify(result.executiveBrief || {}, null, 2),
            "utf8"
        );

        fs.writeFileSync(
            path.join(this.outputDir, "latest_coo_cycle.json"),
            JSON.stringify(result, null, 2),
            "utf8"
        );
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = AutonomousCOOLoopService;
