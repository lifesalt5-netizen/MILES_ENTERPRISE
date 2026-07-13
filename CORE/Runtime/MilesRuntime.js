"use strict";

const workflow = require("../../SERVICES/WorkflowService");
const execution = require("../../SERVICES/WorkforceExecutionService");
const eventBus = require("../../SERVICES/Events/EventBus");
const learning = require("../../SERVICES/Learning/LearningEngine");
const memory = require("../../SERVICES/Memory/OperationalMemoryService");
const providerRouter = require("../../SERVICES/ProviderRouterService");
const supervisor = require("../../SERVICES/Supervisor/ExecutiveSupervisor");

const DEFAULT_INTERVAL_MS = 60_000;

class MilesRuntime {
  constructor(config = {}) {
    this.intervalMs =
      config.intervalMs ||
      Number(process.env.MILES_RUNTIME_INTERVAL_MS) ||
      DEFAULT_INTERVAL_MS;

    this.running = false;
    this.loopCount = 0;

    this.stats = {
      cycles: 0,
      discoveredWork: 0,
      workflowsCreated: 0,
      tasksQueued: 0,
      tasksExecuted: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      approvalRequired: 0
    };
  }

  async start() {
    if (this.running) {
      return { ok: true, status: "ALREADY_RUNNING" };
    }

    this.running = true;

    console.log("");
    console.log("========================================");
    console.log(" MILES OS DIGITAL COO RUNTIME STARTED");
    console.log("========================================");
    console.log("");

    while (this.running) {
      await this.runCycle();
      await this.sleep(this.intervalMs);
    }

    return { ok: true, status: "STOPPED" };
  }

  stop() {
    this.running = false;
    return { ok: true, status: "STOP_REQUESTED" };
  }

  async runSingleCycle() {
    return await this.runCycle();
  }

  async runCycle() {
    this.loopCount += 1;
    this.stats.cycles += 1;

    const cycleId = `MILES-COO-CYCLE-${Date.now()}`;
    const startedAt = new Date().toISOString();

    console.log("");
    console.log(`===== MILES COO CYCLE ${this.loopCount} =====`);
    console.log("Started:", startedAt);

    eventBus.publish(
      "coo.cycle.started",
      {
        cycleId,
        loopCount: this.loopCount,
        startedAt
      },
      {
        source: "MilesRuntime"
      }
    );

    try {
      const providerStatus = providerRouter.status();

      console.log("Providers:", providerStatus.registeredProviders.join(", "));

      const supervisorResult = await supervisor.collectWork();
      const workItems = supervisorResult.work || [];

      this.stats.discoveredWork += workItems.length;

      console.log("Discovered Work:", workItems.length);

      if (workItems.length === 0) {
        console.log("No operational work discovered.");

        const learningReport = learning.analyze();
        const memoryStats = memory.statistics();

        eventBus.publish(
          "coo.cycle.completed",
          {
            cycleId,
            loopCount: this.loopCount,
            discoveredWork: 0,
            workflowsCreated: 0,
            tasksExecuted: 0,
            memoryStats,
            learningReport,
            completedAt: new Date().toISOString()
          },
          {
            source: "MilesRuntime"
          }
        );

        console.log("Memory:", memoryStats.totalExecutions, "executions");
        console.log("Learning Providers:", Object.keys(learningReport.providers).length);
        console.log("Cycle Complete");

        return {
          ok: true,
          status: "NO_WORK",
          cycleId,
          discoveredWork: 0,
          workflowsCreated: 0,
          tasksExecuted: 0,
          memoryStats,
          learningReport,
          stats: this.stats
        };
      }

      const cycleResults = [];

      for (const workItem of workItems) {
        const workResult = await this.processWorkItem(workItem, cycleId);
        cycleResults.push(workResult);
      }

      const learningReport = learning.analyze();
      const memoryStats = memory.statistics();

      const cycleSummary = {
        ok: true,
        status: "COMPLETED",
        cycleId,
        loopCount: this.loopCount,
        discoveredWork: workItems.length,
        workResults: cycleResults,
        memoryStats,
        learningReport,
        stats: this.stats,
        completedAt: new Date().toISOString()
      };

      eventBus.publish(
        "coo.cycle.completed",
        cycleSummary,
        {
          source: "MilesRuntime"
        }
      );

      console.log("Memory:", memoryStats.totalExecutions, "executions");
      console.log("Learning Providers:", Object.keys(learningReport.providers).length);
      console.log("Cycle Complete");

      return cycleSummary;
    } catch (err) {
      this.stats.tasksFailed += 1;

      console.error("Runtime cycle failed:", err.message);

      eventBus.publish(
        "coo.cycle.failed",
        {
          cycleId,
          loopCount: this.loopCount,
          error: err.message,
          failedAt: new Date().toISOString()
        },
        {
          source: "MilesRuntime"
        }
      );

      return {
        ok: false,
        status: "FAILED",
        cycleId,
        error: err.message,
        stats: this.stats
      };
    }
  }

