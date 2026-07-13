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
  const resolution =
    capabilityService.resolveObjective(
      "Repair Website: WebsiteProviderLoadFailure"
    );

  assert.strictEqual(
    resolution.provider,
    "WebsiteProvider"
  );

  assert.strictEqual(
    resolution.capability,
    "website.health.repair"
  );

  assert.strictEqual(
    resolution.action,
    "verifyWebsite"
  );

  const plan =
    planner.createPlan(
      "Repair Website: WebsiteProviderLoadFailure"
    );

  assert.strictEqual(
    plan.steps[0].provider,
    "WebsiteProvider"
  );

  assert.strictEqual(
    plan.steps[0].capability,
    "website.health.repair"
  );

  assert.strictEqual(
    plan.steps[0].action,
    "verifyWebsite"
  );

  const workforceStatus =
    workforce.status();

  assert(
    workforceStatus.employees > 0,
    "No workforce records were loaded from existing MILES registries."
  );

  const routerStatus =
    router.status();

  assert(
    routerStatus.registeredProviders
      .includes("WebsiteProvider")
  );

  assert.strictEqual(
    routerStatus.providerAuthority.ok,
    true
  );

  assert.strictEqual(
    routerStatus.capabilityBindings.ok,
    true
  );

  const providerResult =
    await router.executeProviderTask({
      id: "BUILD-017-ENTERPRISE-TEST",
      type: "WORKFORCE_STEP",
      payload: {
        workPackageId:
          "BUILD-017-ENTERPRISE-WP",
        objective:
          "Repair Website: WebsiteProviderLoadFailure",
        capability:
          "website.health.repair",
        provider:
          "WebsiteProvider",
        action:
          "verifyWebsite",
        department:
          "Website",
        assignedTo:
          plan.steps[0].assignedTo
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

  console.log(JSON.stringify({
    ok: true,
    build: "017",
    tests: {
      enterpriseCapabilityResolution:
        "PASSED",
      workforceRegistryIntegration:
        "PASSED",
      plannerCompatibility:
        "PASSED",
      providerAuthorityIntegration:
        "PASSED",
      providerExecution:
        "PASSED"
    },
    resolution,
    workforceStatus,
    plannerStep:
      plan.steps[0],
    routerStatus,
    providerResult
  }, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
