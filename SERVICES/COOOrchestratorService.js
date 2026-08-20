"use strict";

/*
  MILES OS
  File: SERVICES/COOOrchestratorService.js
  Version: 1.2.0
  Purpose:
    Production COO orchestrator.

  Critical integration:
    Business Operations Queue
      ↓
    BusinessOperationsBridgeService
      ↓
    TaskQueue
      ↓
    ExecutionService
      ↓
    Workers / Connectors
*/

const ExecutiveIntelligenceService = require("./ExecutiveIntelligenceService");
const ExecutiveBriefService = require("./ExecutiveBriefService");
const WorkQueueService = require("./WorkQueueService");
const WorkflowService = require("./WorkflowService");
const ExecutionService = require("./ExecutionService");
const BusinessOperationsBridgeService = require("./BusinessOperationsBridgeService");
const CalendlyRevenuePipelineService = require("./CalendlyRevenuePipelineService");
const { attachMeetingPipelineToBrief } = require("./CalendlyExecutiveBriefAdapter");

class COOOrchestratorService {
  constructor(options = {}) {
    this.rootDir =
      options.rootDir ||
      process.env.MILES_ROOT ||
      process.cwd();

    this.intelligence =
      options.intelligence ||
      new ExecutiveIntelligenceService();

    this.workQueue =
      options.workQueue ||
      new WorkQueueService();

    this.workflowService =
      options.workflowService ||
      WorkflowService;

    this.executionService =
      options.executionService ||
      ExecutionService;

    this.businessBridge =
      options.businessBridge ||
      new BusinessOperationsBridgeService({
        rootDir: this.rootDir
      });

    this.calendlyRevenuePipeline =
      options.calendlyRevenuePipeline ||
      new CalendlyRevenuePipelineService({
        rootDir: this.rootDir
      });

    this.executeRuntimeTasks =
      typeof options.executeRuntimeTasks === "boolean"
        ? options.executeRuntimeTasks
        : true;

    this.maxExecutionPasses =
      Number(options.maxExecutionPasses || process.env.MILES_MAX_EXECUTION_PASSES || 5);
  }

  async runOnce() {
    const startedAt = new Date().toISOString();

    await this.intelligence.refresh();

    const executiveState = this.intelligence.getExecutiveState();

    const generatedWork =
      this.workQueue.generateFromExecutiveState(executiveState);

    const workflowResults =
      this.queueAuthorizedWorkflows();

    const businessBridgeResults =
      await this.runBusinessOperationsBridge();

    const executionResults =
      this.executeRuntimeTasks
        ? await this.runExecutionPasses()
        : [];

    const calendlyRevenuePipelineResult =
      await this.refreshCalendlyRevenuePipeline();

    await this.intelligence.refresh();

    const refreshedExecutiveState =
      this.intelligence.getExecutiveState();

    const refreshedBrief =
      new ExecutiveBriefService(refreshedExecutiveState);

    const executiveBrief =
      attachMeetingPipelineToBrief(
        refreshedBrief.generate(),
        calendlyRevenuePipelineResult
      );

    return {
      ok: true,
      service: "COOOrchestratorService",
      startedAt,
      completedAt: new Date().toISOString(),
      businessHealth: refreshedExecutiveState.businessHealth,
      generatedWorkCount: generatedWork.length,
      workflowResults,
      businessBridgeResults,
      executionResults,
      calendlyRevenuePipelineResult,
      openWorkCount: this.workQueue.getOpen().length,
      escalations: this.workQueue.getEscalations(),
      executiveState: refreshedExecutiveState,
      executiveBrief
    };
  }

  async refreshCalendlyRevenuePipeline() {
    try {
      if (
        !this.calendlyRevenuePipeline ||
        typeof this.calendlyRevenuePipeline.runOnce !== "function"
      ) {
        return {
          ok: false,
          status: "CALENDLY_REVENUE_PIPELINE_UNAVAILABLE",
          error: "Calendly revenue pipeline service is unavailable."
        };
      }

      return await this.calendlyRevenuePipeline.runOnce();
    } catch (error) {
      return {
        ok: false,
        status: "CALENDLY_REVENUE_PIPELINE_FAILED",
        error: error.message,
        generatedAt: new Date().toISOString()
      };
    }
  }

  async runBusinessOperationsBridge() {
    try {
      if (
        this.businessBridge &&
        typeof this.businessBridge.runOnce === "function"
      ) {
        return await this.businessBridge.runOnce();
      }

      return {
        ok: false,
        status: "BUSINESS_OPERATIONS_BRIDGE_UNAVAILABLE",
        operationsFound: 0,
        operationsQueued: 0,
        operationsFailed: 0
      };
    } catch (error) {
      return {
        ok: false,
        status: "BUSINESS_OPERATIONS_BRIDGE_FAILED",
        operationsFound: 0,
        operationsQueued: 0,
        operationsFailed: 1,
        error: error.message
      };
    }
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

  async runExecutionPasses() {
    const results = [];

    for (let i = 0; i < this.maxExecutionPasses; i++) {
      try {
        const result = await this.executionService.runNext();

        results.push({
          ok: true,
          pass: i + 1,
          result
        });

        if (result && result.message === "No queued tasks") {
          break;
        }
      } catch (err) {
        results.push({
          ok: false,
          pass: i + 1,
          error: err.message
        });

        break;
      }
    }

    return results;
  }

  async runExecutionPass() {
    return this.runExecutionPasses();
  }
}

module.exports = COOOrchestratorService;