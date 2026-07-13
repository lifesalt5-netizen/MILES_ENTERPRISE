"use strict";

const assert = require("assert");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const capabilityService =
  require("../SERVICES/CapabilityService");
const workforce =
  require("../SERVICES/WorkforceService");
const planner =
  require("../SERVICES/PlannerService");
const router =
  require("../SERVICES/ProviderRouterService");

async function main() {
  const websitePlan = planner.createPlan(
    "Repair Website: WebsiteProviderLoadFailure"
  );

  assert.strictEqual(
    websitePlan.steps[0].provider,
    "WebsiteProvider"
  );

  assert.strictEqual(
    websitePlan.steps[0].capability,
    "website.health.repair"
  );

  assert.strictEqual(
    websitePlan.steps[0].action,
    "verifyWebsite"
  );

  assert.strictEqual(
    websitePlan.steps[0].assignedTo,
    "WebsiteCOOWorker"
  );

  const websiteEmployee = workforce.findByName(
    websitePlan.steps[0].assignedTo
  );

  assert(
    websiteEmployee,
    "Enterprise preferred WebsiteCOOWorker was not available in workforce lookup."
  );

  const executivePlan = planner.createPlan(
    "Evaluate today's highest operating priority"
  );

  assert.strictEqual(
    executivePlan.steps[0].capability,
    "executive.objective.evaluate"
  );

  assert.strictEqual(
    executivePlan.steps[0].assignedTo,
    "MILES"
  );

  const milesEmployee = workforce.findByName("MILES");

  assert(
    milesEmployee,
    "MILES executive workforce profile is missing."
  );

  const providerResult =
    await router.executeProviderTask({
      id: "BUILD-018-WEBSITE-TEST",
      type: "WORKFORCE_STEP",
      payload: {
        workPackageId: "BUILD-018-WP",
        objective:
          "Repair Website: WebsiteProviderLoadFailure",
        capability: "website.health.repair",
        provider: "WebsiteProvider",
        action: "verifyWebsite",
        department: "Website",
        assignedTo:
          websitePlan.steps[0].assignedTo
      }
    });

  assert.strictEqual(
    providerResult.provider,
    "WebsiteProvider"
  );

  assert.strictEqual(
    providerResult.actionInvoked,
    "verifyWebsite"
  );

  assert.strictEqual(
    providerResult.evidence
      .authorityRegistryConsulted,
    true
  );

  assert.strictEqual(
    providerResult.evidence
      .credentialAwarenessApplied,
    true
  );

  console.log(JSON.stringify({
    ok: true,
    build: "018",
    tests: {
      enterprisePreferredWorker:
        "PASSED",
      executiveOwnership:
        "PASSED",
      plannerCompatibility:
        "PASSED",
      credentialAwareness:
        "PASSED",
      providerExecution:
        "PASSED"
    },
    websitePlanStep:
      websitePlan.steps[0],
    executivePlanStep:
      executivePlan.steps[0],
    workforceStatus:
      workforce.status(),
    providerResult
  }, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
