"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueLeadInventoryClassificationService");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log(`[PASS] ${name}`); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-lead-classify-"));
  const sources = path.join(root, "sources");
  fs.mkdirSync(sources);
  fs.writeFileSync(path.join(sources, "SBS_OK_ONLY_MILLIONVERIFIER.csv"), "Email,Segment\nverified@example.com,SBS\nconflict@example.com,SBS\n", "utf8");
  fs.writeFileSync(path.join(sources, "GSA_SEGMENT.csv"), "Contact Email,Verification Status,Primary Segment\npending@example.com,,GSA\ninvalid@example.com,invalid,GSA\nconflict@example.com,invalid,GSA\nnot-email,valid,GSA\n", "utf8");
  fs.writeFileSync(path.join(sources, "notes.csv"), "Email\nignored@example.com\n", "utf8");
  const service = new Service({ rootDir: root, sourceRoots: [sources], outputRoot: path.join(root, "output"), generatedAt: () => "2026-08-07T00:00:00.000Z" });

  await test("service is constructable", async () => assert.ok(service));
  const plan = service.classifyInventory({});
  await test("default mode is plan-only", async () => assert.strictEqual(plan.mode, "PLAN_ONLY"));
  await test("plan performs no writes", async () => assert.strictEqual(fs.existsSync(service.outputRoot), false));
  await test("plan uses no verification credits", async () => assert.strictEqual(plan.verificationCreditsUsed, 0));
  await test("plan forbids guessed emails", async () => assert.strictEqual(plan.guessedEmailsAllowed, false));
  const report = service.classifyInventory({ apply: true });
  await test("apply classifies inventory", async () => assert.strictEqual(report.status, "CLASSIFIED"));
  await test("only lead CSV names are discovered", async () => assert.strictEqual(report.summary.sourceFilesDiscovered, 2));
  await test("verified file classifies good email", async () => assert.strictEqual(report.summary.verified, 1));
  await test("unknown status remains pending", async () => assert.strictEqual(report.summary.pendingVerification, 1));
  await test("bad status classifies invalid", async () => assert.strictEqual(report.summary.invalid, 1));
  await test("conflicting evidence is isolated", async () => assert.strictEqual(report.summary.verificationConflicts, 1));
  await test("invalid syntax is counted", async () => assert.strictEqual(report.summary.invalidEmailSyntax, 1));
  await test("unique email count is conserved", async () => assert.strictEqual(report.summary.uniqueEmails, 4));
  await test("conservation validation passes", async () => assert.strictEqual(report.conservation.ok, true));
  await test("contact occurrences preserve overlaps", async () => assert.strictEqual(report.summary.contactOccurrences, 5));
  await test("verified artifact is written", async () => assert.strictEqual(fs.existsSync(report.artifacts.verified.filePath), true));
  await test("pending artifact is written", async () => assert.strictEqual(fs.existsSync(report.artifacts.pending.filePath), true));
  await test("invalid artifact is written", async () => assert.strictEqual(fs.existsSync(report.artifacts.invalid.filePath), true));
  await test("conflict artifact is written", async () => assert.strictEqual(fs.existsSync(report.artifacts.conflicts.filePath), true));
  await test("artifact counts match classification", async () => assert.strictEqual(report.artifacts.pending.records, report.summary.pendingVerification));
  await test("manifest has integrity fingerprint", async () => assert.match(report.classificationFingerprint, /^[A-F0-9]{64}$/));
  await test("manifest artifact has integrity hash", async () => assert.match(report.artifacts.manifest.sha256, /^[A-F0-9]{64}$/));
  await test("no external verification is requested", async () => assert.strictEqual(report.externalVerificationRequested, false));
  await test("no verification credits are used", async () => assert.strictEqual(report.verificationCreditsUsed, 0));
  await test("no guessed emails are created", async () => assert.strictEqual(report.guessedEmails, 0));
  await test("provider writes remain unauthorized", async () => assert.strictEqual(report.providerWritesAuthorized, false));
  await test("no leads are uploaded", async () => assert.strictEqual(report.leadsUploaded, false));
  await test("no emails are sent", async () => assert.strictEqual(report.emailsSent, false));

  console.log(`REVENUE_LEAD_INVENTORY_CLASSIFICATION_TEST_PASS ${passed}/28`);
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
