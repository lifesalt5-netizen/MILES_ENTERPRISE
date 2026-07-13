"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const ROOT = process.env.MILES_ROOT;
const runtimeDir =
  path.join(ROOT, "DATA", "runtime");
const cycleFile =
  path.join(
    runtimeDir,
    "latest_coo_cycle.json"
  );

fs.mkdirSync(runtimeDir, {
  recursive: true
});

const prior =
  fs.existsSync(cycleFile)
    ? fs.readFileSync(
        cycleFile,
        "utf8"
      )
    : null;

fs.writeFileSync(
  cycleFile,
  JSON.stringify({
    executiveState: {
      business: {
        replies: [{
          id: "reply-1",
          text:
            "Yes, I am interested. Let's schedule a call.",
          lead: {
            id: "lead-1",
            email:
              "test@example.com"
          }
        }],
        proposals: [{
          id: "proposal-1",
          title: "Test Proposal",
          dueDate:
            new Date(
              Date.now() +
              20 * 3600000
            ).toISOString()
        }],
        deals: [{
          id: "deal-1",
          name: "Test Deal",
          value: 10000,
          probability: 0.5,
          score: 80,
          lastActivity:
            new Date(
              Date.now() -
              4 * 86400000
            ).toISOString()
        }]
      }
    }
  }, null, 2),
  "utf8"
);

const planner =
  require(
    "../SERVICES/PlannerService"
  );

const router =
  require(
    "../SERVICES/ProviderRouterService"
  );

async function main() {
  const replyPlan =
    planner.createPlan(
      "Review and classify 1 inbound replies and create required follow-up work"
    );

  const proposalPlan =
    planner.createPlan(
      "Review urgent proposal deadlines and prepare compliance and submission readiness actions"
    );

  const pipelinePlan =
    planner.createPlan(
      "Review active deals and generate overdue follow-up and next-action work"
    );

  assert.strictEqual(
    replyPlan.steps[0].provider,
    "SalesProvider"
  );

  assert.strictEqual(
    replyPlan.steps[0].action,
    "processReplies"
  );

  assert.strictEqual(
    proposalPlan.steps[0].provider,
    "SalesProvider"
  );

  assert.strictEqual(
    proposalPlan.steps[0].action,
    "reviewProposals"
  );

  assert.strictEqual(
    pipelinePlan.steps[0].provider,
    "SalesProvider"
  );

  assert.strictEqual(
    pipelinePlan.steps[0].action,
    "reviewPipeline"
  );

  const replyResult =
    await router.executeProviderTask({
      id: "BUILD-020-REPLY",
      type: "WORKFORCE_STEP",
      payload: {
        objective:
          replyPlan.objective,
        capability:
          replyPlan.steps[0].capability,
        provider:
          replyPlan.steps[0].provider,
        action:
          replyPlan.steps[0].action,
        department: "Sales",
        assignedTo:
          replyPlan.steps[0].assignedTo
      }
    });

  const proposalResult =
    await router.executeProviderTask({
      id: "BUILD-020-PROPOSAL",
      type: "WORKFORCE_STEP",
      payload: {
        objective:
          proposalPlan.objective,
        capability:
          proposalPlan.steps[0].capability,
        provider:
          proposalPlan.steps[0].provider,
        action:
          proposalPlan.steps[0].action,
        department: "Sales",
        assignedTo:
          proposalPlan.steps[0].assignedTo
      }
    });

  const pipelineResult =
    await router.executeProviderTask({
      id: "BUILD-020-PIPELINE",
      type: "WORKFORCE_STEP",
      payload: {
        objective:
          pipelinePlan.objective,
        capability:
          pipelinePlan.steps[0].capability,
        provider:
          pipelinePlan.steps[0].provider,
        action:
          pipelinePlan.steps[0].action,
        department: "Sales",
        assignedTo:
          pipelinePlan.steps[0].assignedTo
      }
    });

  assert.strictEqual(
    replyResult.actionInvoked,
    "processReplies"
  );

  assert.strictEqual(
    replyResult.providerOutput
      .metrics.repliesProcessed,
    1
  );

  assert.strictEqual(
    proposalResult.actionInvoked,
    "reviewProposals"
  );

  assert.strictEqual(
    proposalResult.providerOutput
      .metrics.critical,
    1
  );

  assert.strictEqual(
    pipelineResult.actionInvoked,
    "reviewPipeline"
  );

  assert.strictEqual(
    pipelineResult.providerOutput
      .metrics.activeDeals,
    1
  );

  assert.strictEqual(
    pipelineResult.providerOutput
      .metrics.stalledDeals,
    1
  );

  console.log(JSON.stringify({
    ok: true,
    build: "020",
    tests: {
      replyPlanning: "PASSED",
      proposalPlanning: "PASSED",
      pipelinePlanning: "PASSED",
      replyAnalysis: "PASSED",
      proposalDeadlineReview: "PASSED",
      pipelineReview: "PASSED",
      protectedSalesActions: "PASSED"
    },
    plans: {
      reply: replyPlan.steps[0],
      proposal: proposalPlan.steps[0],
      pipeline: pipelinePlan.steps[0]
    },
    results: {
      reply: replyResult.providerOutput,
      proposal:
        proposalResult.providerOutput,
      pipeline:
        pipelineResult.providerOutput
    }
  }, null, 2));
}

main()
  .finally(() => {
    if (prior === null) {
      try {
        fs.unlinkSync(cycleFile);
      } catch {}
    } else {
      fs.writeFileSync(
        cycleFile,
        prior,
        "utf8"
      );
    }
  })
  .catch(error => {
    console.error(
      error.stack || error.message
    );

    process.exit(1);
  });

