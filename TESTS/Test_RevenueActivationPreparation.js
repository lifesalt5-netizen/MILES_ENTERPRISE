"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueActivationPreparationService");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log(`[PASS] ${name}`); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-activation-prep-"));
  const readiness = {
    ok: true,
    status: "RECONCILED",
    reconciliationFingerprint: "A".repeat(64),
    segments: [{
      segmentName: "GSA No Sales",
      priority: 1,
      sourceFiles: [],
      verifiedEmailCount: 0,
      assignedDomain: "outreach.example.com",
      assignedInboxes: [],
      campaignName: "GSA No Sales",
      blockers: ["SOURCE_FILE_NOT_MAPPED", "NO_VERIFIED_EMAILS", "INBOXES_NOT_ASSIGNED", "LIVE_CAMPAIGN_NOT_FOUND"]
    }, {
      segmentName: "SAM",
      priority: 2,
      sourceFiles: ["sam.csv"],
      verifiedEmailCount: 0,
      assignedDomain: "sam.example.com",
      assignedInboxes: ["sender@sam.example.com"],
      campaignName: "SAM",
      blockers: ["NO_VERIFIED_EMAILS", "LIVE_CAMPAIGN_NOT_FOUND"]
    }, {
      segmentName: "Ready",
      priority: 3,
      blockers: []
    }]
  };
  const service = new Service({ rootDir: root, outputPath: path.join(root, "queues.json"), inputProvider: () => readiness, generatedAt: () => "2026-08-07T00:00:00.000Z" });

  await test("service is constructable", async () => assert.ok(service));
  const plan = service.prepare({});
  await test("default mode is plan-only", async () => assert.strictEqual(plan.mode, "PLAN_ONLY"));
  await test("plan performs no writes", async () => assert.strictEqual(fs.existsSync(service.outputPath), false));
  await test("plan authorizes no provider writes", async () => assert.strictEqual(plan.providerWritesAuthorized, false));
  const report = service.prepare({ apply: true });
  await test("explicit apply prepares queues", async () => assert.strictEqual(report.status, "PREPARED"));
  await test("source blocker creates recovery task", async () => assert.strictEqual(report.summary.sourceRecovery, 1));
  await test("email blockers create verification tasks", async () => assert.strictEqual(report.summary.emailVerification, 2));
  await test("mailbox blocker creates routing task", async () => assert.strictEqual(report.summary.mailboxRouting, 1));
  await test("campaign blockers create preparation tasks", async () => assert.strictEqual(report.summary.campaignPreparation, 2));
  await test("verification depends on missing source recovery", async () => assert.deepStrictEqual(report.queues.emailVerification[0].dependsOn, ["source_recovery_gsa_no_sales"]));
  await test("campaign preparation depends on prior work", async () => assert.deepStrictEqual(report.queues.campaignPreparation[0].dependsOn, ["source_recovery_gsa_no_sales", "email_verification_gsa_no_sales"]));
  await test("existing source removes source dependency", async () => assert.deepStrictEqual(report.queues.emailVerification[1].dependsOn, []));
  await test("tasks are ordered by priority", async () => assert.strictEqual(report.queues.emailVerification[0].segmentName, "GSA No Sales"));
  await test("ready segment is conserved", async () => assert.strictEqual(report.summary.activationReady, 1));
  await test("queue validation passes", async () => assert.strictEqual(report.validation.ok, true));
  await test("task identities are unique", async () => assert.strictEqual(report.validation.duplicateTaskIds, 0));
  await test("all dependencies resolve", async () => assert.deepStrictEqual(report.validation.missingDependencies, []));
  await test("all external execution remains unauthorized", async () => assert.strictEqual(report.validation.authorityViolations.length, 0));
  await test("report is persisted", async () => assert.strictEqual(fs.existsSync(service.outputPath), true));
  await test("report has integrity fingerprint", async () => assert.match(report.preparationFingerprint, /^[A-F0-9]{64}$/));
  await test("artifact has integrity hash", async () => assert.match(report.artifact.sha256, /^[A-F0-9]{64}$/));
  await test("no emails are sent", async () => assert.strictEqual(report.emailsSent, false));
  await test("no leads are uploaded", async () => assert.strictEqual(report.leadsUploaded, false));
  await test("no campaigns are created", async () => assert.strictEqual(report.campaignsCreated, false));
  await test("no campaigns are changed", async () => assert.strictEqual(report.campaignsChanged, false));

  console.log(`REVENUE_ACTIVATION_PREPARATION_TEST_PASS ${passed}/25`);
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
