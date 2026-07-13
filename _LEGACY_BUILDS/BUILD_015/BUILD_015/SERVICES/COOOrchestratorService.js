const ExecutiveIntelligenceService = require("./ExecutiveIntelligenceService");
const ExecutiveBriefService = require("./ExecutiveBriefService");
const WorkQueueService = require("./WorkQueueService");
const WorkflowService = require("./WorkflowService");
const ExecutionService = require("./ExecutionService");

class COOOrchestratorService {
    constructor(options = {}) {
        this.intelligence = options.intelligence || new ExecutiveIntelligenceService();
        this.workQueue = options.workQueue || new WorkQueueService();
        this.workflowService = options.workflowService || WorkflowService;
        this.executionService = options.executionService || ExecutionService;

        this.executeRuntimeTasks =
            typeof options.executeRuntimeTasks === "boolean"
                ? options.executeRuntimeTasks
                : false;

        this.diagnostics =
            typeof options.diagnostics === "boolean"
                ? options.diagnostics
                : true;
    }

    async runOnce() {
        const startedAt = new Date().toISOString();

        await this.intelligence.refresh();

        const executiveState = this.intelligence.getExecutiveState();
        const brief = new ExecutiveBriefService(executiveState);

        const generatedWork =
            this.workQueue.generateFromExecutiveState(executiveState);

        const workflowResults =
            this.queueAuthorizedWorkflows();

        const executionResults =
            this.executeRuntimeTasks
                ? await this.runExecutionPass()
                : [];

        await this.intelligence.refresh();

        const refreshedExecutiveState = this.intelligence.getExecutiveState();
        const refreshedBrief = new ExecutiveBriefService(refreshedExecutiveState);

        return {
            ok: true,
            service: "COOOrchestratorService",
            startedAt,
            completedAt: new Date().toISOString(),
            businessHealth: refreshedExecutiveState.businessHealth,
            generatedWorkCount: generatedWork.length,
            workflowResults,
            executionResults,
            openWorkCount: this.safeCall("workQueue.getOpen", () => this.workQueue.getOpen()).length,
            escalations: this.safeCall("workQueue.getEscalations", () => this.workQueue.getEscalations()),
            executiveState: refreshedExecutiveState,
            executiveBrief: refreshedBrief.generate()
        };
    }

    queueAuthorizedWorkflows() {
        const authorized = this.safeCall(
            "workQueue.getAuthorizedPending",
            () => this.workQueue.getAuthorizedPending()
        );

        const results = [];

        for (const item of authorized) {
            if (!item || item.status !== "Pending") {
                continue;
            }

            try {
                this.assertWorkQueueLifecycle();

                const objective = item.title;
                const context = {
                    sourceWorkItemId: item.id,
                    area: item.area,
                    priority: item.priority,
                    description: item.description,
                    reason: item.reason,
                    recommendedAction: item.recommendedAction,
                    expectedImpact: item.expectedImpact,
                    relatedProvider: item.relatedProvider,
                    metadata: item.metadata || {}
                };

                const workflowResult =
                    this.workflowService.createWorkflow(objective, context);

                this.workQueue.markQueued(item.id, {
                    queuedBy: "COOOrchestratorService",
                    queuedAt: new Date().toISOString(),
                    workflowStatus: workflowResult.status,
                    workflowResult
                });

                results.push({
                    ok: true,
                    workItemId: item.id,
                    title: item.title,
                    workflowStatus: workflowResult.status,
                    workflowResult
                });
            } catch (err) {
                const diagnostic = this.buildDiagnostic(err, item);

                if (
                    this.workQueue &&
                    typeof this.workQueue.markFailed === "function"
                ) {
                    this.workQueue.markFailed(item.id, {
                        failedBy: "COOOrchestratorService",
                        error: err.message,
                        diagnostic
                    });
                }

                results.push({
                    ok: false,
                    workItemId: item.id,
                    title: item.title,
                    error: err.message,
                    diagnostic
                });
            }
        }

        return results;
    }

    async runExecutionPass() {
        const results = [];

        try {
            const result = await this.executionService.runNext();

            results.push({
                ok: true,
                result
            });
        } catch (err) {
            results.push({
                ok: false,
                error: err.message,
                stack: err.stack
            });
        }

        return results;
    }

    assertWorkQueueLifecycle() {
        const required = [
            "getAuthorizedPending",
            "getOpen",
            "getEscalations",
            "markQueued",
            "markFailed"
        ];

        const missing = required.filter(
            method => !this.workQueue || typeof this.workQueue[method] !== "function"
        );

        if (missing.length) {
            throw new Error(
                "WorkQueueService missing required lifecycle method(s): " +
                missing.join(", ")
            );
        }
    }

    safeCall(label, fn) {
        try {
            return fn();
        } catch (err) {
            if (this.diagnostics) {
                console.error(`[COOOrchestratorService] ${label} failed:`, err.message);
            }
            return [];
        }
    }

    buildDiagnostic(err, item) {
        return {
            error: err.message,
            stack: err.stack,
            workItemId: item ? item.id : null,
            workItemTitle: item ? item.title : null,
            workQueueConstructor:
                this.workQueue && this.workQueue.constructor
                    ? this.workQueue.constructor.name
                    : null,
            workQueueMethods: this.workQueue
                ? Object.getOwnPropertyNames(Object.getPrototypeOf(this.workQueue)).sort()
                : [],
            workflowServiceType:
                this.workflowService && this.workflowService.constructor
                    ? this.workflowService.constructor.name
                    : typeof this.workflowService,
            executionServiceType:
                this.executionService && this.executionService.constructor
                    ? this.executionService.constructor.name
                    : typeof this.executionService,
            checkedAt: new Date().toISOString()
        };
    }
}

module.exports = COOOrchestratorService;
