"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueSegmentReadinessService");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log(`[PASS] ${name}`); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-readiness-"));
  const source = path.join(root, "GSA_NO_SALES_VERIFIED.csv");
  fs.writeFileSync(source, "email,status\nreal@example.com,verified\nreal@example.com,verified\ninvalid,verified\n", "utf8");
  const inventory = {
    ok: true,
    status: "SYNCHRONIZED",
    segments: [{
      segmentName: "GSA No Sales",
      assignedDomain: "outreach.example.com",
      assignedInboxes: [],
      verifiedEmailCount: 0,
      blockers: ["SOURCE_FILE_NOT_MAPPED", "NO_VERIFIED_EMAILS", "INBOXES_NOT_ASSIGNED"]
    }, {
      segmentName: "Experimental",
      assignedDomain: "missing.example.com",
      assignedInboxes: [],
      verifiedEmailCount: 0,
      blockers: ["SOURCE_FILE_NOT_MAPPED", "NO_VERIFIED_EMAILS", "INBOXES_NOT_ASSIGNED"]
    }]
  };
  const service = new Service({
    rootDir: root,
    outputPath: path.join(root, "report.json"),
    inventoryProvider: () => inventory,
    sourceProvider: () => [{ filePath: source, exists: true, rows: 3, verifiedEmailCount: 1, verificationEvidence: "VERIFIED_FILENAME" }],
    mailboxProvider: () => [{ email: "sender@outreach.example.com", status: "ACTIVE" }, { email: "off@outreach.example.com", status: "DISABLED" }],
    generatedAt: () => "2026-08-07T00:00:00.000Z"
  });

  await test("service is constructable", async () => assert.ok(service));
  const plan = await service.reconcile({});
  await test("default mode is plan-only", async () => assert.strictEqual(plan.mode, "PLAN_ONLY"));
  await test("plan writes nothing", async () => assert.strictEqual(fs.existsSync(service.outputPath), false));
  await test("plan authorizes no external mutations", async () => assert.strictEqual(plan.externalMutationsAuthorized, false));
  const denied = await service.reconcile({ apply: true });
  await test("apply requires explicit live read", async () => assert.strictEqual(denied.status, "LIVE_READ_REQUIRED"));
  const report = await service.reconcile({ apply: true, live: true });
  await test("explicit live apply reconciles", async () => assert.strictEqual(report.status, "RECONCILED"));
  await test("exact filename maps source", async () => assert.strictEqual(report.segments[0].sourceFile, source));
  await test("explicit verification evidence counts unique emails", async () => assert.strictEqual(report.segments[0].verifiedEmailCount, 1));
  await test("exact domain assigns usable mailbox", async () => assert.deepStrictEqual(report.segments[0].assignedInboxes, ["sender@outreach.example.com"]));
  await test("disabled mailbox is rejected", async () => assert.strictEqual(report.segments[0].assignedInboxes.includes("off@outreach.example.com"), false));
  await test("resolved blockers are removed", async () => assert.deepStrictEqual(report.segments[0].blockers, []));
  await test("unmatched evidence remains blocked", async () => assert.strictEqual(report.segments[1].readinessStatus, "BLOCKED"));
  await test("report is persisted", async () => assert.strictEqual(fs.existsSync(service.outputPath), true));
  await test("report has integrity fingerprint", async () => assert.match(report.reconciliationFingerprint, /^[A-F0-9]{64}$/));
  await test("no emails are sent", async () => assert.strictEqual(report.emailsSent, false));
  await test("no leads are uploaded", async () => assert.strictEqual(report.leadsUploaded, false));
  await test("no campaigns are changed", async () => assert.strictEqual(report.campaignsChanged, false));
  await test("summary conserves segment count", async () => assert.strictEqual(report.summary.segments, 2));
  await test("unknown source does not clear blockers", async () => assert.ok(report.segments[1].blockers.includes("SOURCE_FILE_NOT_MAPPED")));
  await test("artifact records integrity hash", async () => assert.match(report.artifact.sha256, /^[A-F0-9]{64}$/));

  console.log(`REVENUE_SEGMENT_READINESS_TEST_PASS ${passed}/20`);
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
