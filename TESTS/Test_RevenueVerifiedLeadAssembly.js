"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueVerifiedLeadAssemblyService");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log(`[PASS] ${name}`); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-verified-assembly-"));
  const verifiedFile = path.join(root, "SBS_OK_ONLY_MILLIONVERIFIER.csv");
  const statusFile = path.join(root, "VA_EMAIL_READY.csv");
  const unverifiedFile = path.join(root, "SAM.csv");
  fs.writeFileSync(verifiedFile, "Email,Company\nONE@EXAMPLE.COM,One\ntwo@example.com,Two\nnot-an-email,Bad\n", "utf8");
  fs.writeFileSync(statusFile, "Contact Email,Verification Status,Company\none@example.com,verified,Duplicate\nthree@example.com,invalid,Three\nfour@example.com,deliverable,Four\n", "utf8");
  fs.writeFileSync(unverifiedFile, "Email,Company\nguess@example.com,Guess\n", "utf8");
  const readiness = {
    ok: true,
    status: "RECONCILED",
    reconciliationFingerprint: "B".repeat(64),
    segments: [{ segmentName: "SBS", priority: 8, sourceEvidence: [{ filePath: verifiedFile, verifiedEmailCount: 2, verificationEvidence: "VERIFIED_FILENAME" }] },
      { segmentName: "VA Revenue", priority: 5, sourceEvidence: [{ filePath: statusFile, verifiedEmailCount: 2, verificationEvidence: "EXPLICIT_STATUS_COLUMN" }] },
      { segmentName: "SAM", priority: 6, sourceEvidence: [{ filePath: unverifiedFile, verifiedEmailCount: 0, verificationEvidence: "NONE" }] }]
  };
  const service = new Service({ rootDir: root, outputRoot: path.join(root, "output"), inputProvider: () => readiness, generatedAt: () => "2026-08-07T00:00:00.000Z" });

  await test("service is constructable", async () => assert.ok(service));
  const plan = service.assemble({});
  await test("default mode is plan-only", async () => assert.strictEqual(plan.mode, "PLAN_ONLY"));
  await test("plan writes nothing", async () => assert.strictEqual(fs.existsSync(service.outputRoot), false));
  await test("plan prohibits guessed emails", async () => assert.strictEqual(plan.guessedEmailsAllowed, false));
  const report = service.assemble({ apply: true });
  await test("apply assembles verified master", async () => assert.strictEqual(report.status, "ASSEMBLED"));
  await test("verified filename admits valid emails", async () => assert.strictEqual(report.summary.contactsRead, 4));
  await test("invalid email syntax is rejected", async () => assert.strictEqual(report.summary.contactsRead < 5, true));
  await test("invalid verification status is rejected", async () => assert.strictEqual(report.summary.uniqueVerifiedLeads, 3));
  await test("unverified file contributes no leads", async () => assert.strictEqual(report.summary.segmentCounts.SAM, undefined));
  await test("emails normalize to lowercase", async () => {
    const first = JSON.parse(fs.readFileSync(report.artifacts.leads.filePath, "utf8").split(/\r?\n/).filter(Boolean)[0]);
    assert.strictEqual(first.email, first.email.toLowerCase());
  });
  await test("duplicates are removed", async () => assert.strictEqual(report.summary.duplicateRecords, 1));
  await test("higher-priority segment wins duplicate", async () => {
    const leads = fs.readFileSync(report.artifacts.leads.filePath, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assert.strictEqual(leads.find(item => item.email === "one@example.com").primarySegment, "VA Revenue");
  });
  await test("all duplicate segments are preserved", async () => {
    const leads = fs.readFileSync(report.artifacts.leads.filePath, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assert.deepStrictEqual(leads.find(item => item.email === "one@example.com").segments.sort(), ["SBS", "VA Revenue"]);
  });
  await test("source provenance is preserved", async () => {
    const leads = fs.readFileSync(report.artifacts.leads.filePath, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assert.ok(leads.every(item => item.sources.length > 0));
  });
  await test("deduped lead artifact is written", async () => assert.strictEqual(fs.existsSync(report.artifacts.leads.filePath), true));
  await test("duplicate index is written", async () => assert.strictEqual(fs.existsSync(report.artifacts.duplicates.filePath), true));
  await test("manifest is written", async () => assert.strictEqual(fs.existsSync(report.artifacts.manifest.filePath), true));
  await test("lead artifact has integrity hash", async () => assert.match(report.artifacts.leads.sha256, /^[A-F0-9]{64}$/));
  await test("assembly has deterministic fingerprint", async () => assert.match(report.assemblyFingerprint, /^[A-F0-9]{64}$/));
  await test("guessed email count remains zero", async () => assert.strictEqual(report.guessedEmails, 0));
  await test("provider writes remain unauthorized", async () => assert.strictEqual(report.providerWritesAuthorized, false));
  await test("no emails are sent", async () => assert.strictEqual(report.emailsSent, false));
  await test("no leads are uploaded", async () => assert.strictEqual(report.leadsUploaded, false));
  await test("no campaigns are changed", async () => assert.strictEqual(report.campaignsChanged, false));
  await test("input fingerprint is preserved", async () => assert.strictEqual(report.inputFingerprint, readiness.reconciliationFingerprint));

  console.log(`REVENUE_VERIFIED_LEAD_ASSEMBLY_TEST_PASS ${passed}/25`);
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
