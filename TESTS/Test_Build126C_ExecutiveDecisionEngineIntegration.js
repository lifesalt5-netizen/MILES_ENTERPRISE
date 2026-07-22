"use strict";

const assert = require("assert");

process.env.MILES_ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const AutonomousCOOLoopService = require("../SERVICES/AutonomousCOOLoopService");

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
    return { total: this.items.length, pending: this.items.length, escalations: 0 };
  }
  getAll() { return this.items; }
  getAuthorizedPending() { return this.items.filter(item => item.status === "Pending" && item.requiresKevin !== true); }
  markQueued(id, patch) {
    const item = this.items.find(record => record.id === id);
    Object.assign(item, patch, { status: "Queued" });
  }
  markFailed(id, patch) {
    const item = this.items.find(record => record.id === id);
    Object.assign(item, patch, { status: "Failed" });
  }
}

class FakeIntelligence {
  async refresh() { return true; }
  async getExecutiveState() {
    return {
      generatedAt: new Date().toISOString(),
      providers: [],
      recommendations: [],
      exceptions: [],
      business: {
        replies: [{ id: "reply-1" }],
        proposals: [{ id: "proposal-1", dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }],
        deals: [{ id: "deal-1", value: 10000, probability: 0.5 }],
        campaigns: [{ id: "campaign-1", status: "paused" }],
        contractors: [{ id: "contractor-1" }],
        opportunities: [{ id: "opportunity-1" }]
      }
    };
  }
}

async function main() {
  const workQueue = new FakeWorkQueue();
  const loop = new AutonomousCOOLoopService({
    maxCycles: 1,
    maxExecutionPasses: 1,
    enableExecution: false,
    enableWorkflowQueueing: false,
    intelligence: new FakeIntelligence(),
    workQueue,
    businessBridge: {
      async runOnce() {
        return { operationsFound: 0, operationsQueued: 0, operationsFailed: 0 };
      }
    }
  });

  const result = await loop.runOnce();

  assert.strictEqual(result.ok, true);
  assert(Array.isArray(result.mission.priorities), "Mission priorities were not produced.");
  assert(result.mission.priorities.length > 0, "Mission priorities were empty.");

  const first = result.mission.priorities[0];
  assert.ok("score" in first, "Top mission is missing score.");
  assert.ok("rank" in first, "Top mission is missing rank.");
  assert.ok("reason" in first, "Top mission is missing reason.");
  assert.ok("expectedBusinessImpact" in first, "Top mission is missing expectedBusinessImpact.");
  assert.ok("requiresCEO" in first, "Top mission is missing requiresCEO.");
  assert.strictEqual(first.rank, 1, "Top mission rank should be 1.");
  assert.strictEqual(result.mission.topPriority?.id, first.id, "Top priority should match the top ranked mission.");

  assert.strictEqual(workQueue.items.length > 0, true, "Work items were not created for ranked missions.");

  console.log(JSON.stringify({
    ok: true,
    build: "126C",
    topPriority: first,
    createdItems: workQueue.items.length
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
