"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const planner =
  require(
    "../SERVICES/PlannerService"
  );

const router =
  require(
    "../SERVICES/ProviderRouterService"
  );

const GoogleWorkspaceProvider =
  require(
    "../PROVIDERS/providers/GoogleWorkspaceProvider"
  );

async function main() {
  const fakeAccountManager = {
    listAccounts() {
      return [
        {
          accountKey:
            "kevin_at_pathways2gc.com",
          email:
            "kevin@pathways2gc.com",
          valid: true
        },
        {
          accountKey:
            "info_at_pathways2gc.com",
          email:
            "info@pathways2gc.com",
          valid: true
        }
      ];
    }
  };

  const fakeWorkspace = {
    async getWorkspaceSnapshot(
      accountKey
    ) {
      return {
        account:
          accountKey.includes("kevin")
            ? "kevin@pathways2gc.com"
            : "info@pathways2gc.com",
        inboxEstimate: 100,
        recentInboxCount: 5,
        upcomingEventsCount: 2,
        recentDriveFilesCount: 3
      };
    }
  };

  const provider =
    new GoogleWorkspaceProvider({
      accountManager:
        fakeAccountManager,
      workspace:
        fakeWorkspace
    });

  const audit =
    await provider.auditWorkspace();

  assert.strictEqual(
    audit.provider,
    "GoogleWorkspaceProvider"
  );

  assert.strictEqual(
    audit.readOnly,
    true
  );

  assert.strictEqual(
    audit.status,
    "Healthy"
  );

  assert.strictEqual(
    audit.metrics.registeredAccounts,
    2
  );

  assert.strictEqual(
    audit.metrics.healthyAccounts,
    2
  );

  assert.strictEqual(
    audit.metrics.recentInboxCount,
    10
  );

  assert.strictEqual(
    audit.metrics.upcomingEventsCount,
    4
  );

  assert.strictEqual(
    audit.metrics.recentDriveFilesCount,
    6
  );

  assert.strictEqual(
    audit.safety.emailSendingEnabled,
    false
  );

  assert.strictEqual(
    audit.safety.calendarWritesEnabled,
    false
  );

  assert.strictEqual(
    audit.safety.driveWritesEnabled,
    false
  );

  assert(
    fs.existsSync(
      audit.evidenceFile
    ),
    "Google Workspace COO evidence file was not created."
  );

  const inboxPlan =
    planner.createPlan(
      "Review Gmail inbox and triage recent email"
    );

  const calendarPlan =
    planner.createPlan(
      "Review upcoming calendar meetings"
    );

  const drivePlan =
    planner.createPlan(
      "Review Google Drive files"
    );

  assert.strictEqual(
    inboxPlan.steps[0].provider,
    "GoogleWorkspaceProvider"
  );

  assert.strictEqual(
    inboxPlan.steps[0].action,
    "reviewInbox"
  );

  assert.strictEqual(
    calendarPlan.steps[0].provider,
    "GoogleWorkspaceProvider"
  );

  assert.strictEqual(
    calendarPlan.steps[0].action,
    "reviewCalendar"
  );

  assert.strictEqual(
    drivePlan.steps[0].provider,
    "GoogleWorkspaceProvider"
  );

  assert.strictEqual(
    drivePlan.steps[0].action,
    "reviewDrive"
  );

  const routerStatus =
    router.status();

  assert(
    routerStatus
      .registeredProviders
      .includes(
        "GoogleWorkspaceProvider"
      )
  );

  console.log(JSON.stringify({
    ok: true,
    build: "024",
    tests: {
      accountRegistryIntegration:
        "PASSED",
      workspaceSnapshotIntegration:
        "PASSED",
      gmailReadOnlyReview:
        "PASSED",
      calendarReadOnlyReview:
        "PASSED",
      driveReadOnlyReview:
        "PASSED",
      capabilityPlanning:
        "PASSED",
      providerRouting:
        "PASSED",
      readOnlySafety:
        "PASSED",
      evidencePersistence:
        "PASSED"
    },
    metrics:
      audit.metrics,
    recommendations:
      audit.recommendations,
    plans: {
      inbox:
        inboxPlan.steps[0],
      calendar:
        calendarPlan.steps[0],
      drive:
        drivePlan.steps[0]
    },
    safety:
      audit.safety,
    evidenceFile:
      audit.evidenceFile
  }, null, 2));
}

main().catch(error => {
  console.error(
    error.stack ||
    error.message
  );

  process.exit(1);
});

