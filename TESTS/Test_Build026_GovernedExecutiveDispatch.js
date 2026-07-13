"use strict";

const assert = require("assert");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const AutonomousCOOLoopService =
  require("../SERVICES/AutonomousCOOLoopService");

class FakeWorkQueue {
  constructor() {
    this.items = [];
  }

  createWorkItem(input) {
    const duplicate = this.items.find(item =>
      item.title === input.title &&
      item.source === input.source &&
      item.status === "Pending"
    );

    if (duplicate) {
      return duplicate;
    }

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
      pending: this.items.filter(
        item => item.status === "Pending"
      ).length,
      escalations: this.items.filter(
        item => item.requiresKevin === true
      ).length
    };
  }

  getAll() {
    return this.items;
  }

  getAuthorizedPending() {
    return this.items.filter(item =>
      item.status === "Pending" &&
      item.requiresKevin !== true &&
      item.executionType !== "APPROVAL_REQUIRED"
    );
  }

  markQueued(id, metadata = {}) {
    const item = this.items.find(row => row.id === id);
    Object.assign(item, metadata, { status: "Queued" });
  }

  markFailed(id, metadata = {}) {
    const item = this.items.find(row => row.id === id);
    Object.assign(item, metadata, { status: "Failed" });
  }
}

class FakeIntelligence {
  async refresh() {}

  async getExecutiveState() {
    return {
      businessHealth: "Healthy",
      providers: [],
      recommendations: [],
      exceptions: [],
      business: {}
    };
  }
}

async function main() {
  const queue = new FakeWorkQueue();
  const workflowObjectives = [];

  const brief = {
    authorizedWork: [{
      priority: 1,
      area: "Google Workspace",
      action: "Review recent inbox messages.",
      objective: "Review Gmail inbox and triage recent email",
      impact: "Protects revenue response times.",
      owner: "Google Workspace COO",
      requiresKevin: false
    }],
    executiveDecisionsNeeded: [{
      priority: 1,
      area: "Sales",
      action: "Approve proposal submission.",
      objective: "Review critical proposal submission",
      impact: "Prevents a missed deadline.",
      owner: "Sales COO",
      requiresKevin: true
    }]
  };

  const loop = new AutonomousCOOLoopService({
    maxCycles: 1,
    maxExecutionPasses: 1,
    enableExecution: false,
    enableWorkflowQueueing: true,
    intelligence: new FakeIntelligence(),
    workQueue: queue,
    executiveBriefFactory: () => ({
      generate() {
        return brief;
      },
      toMarkdown() {
        return "# Test";
      }
    }),
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
        workflowObjectives.push(objective);
        return {
          ok: true,
          status: "QUEUED",
          queuedTasks: [{}],
          workPackage: {
            id: `WP-${workflowObjectives.length}`
          }
        };
      }
    }
  });

  const result = await loop.runOnce();

  assert.strictEqual(result.executiveDispatch.ok, true);
  assert.strictEqual(
    result.executiveDispatch.authorizedQueued,
    1
  );
  assert.strictEqual(
    result.executiveDispatch.ceoProtectedBlocked,
    1
  );

  const authorized = queue.items.find(
    item => item.requiresKevin === false
  );

  const protectedItem = queue.items.find(
    item => item.requiresKevin === true
  );

  assert(authorized, "Authorized work was not created.");
  assert(protectedItem, "CEO-protected work was not recorded.");

  assert.strictEqual(
    authorized.executionType,
    "WORKFLOW"
  );

  assert.strictEqual(
    protectedItem.executionType,
    "APPROVAL_REQUIRED"
  );

  assert(
    workflowObjectives.includes(
      "Review Gmail inbox and triage recent email"
    ),
    "Authorized executive objective was not sent to WorkflowService."
  );

  assert(
    !workflowObjectives.includes(
      "Review critical proposal submission"
    ),
    "CEO-protected objective was incorrectly sent to WorkflowService."
  );

  console.log(JSON.stringify({
    ok: true,
    build: "026",
    tests: {
      executiveBriefConsumption: "PASSED",
      authorizedWorkCreation: "PASSED",
      authorizedWorkflowDispatch: "PASSED",
      ceoProtectedRecording: "PASSED",
      ceoProtectedExecutionBlock: "PASSED",
      existingWorkQueueIntegration: "PASSED",
      existingWorkflowIntegration: "PASSED",
      autonomousLoopCompatibility: "PASSED"
    },
    executiveDispatch:
      result.executiveDispatch,
    workflowObjectives,
    queueItems:
      queue.items
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

