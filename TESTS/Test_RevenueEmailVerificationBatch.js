"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueEmailVerificationBatchService");
const { parseArguments } = require("../SCRIPTS/BuildRevenueEmailVerificationBatch");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-email-batch-"));
  const classificationRoot = path.join(root, "classification");
  fs.mkdirSync(classificationRoot);
  const records = [
    { email: "sbs@example.com", segments: ["SBS"] },
    { email: "gsa@example.com", segments: ["GSA No Sales"] },
    { email: "expired@example.com", segments: ["Expired Everything"] },
    { email: "sam@example.com", segments: ["SAM Low Sales"] },
    { email: "six@example.com", segments: ["Expiring 6 Months"] },
    { email: "cert@example.com", segments: ["HUBZone"] }
  ];
  fs.writeFileSync(path.join(classificationRoot, "pending_verification.jsonl"), records.map(JSON.stringify).join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(classificationRoot, "manifest.json"), JSON.stringify({
    ok: true, status: "CLASSIFIED", classificationFingerprint: "A".repeat(64),
    summary: { pendingVerification: records.length }, conservation: { ok: true }
  }), "utf8");
  const service = new Service({
    rootDir: root,
    classificationRoot,
    outputRoot: path.join(root, "output"),
    generatedAt: () => "2026-08-07T00:00:00.000Z"
  });

  await test("service is constructable", async () => assert.ok(service));
  const plan = service.build({});
  await test("default mode is plan-only", async () => assert.strictEqual(plan.mode, "PLAN_ONLY"));
  await test("plan performs no writes", async () => assert.strictEqual(fs.existsSync(service.outputRoot), false));
  await test("plan uses zero credits", async () => assert.strictEqual(plan.verificationCreditsUsed, 0));
  await test("plan authorizes no provider writes", async () => assert.strictEqual(plan.providerWritesAuthorized, false));
  await test("apply requires explicit credit limit", async () => assert.throws(() => service.build({ apply: true }), /credit-limit/));
  await test("zero credit limit fails closed", async () => assert.throws(() => service.build({ apply: true, creditLimit: 0 }), /credit-limit/));
  await test("fractional credit limit fails closed", async () => assert.throws(() => service.build({ apply: true, creditLimit: 1.5 }), /credit-limit/));
  const report = service.build({ apply: true, creditLimit: 3 });
  await test("apply prepares batch", async () => assert.strictEqual(report.status, "BATCH_PREPARED"));
  await test("batch respects credit cap", async () => assert.strictEqual(report.summary.selectedForVerification, 3));
  await test("remainder is deferred", async () => assert.strictEqual(report.summary.deferred, 3));
  await test("expired leads rank first", async () => assert.ok(fs.readFileSync(report.artifacts.batch.filePath, "utf8").split(/\r?\n/)[1].startsWith("expired@example.com")));
  await test("six month leads rank second", async () => assert.ok(fs.readFileSync(report.artifacts.batch.filePath, "utf8").includes("six@example.com,2")));
  await test("GSA precedes lower priority segments", async () => assert.ok(fs.readFileSync(report.artifacts.batch.filePath, "utf8").includes("gsa@example.com,4")));
  await test("priority counts are recorded", async () => assert.strictEqual(report.summary.selectedByPriority.GSA, 1));
  await test("conservation passes", async () => assert.strictEqual(report.conservation.ok, true));
  await test("batch artifact exists", async () => assert.strictEqual(fs.existsSync(report.artifacts.batch.filePath), true));
  await test("deferred artifact exists", async () => assert.strictEqual(fs.existsSync(report.artifacts.deferred.filePath), true));
  await test("artifact hash is recorded", async () => assert.match(report.artifacts.batch.sha256, /^[A-F0-9]{64}$/));
  await test("batch fingerprint is recorded", async () => assert.match(report.batchFingerprint, /^[A-F0-9]{64}$/));
  await test("no external verification occurs", async () => assert.strictEqual(report.externalVerificationRequested, false));
  await test("no credits are consumed", async () => assert.strictEqual(report.verificationCreditsUsed, 0));
  await test("no provider writes occur", async () => assert.strictEqual(report.providerWritesAuthorized, false));
  await test("no leads are uploaded", async () => assert.strictEqual(report.leadsUploaded, false));
  await test("no emails are sent", async () => assert.strictEqual(report.emailsSent, false));
  await test("CLI defaults to plan-only", async () => assert.deepStrictEqual(parseArguments([]), { apply: false, creditLimit: 0 }));
  await test("CLI parses explicit cap", async () => assert.deepStrictEqual(parseArguments(["--apply", "--credit-limit=7662"]), { apply: true, creditLimit: 7662 }));

  console.log("REVENUE_EMAIL_VERIFICATION_BATCH_TEST_PASS " + passed + "/27");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
