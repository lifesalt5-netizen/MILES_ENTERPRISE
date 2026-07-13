const plannerService = require("../../SERVICES/PlannerService");
const workflowService = require("../../SERVICES/WorkflowService");
const taskQueue = require("../TaskQueue");

let executiveState = null;

try {
    executiveState = require("../STATE/ExecutiveState");
} catch (err) {
    executiveState = null;
}

class CommandGateway {

    constructor() {

        this.allowedCommands = [
            "STATUS",
            "PLAN_OBJECTIVE",
            "CREATE_WORKFLOW",
            "QUEUE_TASK",
            "RUN_WORKFLOW",
            "EXECUTE_OBJECTIVE",
            "PING"
        ];

    }

    validate(command = {}) {

        if (!command.type) {

            return {
                ok: false,
                error: "Missing command.type"
            };

        }

        if (!this.allowedCommands.includes(command.type)) {

            return {
                ok: false,
                error: "Unsupported command: " + command.type
            };

        }

        return {
            ok: true
        };

    }

    async execute(command = {}) {

        const validation = this.validate(command);

        if (!validation.ok) {

            return validation;

        }

        switch (command.type) {

            case "PING":

                return {
                    ok: true,
                    type: "PING",
                    message: "MILES Command Gateway Online",
                    timestamp: new Date().toISOString()
                };

            case "STATUS":

                if (
                    executiveState &&
                    typeof executiveState.readExecutiveState === "function"
                ) {

                    return {
                        ok: true,
                        state: executiveState.readExecutiveState()
                    };

                }

                return {
                    ok: true,
                    state: {}
                };

            case "PLAN_OBJECTIVE":

                if (
                    plannerService &&
                    typeof plannerService.createPlan === "function"
                ) {

                    const plan =
                        plannerService.createPlan(
                            command.objective,
                            command.context || {}
                        );

                    return {
                        ok: true,
                        type: "PLAN_RESULT",
                        plan
                    };

                }

                return {
                    ok: false,
                    error: "PlannerService.createPlan() not found."
                };

            case "CREATE_WORKFLOW":

                if (
                    workflowService &&
                    typeof workflowService.createWorkflow === "function"
                ) {

                    const workflow =
                        workflowService.createWorkflow(
                            command.objective,
                            command.context || {}
                        );

                    return {
                        ok: true,
                        type: "WORKFLOW_CREATED",
                        workflow
                    };

                }

                return {
                    ok: false,
                    error: "WorkflowService.createWorkflow() not found."
                };

            case "QUEUE_TASK":

                const task =
                    taskQueue.add(
                        command.taskType || "GENERAL",
                        command.payload || {},
                        command.priority || 50
                    );

                return {
                    ok: true,
                    type: "TASK_CREATED",
                    task
                };

            case "RUN_WORKFLOW":

                if (
                    workflowService &&
                    typeof workflowService.executeWorkflow === "function"
                ) {

                    const result =
                        await workflowService.executeWorkflow(
                            command.workflowId
                        );

                    return {
                        ok: true,
                        result
                    };

                }

                return {
                    ok: false,
                    error: "Workflow execution unavailable."
                };

            case "EXECUTE_OBJECTIVE":

                if (
                    plannerService &&
                    typeof plannerService.createPlan === "function"
                ) {

                    const plan =
                        plannerService.createPlan(
                            command.objective,
                            command.context || {}
                        );

                    return {
                        ok: true,
                        objective: command.objective,
                        plan
                    };

                }

                return {
                    ok: false,
                    error: "Planner unavailable."
                };

            default:

                return {
                    ok: false,
                    error: "Unhandled command."
                };

        }

    }

}

module.exports = new CommandGateway();