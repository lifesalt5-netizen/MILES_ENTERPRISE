"use strict";

const eventBus = require("../CORE/EventBus");

class SchedulerService {
    constructor() {
        this.running = false;
        this.interval = null;
    }

    start(intervalMs = 5000) {
        if (this.running) return;

        this.running = true;

        console.log(
            `[Scheduler] Started (${intervalMs} ms) — execution delegated to MILES_RESIDENT_WORKER`
        );

        this.interval = setInterval(async () => {
            try {
                const decisionEngine = require("./DecisionEngine");
                const dashboard = require("./DashboardService");

                /*
                  Scheduler ownership is limited to:
                  - observe
                  - analyze
                  - queue decisions
                  - refresh dashboard

                  StartProductionSystem.js is the single authoritative
                  execution owner and is the only runtime allowed to consume
                  CORE/TaskQueue tasks.
                */
                decisionEngine.queueDecisions();

                if (typeof dashboard.refresh === "function") {
                    await dashboard.refresh();
                }
            } catch (err) {
                console.error("[Scheduler]", err.message);
            }
        }, intervalMs);

        eventBus.publish("SCHEDULER_STARTED", {
            executionOwner: "MILES_RESIDENT_WORKER",
            executionDelegated: true
        });
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
