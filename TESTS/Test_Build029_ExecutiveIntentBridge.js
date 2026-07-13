"use strict";

const assert = require("assert");
const planner = require("../SERVICES/CommandIntentPlannerService");

const SUPPORTED_ACTIONS = new Set([
  "STATUS","BUSINESS_EXECUTION","INSTANTLY_LIVE","PROVIDER_AUTHORITY",
  "PROVIDER_SYNC","CONTROLLED_WRITE","WEBSITE_REVIEW",
  "ENGINEERING_IMPROVEMENT","ENGINEERING_REPORT","SELF_MAINTENANCE",
  "ORION_HEALTH","ORION_TABLES","ORION_CONTRACTORS","ORION_BUYERS",
  "ORION_OPPORTUNITIES","ORION_RECOMPETES","ORION_RECOMMENDATIONS",
  "ORION_PERSONAS","ORION_SUMMARY"
]);

function main() {
  const status = planner.plan({ command: "Miles, run STATUS." });
  assert.strictEqual(status.provider, "MILES");
  assert.strictEqual(status.action, "STATUS");

  const authority = planner.plan({ command: "Miles, run PROVIDER_AUTHORITY." });
  assert.strictEqual(authority.action, "PROVIDER_AUTHORITY");

  const instantly = planner.plan({
  command: "Miles, review Instantly campaign health, replies, warmup, and deliverability."
});

console.log("\n===== INSTANTLY PLAN =====");
console.log(JSON.stringify(instantly, null, 2));
console.log("==========================\n");
  assert.strictEqual(instantly.provider, "MILES");
  assert.strictEqual(instantly.action, "INSTANTLY_LIVE");

  const mission = planner.plan({
    command: "Miles, own Instantly end to end with Google Workspace, Namecheap, LinkedIn, existing segments, verified leads, campaigns, replies, and follow-up."
  });
  assert.strictEqual(mission.intent, "REVENUE_OPERATIONS");
  assert.strictEqual(mission.provider, "MILES");
  assert.strictEqual(mission.action, "BUSINESS_EXECUTION");
  assert.strictEqual(mission.steps.length, 5);
  assert.deepStrictEqual(
    mission.steps.map(step => step.action),
    ["PROVIDER_AUTHORITY","PROVIDER_SYNC","INSTANTLY_LIVE","BUSINESS_EXECUTION","CONTROLLED_WRITE"]
  );

  const fallback = planner.plan({
    command: "Miles, review the business and do the authorized work."
  });
  assert.notStrictEqual(fallback.action, "MILES_EXECUTE");
  assert(SUPPORTED_ACTIONS.has(fallback.action));

  console.log(JSON.stringify({
    ok: true,
    build: "029",
    tests: {
      statusRouting: "PASSED",
      authorityRouting: "PASSED",
      instantlyLiveRouting: "PASSED",
      revenueMissionClassification: "PASSED",
      multiStepExecutivePlan: "PASSED",
      unsupportedFallbackRemoved: "PASSED",
      businessExecutionFallback: "PASSED"
    },
    plans: { status, authority, instantly, mission, fallback }
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}

