"use strict";

class ExecutionSchedulerService {
    schedule(plan = {}) {
        const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
        const ordered = tasks.slice().sort((a, b) => (a.priority || 99) - (b.priority || 99));
        return {
            ok: true,
            action: "EXECUTION_SCHEDULE",
            generatedAt: new Date().toISOString(),
            scheduled: ordered.length,
            tasks: ordered
        };
    }
}

module.exports = new ExecutionSchedulerService();
