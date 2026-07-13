const commandGateway = require("./GATEWAY/CommandGateway");
const taskQueue = require("./TaskQueue");

let workflowService = null;
let plannerService = null;
let workforceExecutionService = null;

try {
    workflowService = require("../SERVICES/WorkflowService");
} catch (err) {
    workflowService = null;
}

try {
    plannerService = require("../SERVICES/PlannerService");
} catch (err) {
    plannerService = null;
}

try {
    workforceExecutionService = require("../SERVICES/WorkforceExecutionService");
} catch (err) {
    workforceExecutionService = null;
}

class RuntimeController {
    constructor() {
        this.startedAt = new Date().toISOString();
    }

    async status() {
        const gatewayStatus = await commandGateway.execute({
            type: "STATUS"
        });

        return {
            ok: true,
            type: "RUNTIME_STATUS",
            startedAt: this.startedAt,
            queue: taskQueue.getStatus(),
            executiveState: gatewayStatus.state || null,
            services: {
                commandGateway: true,
                plannerService: Boolean(plannerService),
                workflowService: Boolean(workflowService),
                workforceExecutionService: Boolean(workforceExecutionService)
            },
            timestamp: new Date().toISOString()
        };
    }

    async plan(objective, context = {}) {
        if (!plannerService || typeof plannerService.createPlan !== "function") {
            return {
                ok: false,
                error: "PlannerService unavailable."
            };
        }

        const plan = plannerService.createPlan(objective, context);

        return {
            ok: true,
            type: "RUNTIME_PLAN",
            objective,
            plan,
            timestamp: new Date().toISOString()
        };
    }

    async createWorkflow(objective, context = {}) {
        if (!workflowService || typeof workflowService.createWorkflow !== "function") {
            return {
                ok: false,
                error: "WorkflowService unavailable."
            };
        }

        const workflow = workflowService.createWorkflow(objective, context);

        return {
            ok: true,
            type: "RUNTIME_WORKFLOW",
            objective,
            workflow,
            queue: taskQueue.getStatus(),
            timestamp: new Date().toISOString()
        };
    }

    async queueObjective(objective, context = {}) {
        const task = taskQueue.add(
            "OBJECTIVE",
            {
                objective,
                context,
                source: "RuntimeController"
            },
            context.priorityScore || 75
        );

        return {
            ok: true,
            type: "OBJECTIVE_QUEUED",
            task,
            queue: taskQueue.getStatus(),
            timestamp: new Date().toISOString()
        };
    }

    async executeWorkforceStep(taskId = null) {
        if (
            !workforceExecutionService ||
            typeof workforceExecutionService.executeAndVerify !== "function"
        ) {
            return {
                ok: false,
                error: "WorkforceExecutionService unavailable."
            };
        }

        let task = null;

        if (taskId) {
            task = taskQueue.list().find(t => t.id === taskId);
        } else {
            task = taskQueue
                .list("QUEUED")
                .find(t => t.type === "WORKFORCE_STEP");
        }

        if (!task) {
            return {
                ok: false,
                error: "No matching workforce task found."
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
                error: err.message,
                taskId: task.id,
                queue: taskQueue.getStatus(),
                timestamp: new Date().toISOString()
            };
        }
    }

    async handle(command = {}) {
        if (!command.action) {
            return {
                ok: false,
                error: "Missing command.action"
            };
        }

        switch (command.action) {
            case "STATUS":
                return this.status();

            case "PLAN":
                return this.plan(
                    command.objective,
                    command.context || {}
                );

            case "CREATE_WORKFLOW":
                return this.createWorkflow(
                    command.objective,
                    command.context || {}
                );

            case "QUEUE_OBJECTIVE":
                return this.queueObjective(
                    command.objective,
                    command.context || {}
                );

            case "EXECUTE_WORKFORCE_STEP":
                return this.executeWorkforceStep(command.taskId || null);

            default:
                return {
                    ok: false,
                    error: "Unsupported runtime action: " + command.action
                };
        }
    }
}

module.exports = new RuntimeController();