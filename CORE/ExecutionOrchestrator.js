const taskQueue = require("./TaskQueue");

let workflowService = null;
let workforceExecutionService = null;

try {
    workflowService = require("../SERVICES/WorkflowService");
} catch (err) {
    workflowService = null;
}

try {
    workforceExecutionService = require("../SERVICES/WorkforceExecutionService");
} catch (err) {
    workforceExecutionService = null;
}

class ExecutionOrchestrator {
    constructor() {
        this.startedAt = new Date().toISOString();
    }

    status() {
        return {
            ok: true,
            service: "ExecutionOrchestrator",
            startedAt: this.startedAt,
            queue: taskQueue.getStatus(),
            services: {
                workflowService: Boolean(workflowService),
                workforceExecutionService: Boolean(workforceExecutionService)
            },
            timestamp: new Date().toISOString()
        };
    }

    async createAndQueueWorkflow(objective, context = {}) {
        if (!workflowService || typeof workflowService.createWorkflow !== "function") {
            return {
                ok: false,
                error: "WorkflowService unavailable."
            };
        }

        const workflow = workflowService.createWorkflow(objective, context);

        return {
            ok: true,
            type: "WORKFLOW_QUEUED",
            objective,
            workflow,
            queue: taskQueue.getStatus(),
            timestamp: new Date().toISOString()
        };
    }

    getNextWorkforceTask() {
        return taskQueue
            .list("QUEUED")
            .filter(t => t.type === "WORKFORCE_STEP")
            .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0] || null;
    }

    async executeNextWorkforceStep() {
        if (!workforceExecutionService || typeof workforceExecutionService.executeAndVerify !== "function") {
            return {
                ok: false,
                error: "WorkforceExecutionService unavailable."
            };
        }

        const task = this.getNextWorkforceTask();

        if (!task) {
            return {
                ok: true,
                type: "NO_WORKFORCE_TASK",
                message: "No queued workforce step found.",
                queue: taskQueue.getStatus(),
                timestamp: new Date().toISOString()
            };
        }

        taskQueue.update(task.id, {
            status: "RUNNING"
        });

        try {
            const result = workforceExecutionService.executeAndVerify(task);

            taskQueue.update(task.id, {
                status: result.status === "COMPLETED" ? "COMPLETED" : "FAILED",
                result
            });

            return {
                ok: true,
                type: "WORKFORCE_STEP_EXECUTED",
                taskId: task.id,
                assignedTo: task.payload?.assignedTo || null,
                capability: task.payload?.capability || null,
                result,
                queue: taskQueue.getStatus(),
                timestamp: new Date().toISOString()
            };

        } catch (err) {
            taskQueue.update(task.id, {
                status: "FAILED",
                error: err.message
            });

            return {
                ok: false,
                type: "WORKFORCE_STEP_FAILED",
                taskId: task.id,
                error: err.message,
                queue: taskQueue.getStatus(),
                timestamp: new Date().toISOString()
            };
        }
    }

    async runCycle(limit = 5) {
        const results = [];

        for (let i = 0; i < limit; i++) {
            const result = await this.executeNextWorkforceStep();
            results.push(result);

            if (result.type === "NO_WORKFORCE_TASK") {
                break;
            }
        }

        return {
            ok: true,
            type: "ORCHESTRATOR_CYCLE",
            executed: results.filter(r => r.type === "WORKFORCE_STEP_EXECUTED").length,
            results,
            queue: taskQueue.getStatus(),
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = new ExecutionOrchestrator();