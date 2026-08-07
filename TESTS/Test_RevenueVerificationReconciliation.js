"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueVerificationReconciliationService");
const { parseArguments } = require("../SCRIPTS/ReconcileRevenueEmailVerification");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-verify-reconcile-"));
  const batchRoot = path.join(root, "batch");
  fs.mkdirSync(batchRoot);
  fs.writeFileSync(path.join(batchRoot, "millionverifier_batch.csv"),
    "email,verification_priority,priority_segment,segments\n" +
    "good@example.com,3,Expiring 12 Months,GSA\n" +
    "catch@example.com,4,GSA,GSA\n" +
    "unknown@example.com,5,VA,VA\n" +
    "bad@example.com,7,Certifications,WOSB\n", "utf8");
  fs.writeFileSync(path.join(batchRoot, "manifest.json"), JSON.stringify({
    ok: true, status: "BATCH_PREPARED", batchFingerprint: "B".repeat(64), conservation: { ok: true }
  }), "utf8");
  const reportPath = path.join(root, "report.csv");
  fs.writeFileSync(reportPath,
    "email,quality,result,free,role,verification_priority,priority_segment,segments\n" +
    "good@example.com,good,ok,no,no,3,Expiring 12 Months,GSA\n" +
    "catch@example.com,risky,catch_all,no,yes,4,GSA,GSA\n" +
    "unknown@example.com,risky,unknown,yes,no,5,VA,VA\n" +
    "bad@example.com,bad,invalid,no,no,7,Certifications,WOSB\n", "utf8");
  const service = new Service({ rootDir: root, batchRoot, outputRoot: path.join(root, "output"), generatedAt: () => "2026-08-07T00:00:00.000Z" });

  await test("service is constructable", async () => assert.ok(service));
  const plan = service.reconcile({});
  await test("default mode is plan-only", async () => assert.strictEqual(plan.mode, "PLAN_ONLY"));
  await test("plan performs no writes", async () => assert.strictEqual(fs.existsSync(service.outputRoot), false));
  await test("plan authorizes no provider writes", async () => assert.strictEqual(plan.providerWritesAuthorized, false));
  await test("apply requires report", async () => assert.throws(() => service.reconcile({ apply: true }), /report/));
  const result = service.reconcile({ apply: true, reportPath });
  await test("report reconciles", async () => assert.strictEqual(result.status, "RECONCILED"));
  await test("exact batch match passes", async () => assert.strictEqual(result.exactBatchMatch.ok, true));
  await test("good becomes send-ready", async () => assert.strictEqual(result.summary.sendReady, 1));
  await test("catch-all and unknown stay blocked", async () => assert.strictEqual(result.summary.riskyBlocked, 2));
  await test("invalid becomes do-not-mail", async () => assert.strictEqual(result.summary.doNotMail, 1));
  await test("result counts are preserved", async () => assert.deepStrictEqual(result.summary.resultCounts, { ok: 1, catch_all: 1, unknown: 1, invalid: 1 }));
  await test("free address count is recorded", async () => assert.strictEqual(result.summary.freeAddresses, 1));
  await test("role address count is recorded", async () => assert.strictEqual(result.summary.roleAddresses, 1));
  await test("conservation passes", async () => assert.strictEqual(result.conservation.ok, true));
  await test("send-ready artifact exists", async () => assert.strictEqual(fs.existsSync(result.artifacts.sendReady.filePath), true));
  await test("risky artifact exists", async () => assert.strictEqual(fs.existsSync(result.artifacts.risky.filePath), true));
  await test("do-not-mail artifact exists", async () => assert.strictEqual(fs.existsSync(result.artifacts.doNotMail.filePath), true));
  await test("report hash is recorded", async () => assert.match(result.reportSha256, /^[A-F0-9]{64}$/));
  await test("fingerprint is recorded", async () => assert.match(result.reconciliationFingerprint, /^[A-F0-9]{64}$/));
  await test("no provider writes occur", async () => assert.strictEqual(result.providerWritesAuthorized, false));
  await test("no leads are uploaded", async () => assert.strictEqual(result.leadsUploaded, false));
  await test("no emails are sent", async () => assert.strictEqual(result.emailsSent, false));
  await test("no campaigns change", async () => assert.strictEqual(result.campaignsChanged, false));

  fs.writeFileSync(path.join(root, "missing.csv"), "email,quality,result\nextra@example.com,good,ok\n", "utf8");
  await test("mismatched report fails closed", async () => assert.throws(() => service.reconcile({ apply: true, reportPath: path.join(root, "missing.csv") }), /exactly match/));
  fs.writeFileSync(path.join(root, "duplicate.csv"), "email,quality,result\ngood@example.com,good,ok\ngood@example.com,good,ok\nunknown@example.com,risky,unknown\nbad@example.com,bad,invalid\n", "utf8");
  await test("duplicate report fails closed", async () => assert.throws(() => service.reconcile({ apply: true, reportPath: path.join(root, "duplicate.csv") }), /duplicate/));
  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { apply: false, reportPath: null }));
  await test("CLI parses explicit report", async () => assert.deepStrictEqual(parseArguments(["--apply", "--report=C:\\\\report.csv"]), { apply: true, reportPath: "C:\\\\report.csv" }));

  console.log("REVENUE_VERIFICATION_RECONCILIATION_TEST_PASS " + passed + "/27");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
