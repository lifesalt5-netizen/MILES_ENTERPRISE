"use strict";

const assert = require("assert");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const AutonomousCOOLoopService =
  require("../SERVICES/AutonomousCOOLoopService");

class FakeIntelligence {
  async refresh() {
    return true;
  }

  async getExecutiveState() {
    return {
      generatedAt: new Date().toISOString(),
      providers: [
        {
          provider: "Website",
          status: "Watch",
          dataFreshness: "Live",
          lastRefresh: new Date().toISOString(),
          exceptions: [],
          recommendations: ["Verify website health."],
          metrics: {}
        },
        {
          provider: "Instantly",
          status: "Watch",
          dataFreshness: "Live",
          lastRefresh: new Date().toISOString(),
          exceptions: [],
          recommendations: ["Audit campaign health."],
          metrics: {}
        },
        {
          provider: "ORION",
          status: "Healthy",
          dataFreshness: "Live",
          lastRefresh: new Date().toISOString(),
          exceptions: [],
          recommendations: [],
          metrics: {}
        }
      ],
      business: {
        replies: [{ id: "reply-1" }],
        proposals: [{
          id: "proposal-1",
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }],
        deals: [{
          id: "deal-1",
          value: 10000,
          probability: 0.5
        }],
        campaigns: [
          { id: "campaign-1", status: "paused" },
          { id: "campaign-2", status: "active" }
        ],
        contractors: [{ id: "contractor-1" }],
        opportunities: [{ id: "opportunity-1" }]
      },
      recommendations: [],
      exceptions: []
    };
  }
}

class FakeWorkQueue {
  constructor() {
    this.items = [];
  }

  createWorkItem(input) {
    const item = {
      id: `WORK-${this.items.length + 1}`,
      status: "Pending",
      ...input
    };

    this.items.push(item);
    return item;
  }

  load() {}

  getStats() {
    return {
      total: this.items.length,
      pending: this.items.filter(item => item.status === "Pending").length,
      escalations: 0
    };
  }

  getAll() {
    return this.items;
  }

  getAuthorizedPending() {
    return this.items.filter(
      item =>
        item.status === "Pending" &&
        item.requiresKevin !== true
    );
  }

  markQueued(id, patch) {
    const item = this.items.find(record => record.id === id);
    Object.assign(item, patch, { status: "Queued" });
  }

  markFailed(id, patch) {
    const item = this.items.find(record => record.id === id);
    Object.assign(item, patch, { status: "Failed" });
  }
}

async function main() {
  const workQueue = new FakeWorkQueue();
  const objectives = [];

  const loop = new AutonomousCOOLoopService({
    maxCycles: 1,
    maxExecutionPasses: 2,
    enableExecution: true,
    enableWorkflowQueueing: true,
    intelligence: new FakeIntelligence(),
    workQueue,
    businessBridge: {
      async runOnce() {
        return {
          operationsFound: 0,
          operationsQueued: 0,
          operationsFailed: 0
        };
      }
    },
    workflowService: {
      createWorkflow(objective) {
        objectives.push(objective);

        return {
          ok: true,
          status: "QUEUED",
          queuedTasks: [{}],
          workPackage: {
            id: `WP-${objectives.length}`
          }
        };
      }
    },
    executionService: {
      async runNext() {
        return {
          ok: true,
          message: "No queued tasks"
        };
      }
    }
  });

  const result = await loop.runOnce();

  assert.strictEqual(result.ok, true);

  assert.strictEqual(
    result.executiveState.business.replies.length,
    1,
    "Executive state was not awaited before mission planning."
  );

  assert(
    result.mission.priorities.some(item =>
      /reply|proposal|pipeline|revenue/i.test(
        `${item.title} ${item.objective}`
      )
    ),
    "Revenue-first mission objective was not generated."
  );

  assert(
    objectives.some(objective => /website/i.test(objective)),
    "Website operational objective was not routed to WorkflowService."
  );

  assert(
    objectives.some(objective => /instantly|campaign/i.test(objective)),
    "Instantly operational objective was not routed to WorkflowService."
  );

  assert(
    objectives.some(objective => /orion/i.test(objective)),
    "ORION operational objective was not routed to WorkflowService."
  );

  assert(
    objectives.some(objective =>
      /reply|proposal|pipeline|revenue/i.test(objective)
    ),
    "Revenue operational objective was not routed to WorkflowService."
  );

  for (const objective of objectives) {
    assert(
      !/^Investigate .+ watch condition$/i.test(objective),
      `A generic mission title was sent to the planner instead of an operational objective: ${objective}`
    );
  }

  console.log(JSON.stringify({
    ok: true,
    build: "019",
    tests: {
      asynchronousExecutiveState: "PASSED",
      revenueFirstObjectives: "PASSED",
      providerOperationalObjectives: "PASSED",
      existingWorkflowIntegration: "PASSED",
      executionPassCompatibility: "PASSED"
    },
    missionPriorities: result.mission.priorities.map(item => ({
      priority: item.priority,
      area: item.area,
      title: item.title,
      objective: item.objective
    })),
    workflowObjectives: objectives
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

