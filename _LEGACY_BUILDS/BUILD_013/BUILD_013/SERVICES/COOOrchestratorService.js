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
            openWorkCount: this.workQueue.getOpen().length,
            escalations: this.workQueue.getEscalations(),
            executiveState: refreshedExecutiveState,
            executiveBrief: refreshedBrief.generate()
        };
    }

    queueAuthorizedWorkflows() {
        const authorized = this.workQueue.getAuthorizedPending();
        const results = [];

        for (const item of authorized) {
            try {
                if (item.status !== "Pending") {
                    continue;
                }

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
                this.workQueue.markFailed(item.id, {
                    failedBy: "COOOrchestratorService",
                    error: err.message
                });

                results.push({
                    ok: false,
                    workItemId: item.id,
                    title: item.title,
                    error: err.message
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
                error: err.message
            });
        }

        return results;
    }
}

module.exports = COOOrchestratorService;
