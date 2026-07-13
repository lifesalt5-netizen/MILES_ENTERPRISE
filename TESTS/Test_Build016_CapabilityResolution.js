"use strict";

const assert = require("assert");
const capabilityService = require("../SERVICES/CapabilityService");
const planner = require("../SERVICES/PlannerService");
const providerRouter = require("../SERVICES/ProviderRouterService");

async function main() {
  const websiteResolution = capabilityService.resolveObjective(
    "Repair Website: WebsiteProviderLoadFailure"
  );

  assert.strictEqual(websiteResolution.provider, "WebsiteProvider");
  assert.strictEqual(websiteResolution.department, "Website");
  assert.strictEqual(websiteResolution.capability, "website.health.repair");
  assert.strictEqual(websiteResolution.action, "verifyWebsite");

  const criticalResolution = capabilityService.resolveObjective(
    "Critical exception: WebsiteProviderLoadFailure"
  );

  assert.strictEqual(criticalResolution.provider, "WebsiteProvider");
  assert.strictEqual(criticalResolution.department, "Website");
  assert.strictEqual(criticalResolution.capability, "website.health.repair");
  assert.strictEqual(criticalResolution.action, "verifyWebsite");

  const instantlyResolution = capabilityService.resolveObjective(
    "Audit Instantly campaign health"
  );

  assert.strictEqual(instantlyResolution.provider, "MarketingProvider");
  assert.strictEqual(instantlyResolution.capability, "marketing.campaign.audit");

  const orionResolution = capabilityService.resolveObjective(
    "Refresh ORION data"
  );

  assert.strictEqual(orionResolution.provider, "OrionProvider");
  assert.strictEqual(orionResolution.capability, "orion.refresh");

  const plan = planner.createPlan(
    "Repair Website: WebsiteProviderLoadFailure"
  );

  assert.strictEqual(plan.steps.length, 1);
  assert.strictEqual(plan.steps[0].provider, "WebsiteProvider");
  assert.strictEqual(plan.steps[0].department, "Website");
  assert.strictEqual(plan.steps[0].capability, "website.health.repair");
  assert.strictEqual(plan.steps[0].action, "verifyWebsite");
  assert.strictEqual(plan.steps[0].taskType, "WORKFORCE_STEP");
  assert.strictEqual(plan.approvalRequired, false);

  const routerStatus = providerRouter.status();
  assert(routerStatus.registeredProviders.includes("WebsiteProvider"));
  assert(routerStatus.registeredProviders.includes("MarketingProvider"));
  assert(routerStatus.registeredProviders.includes("OrionProvider"));
  assert.strictEqual(
    providerRouter.normalizeProviderName("website"),
    "WebsiteProvider"
  );
  assert.strictEqual(
    providerRouter.normalizeProviderName("b12"),
    "WebsiteProvider"
  );

  const providerResult = await providerRouter.executeProviderTask({
    id: "BUILD-016-TEST",
    type: "WORKFORCE_STEP",
    payload: {
      workPackageId: "BUILD-016-WP",
      objective: "Repair Website: WebsiteProviderLoadFailure",
      provider: "WebsiteProvider",
      department: "Website",
      capability: "website.health.repair",
      action: "verifyWebsite",
      assignedTo: "MILES"
    }
  });

  assert.strictEqual(providerResult.provider, "WebsiteProvider");
  assert.strictEqual(providerResult.routedTo, "WebsiteProvider");
  assert.strictEqual(providerResult.action, "verifyWebsite");
  assert.strictEqual(providerResult.actionInvoked, "verifyWebsite");
  assert.strictEqual(
    providerResult.evidence.actionAvailable,
    true
  );
  assert.notStrictEqual(providerResult.type, "NO_PROVIDER_RESULT");

  console.log(JSON.stringify({
    ok: true,
    build: "016",
    tests: {
      capabilityResolution: "PASSED",
      plannerResolution: "PASSED",
      providerRegistration: "PASSED",
      providerActionDispatch: "PASSED"
    },
    websiteResolution,
    planStep: plan.steps[0],
    routerStatus,
    providerResult
  }, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
