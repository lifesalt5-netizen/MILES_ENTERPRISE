const fs = require("fs");
const path = require("path");

const ExecutiveIntelligenceService = require("./ExecutiveIntelligenceService");
const ExecutiveBriefService = require("./ExecutiveBriefService");
const WorkQueueService = require("./WorkQueueService");

class AutonomousCOOLoopService {
    constructor(options = {}) {
        this.intervalMs = options.intervalMs || 5 * 60 * 1000;
        this.maxCycles = options.maxCycles || null;
        this.cyclesRun = 0;
        this.running = false;

        this.outputDir =
            options.outputDir ||
            path.join(process.cwd(), "DATA", "executive");

        this.intelligence = new ExecutiveIntelligenceService();
        this.workQueue = new WorkQueueService();
    }

    async runOnce() {
        this.cyclesRun += 1;

        const startedAt = new Date().toISOString();

        await this.intelligence.refresh();

        const executiveState = this.intelligence.getExecutiveState();

        const brief = new ExecutiveBriefService(executiveState);

        const workItems =
            this.workQueue.generateFromExecutiveState(executiveState);

        const authorizedWork =
            this.workQueue.getAuthorizedPending();

        const escalations =
            this.workQueue.getEscalations();

        const executionResults = await this.prepareAuthorizedWork(authorizedWork);

        await this.intelligence.refresh();

        const refreshedExecutiveState = this.intelligence.getExecutiveState();
        const refreshedBrief = new ExecutiveBriefService(refreshedExecutiveState);

        const result = {
            ok: true,
            cycle: this.cyclesRun,
            startedAt,
            completedAt: new Date().toISOString(),
            businessHealth: refreshedExecutiveState.businessHealth,
            providers: refreshedExecutiveState.executiveSummary,
            workCreated: workItems.length,
            authorizedWork: authorizedWork.length,
            escalations: escalations.length,
            executionResults,
            executiveState: refreshedExecutiveState,
            executiveBrief: refreshedBrief.generate()
        };

        this.writeOutputs(result, refreshedBrief);

        return result;
    }

    async prepareAuthorizedWork(items) {
        const results = [];

        for (const item of items) {
            if (item.status !== "Pending") {
                continue;
            }

            const queued = this.workQueue.markQueued(item.id, {
                queuedBy: "AutonomousCOOLoopService",
                queuedAt: new Date().toISOString(),
                executionReady: true
            });

            results.push({
                workItemId: item.id,
                title: item.title,
                status: queued ? queued.status : "Unknown",
                message: "Work item marked execution-ready. ExecutionService handoff pending existing task-queue adapter."
            });
        }

        return results;
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

    writeOutputs(result, brief) {
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }

        fs.writeFileSync(
            path.join(this.outputDir, "latest_executive_state.json"),
            JSON.stringify(result.executiveState, null, 2),
            "utf8"
        );

        fs.writeFileSync(
            path.join(this.outputDir, "latest_executive_brief.json"),
            JSON.stringify(result.executiveBrief, null, 2),
            "utf8"
        );

        fs.writeFileSync(
            path.join(this.outputDir, "latest_executive_brief.md"),
            brief.toMarkdown(),
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
