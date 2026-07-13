"use strict";

const audit = require("./ExecutionAuditService");
const escalation = require("./EscalationManagerService");
const retry = require("./RetryManagerService");

function optionalRequire(modulePath) {
    try { return require(modulePath); } catch { return null; }
}

class ExecutionDispatcherService {
    async dispatch(task = {}, input = {}) {
        const generatedAt = new Date().toISOString();
        const escalationResult = escalation.evaluate(task.payload?.sourceWorkItem || task);
        if (escalationResult.escalated) {
            const record = { ok: true, status: "AWAITING_CEO_APPROVAL", executed: false, verified: false, task, escalation: escalationResult, generatedAt };
            audit.record({ event: "TASK_ESCALATED", record });
            return record;
        }

        if (!task.executable || !task.credentialsPresent) {
            const record = {
                ok: true,
                status: "WAITING_FOR_EXECUTABLE_PROVIDER",
                executed: false,
                verified: false,
                task,
                message: `Provider ${task.provider} is not executable or credentials are missing.`,
                generatedAt
            };
            audit.record({ event: "TASK_WAITING_PROVIDER", record });
            return record;
        }

        const providerExecution = optionalRequire("./ProviderControllerExecutionService");
        if (!providerExecution || typeof providerExecution.run !== "function") {
            const record = { ok: true, status: "PROVIDER_EXECUTION_SERVICE_NOT_AVAILABLE", executed: false, verified: false, task, generatedAt };
            audit.record({ event: "TASK_EXECUTION_BLOCKED", record });
            return record;
        }

        try {
            const result = await providerExecution.run({ provider: task.provider, operation: task.operation, payload: task.payload, dryRun: input.dryRun !== false });
            const retryResult = retry.shouldRetry(result, task);
            const record = {
                ok: true,
                status: result.status || (result.verified ? "VERIFIED" : "EXECUTED"),
                executed: Boolean(result.executed),
                verified: Boolean(result.verified),
                task,
                providerResult: result,
                retry: retryResult,
                generatedAt
            };
            audit.record({ event: "TASK_DISPATCHED", record });
            return record;
        } catch (error) {
            const record = { ok: false, status: "DISPATCH_ERROR", executed: false, verified: false, task, error: error.message, generatedAt };
            audit.record({ event: "TASK_DISPATCH_ERROR", record });
            return record;
        }
    }
}

module.exports = new ExecutionDispatcherService();
