const executionService = require("./ExecutionService");
const taskQueue = require("../CORE/TaskQueue");
const eventBus = require("../CORE/EventBus");

class SchedulerService {
    constructor() {
        this.running = false;
        this.interval = null;
    }

    start(intervalMs = 5000) {
    if (this.running) return;

    this.running = true;

    console.log(`[Scheduler] Started (${intervalMs} ms)`);

    this.interval = setInterval(async () => {
        try {
            const decisionEngine = require("./DecisionEngine");
            const dashboard = require("./DashboardService");

            // Observe -> Analyze -> Queue
            decisionEngine.queueDecisions();

            // Execute next task
            await executionService.runNext();

            // Refresh dashboard if implemented
            if (typeof dashboard.refresh === "function") {
                await dashboard.refresh();
            }

        } catch (err) {
            console.error("[Scheduler]", err.message);
        }
    }, intervalMs);

    eventBus.publish("SCHEDULER_STARTED");
}

    stop() {
        if (!this.running) return;

        clearInterval(this.interval);

        this.running = false;

        console.log("[Scheduler] Stopped");

        eventBus.publish("SCHEDULER_STOPPED");
    }
}

module.exports = new SchedulerService();