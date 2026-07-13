const taskQueue = require("./TaskQueue");
const connectorManager = require("./ConnectorManager");
const browserWorker = require("./BROWSER/BrowserWorker");
const workforceExecutionService = require("../SERVICES/WorkforceExecutionService");

class ExecutionEngine {
    constructor() {
        this.startedAt = new Date().toISOString();
    }

    status() {
        return {
            ok: true,
            service: "ExecutionEngine",
            startedAt: this.startedAt,
            queue: taskQueue.getStatus(),
            connectors: connectorManager.list(),
            checkedAt: new Date().toISOString()
        };
    }

    chooseRoute(task = {}) {
        const payload = task.payload || {};
        const system = String(payload.system || payload.connector || "").toUpperCase();

        if (task.type === "WORKFORCE_STEP") {
            return "WORKFORCE";
        }

        if (system && connectorManager.get(system)) {
            return "API";
        }

        if (payload.browserSystem) {
            return "BROWSER";
        }

        return "UNKNOWN";
    }

    async executeTask(task) {
        const route = this.chooseRoute(task);

        taskQueue.update(task.id, {
            status: "RUNNING",
            route
        });

        try {
            let result;

            if (route === "WORKFORCE") {
                result = workforceExecutionService.executeAndVerify(task);
            }

            else if (route === "API") {
                const payload = task.payload || {};
                const system = String(payload.system || payload.connector || "").toUpperCase();
                const connector = connectorManager.get(system);

                if (!connector || typeof connector.execute !== "function") {
                    throw new Error("Connector does not expose execute(): " + system);
                }

                result = await connector.execute(payload.action, payload);
            }

            else if (route === "BROWSER") {
                const payload = task.payload || {};
                result = await browserWorker.inspect(payload.browserSystem);
            }

            else {
                throw new Error("No execution route available for task: " + task.id);
            }

            taskQueue.update(task.id, {
                status: "COMPLETED",
                result
            });

            return {
                ok: true,
                taskId: task.id,
                route,
                result,
                queue: taskQueue.getStatus(),
                checkedAt: new Date().toISOString()
            };

        } catch (err) {
            taskQueue.update(task.id, {
                status: "FAILED",
                error: err.message
            });

            return {
                ok: false,
                taskId: task.id,
                route,
                error: err.message,
                queue: taskQueue.getStatus(),
                checkedAt: new Date().toISOString()
            };
        }
    }

    getNextQueuedTask() {
        return taskQueue
            .list("QUEUED")
            .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0] || null;
    }

    async runNext() {
        const task = this.getNextQueuedTask();

        if (!task) {
            return {
                ok: true,
                type: "NO_TASK",
                message: "No queued task available.",
                queue: taskQueue.getStatus(),
                checkedAt: new Date().toISOString()
            };
        }

        return this.executeTask(task);
    }

    async runCycle(limit = 5) {
        const results = [];

        for (let i = 0; i < limit; i++) {
            const result = await this.runNext();
            results.push(result);

            if (result.type === "NO_TASK") {
                break;
            }
        }

        return {
            ok: true,
            type: "EXECUTION_CYCLE",
            executed: results.filter(r => r.ok && r.taskId).length,
            results,
            queue: taskQueue.getStatus(),
            checkedAt: new Date().toISOString()
        };
    }
}

module.exports = new ExecutionEngine();