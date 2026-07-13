"use strict";

const assert =
  require("assert");

const capabilityService =
  require(
    "../SERVICES/CapabilityService"
  );

function stepFor(objective) {
  const plan =
    capabilityService
      .planObjective(objective);

  return {
    plan,
    step:
      plan.operationalPlan
        .steps[0]
  };
}

function main() {
  const sales =
    stepFor(
      "Build Sales COO pipeline and follow-up operator"
    );

  assert.strictEqual(
    sales.step.capability,
    "sales.pipeline.followup"
  );
  assert.strictEqual(
    sales.step.provider,
    "SalesProvider"
  );
  assert.strictEqual(
    sales.step.action,
    "reviewPipeline"
  );

  const stalled =
    stepFor(
      "Review stalled sales opportunities and create follow-up recommendations"
    );

  assert.strictEqual(
    stalled.step.provider,
    "SalesProvider"
  );
  assert.strictEqual(
    stalled.step.action,
    "reviewPipeline"
  );

  const segments =
    stepFor(
      "Identify depleted outreach segments and create enrichment work"
    );

  assert.strictEqual(
    segments.step.capability,
    "marketing.segment.replenish"
  );
  assert.strictEqual(
    segments.step.provider,
    "MarketingProvider"
  );
  assert.strictEqual(
    segments.step.action,
    "refresh"
  );

  const government =
    stepFor(
      "Add source monitors for SAM, GSA, VA, forecasts, RFIs, and Sources Sought."
    );

  assert.strictEqual(
    government.step.capability,
    "government.data.refresh.monitor"
  );
  assert.strictEqual(
    government.step.provider,
    "OrionProvider"
  );
  assert.strictEqual(
    government.step.action,
    "refresh"
  );

  const outbound =
    stepFor(
      "Own Instantly and expand outbound capacity using campaigns, mailboxes, segments, and verified leads."
    );

  assert.strictEqual(
    outbound.step.capability,
    "revenue.outbound.audit"
  );
  assert.strictEqual(
    outbound.step.provider,
    "MarketingProvider"
  );

  const unknown =
    stepFor(
      "Prepare an unrelated executive matter"
    );

  assert.strictEqual(
    unknown.step.capability,
    "executive.objective.evaluate"
  );

  console.log(JSON.stringify({
    ok: true,
    build: "032",
    tests: {
      salesPipelineProviderRouting:
        "PASSED",
      stalledDealProviderRouting:
        "PASSED",
      depletedSegmentProviderRouting:
        "PASSED",
      governmentDataProviderRouting:
        "PASSED",
      outboundProviderRouting:
        "PASSED",
      executiveFallbackPreserved:
        "PASSED"
    },
    plans: {
      sales: sales.plan,
      stalled: stalled.plan,
      segments: segments.plan,
      government: government.plan,
      outbound: outbound.plan,
      unknown: unknown.plan
    }
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(
    error.stack ||
    error.message
  );
  process.exit(1);
}

