"use strict";

const assert = require("assert");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const capabilityService =
  require("../SERVICES/CapabilityService");

const planner =
  require("../SERVICES/PlannerService");

const router =
  require("../SERVICES/ProviderRouterService");

function assertPlan(objective, capability, action) {
  const plan = planner.createPlan(objective);
  const step = plan.steps[0];

  assert.strictEqual(step.provider, "GoogleWorkspaceProvider");
  assert.strictEqual(step.capability, capability);
  assert.strictEqual(step.action, action);

  return step;
}

function main() {
  const registry = capabilityService.registry();

  for (const capability of [
    "google.workspace.audit",
    "google.inbox.review",
    "google.calendar.review",
    "google.drive.review"
  ]) {
    assert(
      registry.some(entry => entry.capability === capability),
      `Missing capability registration: ${capability}`
    );
  }

  const workspace = assertPlan(
    "Audit Google Workspace health and status",
    "google.workspace.audit",
    "auditWorkspace"
  );

  const inbox = assertPlan(
    "Review Gmail inbox and triage recent email",
    "google.inbox.review",
    "reviewInbox"
  );

  const calendar = assertPlan(
    "Review upcoming calendar meetings",
    "google.calendar.review",
    "reviewCalendar"
  );

  const drive = assertPlan(
    "Review Google Drive files",
    "google.drive.review",
    "reviewDrive"
  );

  const routerStatus = router.status();

  assert(
    routerStatus.registeredProviders.includes(
      "GoogleWorkspaceProvider"
    ),
    "GoogleWorkspaceProvider is not registered in ProviderRouterService."
  );

  console.log(JSON.stringify({
    ok: true,
    build: "024A",
    tests: {
      completeReplacementSyntax: "PASSED",
      capabilityRegistration: "PASSED",
      workspacePlanning: "PASSED",
      inboxPlanning: "PASSED",
      calendarPlanning: "PASSED",
      drivePlanning: "PASSED",
      providerRegistration: "PASSED"
    },
    plans: {
      workspace,
      inbox,
      calendar,
      drive
    },
    routerStatus
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}