  async processWorkItem(workItem, cycleId) {
    const objective = workItem.objective;

    console.log("");
    console.log("Work Item:", objective);
    console.log("Priority:", workItem.priority || "UNKNOWN");
    console.log("Provider:", workItem.provider || "UNKNOWN");

    eventBus.publish(
      "coo.work.started",
      {
        cycleId,
        workItem
      },
      {
        source: "MilesRuntime",
        workItemId: workItem.id || null
      }
    );

    const workflowResult = workflow.createWorkflow(objective, {
      source: "ExecutiveSupervisor",
      cycleId,
      provider: workItem.provider || null,
      domain: workItem.domain || null,
      priority: workItem.priority || null,
      priorityScore: workItem.priorityScore || null,
      discoveredWorkId: workItem.id || null,
      discoveryReason: workItem.reason || null
    });

    this.stats.workflowsCreated += 1;

    console.log("Workflow:", workflowResult.status);

    if (workflowResult.status === "AWAITING_APPROVAL") {
      this.stats.approvalRequired += 1;

      eventBus.publish(
        "coo.work.approval_required",
        {
          cycleId,
          workItem,
          workflowResult
        },
        {
          source: "MilesRuntime",
          workPackageId: workflowResult.workPackage?.id || null,
          workItemId: workItem.id || null
        }
      );

      return {
        ok: true,
        status: "AWAITING_APPROVAL",
        workItem,
        workflowResult,
        taskResults: []
      };
    }

    const queuedTasks = workflowResult.queuedTasks || [];
    this.stats.tasksQueued += queuedTasks.length;

    const taskResults = [];

    for (const task of queuedTasks) {
      const result = await execution.executeAndVerify(task);

      this.stats.tasksExecuted += 1;

      if (result.ok) {
        this.stats.tasksCompleted += 1;
      } else {
        this.stats.tasksFailed += 1;
      }

      console.log(`Task ${task.id || "UNKNOWN"} -> ${result.status}`);

      taskResults.push({
        taskId: task.id || null,
        ok: result.ok,
        status: result.status
      });
    }

    const workSummary = {
      ok: taskResults.every(t => t.ok),
      status: taskResults.every(t => t.ok) ? "COMPLETED" : "NEEDS_REVIEW",
      workItem,
      workflowStatus: workflowResult.status,
      workPackageId: workflowResult.workPackage?.id || null,
      taskCount: queuedTasks.length,
      taskResults
    };

    eventBus.publish(
      "coo.work.completed",
      {
        cycleId,
        ...workSummary
      },
      {
        source: "MilesRuntime",
        workPackageId: workflowResult.workPackage?.id || null,
        workItemId: workItem.id || null
      }
    );

    return workSummary;
  }

  status() {
    return {
      ok: true,
      running: this.running,
      intervalMs: this.intervalMs,
      loopCount: this.loopCount,
      stats: this.stats
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

if (require.main === module) {
  const runtime = new MilesRuntime();

  process.on("SIGINT", () => {
    console.log("");
    console.log("Stopping MILES runtime...");
    runtime.stop();
    process.exit(0);
  });

  runtime.start();
}

module.exports = MilesRuntime;