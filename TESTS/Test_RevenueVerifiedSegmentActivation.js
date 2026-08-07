"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueVerifiedSegmentActivationService");
const { parseArguments } = require("../SCRIPTS/BuildVerifiedSegmentActivation");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-segment-activation-"));
  const classificationRoot = path.join(root, "classification");
  const resultsRoot = path.join(root, "results");
  fs.mkdirSync(classificationRoot); fs.mkdirSync(resultsRoot);
  const existing = [
    { email: "existing@example.com", segments: ["SBS"] },
    { email: "overlap@example.com", segments: ["SAM_LOW_SALES"] }
  ];
  const fresh = [
    { email: "new@example.com", segments: "GSA_NO_SALES | SBS", quality: "good", result: "ok" },
    { email: "expired@example.com", segments: ["EXPIRED_EVERYTHING", "SBS"], quality: "good", result: "ok" },
    { email: "overlap@example.com", segments: ["EXPIRING_12_MONTHS"], quality: "good", result: "ok" }
  ];
  fs.writeFileSync(path.join(classificationRoot, "verified_inventory.jsonl"), existing.map(JSON.stringify).join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(classificationRoot, "manifest.json"), JSON.stringify({ ok: true, status: "CLASSIFIED", classificationFingerprint: "A".repeat(64), summary: { verified: 2 }, conservation: { ok: true } }), "utf8");
  fs.writeFileSync(path.join(resultsRoot, "verified_send_ready.jsonl"), fresh.map(JSON.stringify).join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(resultsRoot, "manifest.json"), JSON.stringify({ ok: true, status: "RECONCILED", reconciliationFingerprint: "B".repeat(64), summary: { sendReady: 3 }, conservation: { ok: true }, exactBatchMatch: { ok: true } }), "utf8");
  const service = new Service({ rootDir: root, classificationRoot, resultsRoot, outputRoot: path.join(root, "output"), generatedAt: () => "2026-08-07T00:00:00.000Z" });

  await test("service is constructable", async () => assert.ok(service));
  const plan = service.build({});
  await test("default mode is plan-only", async () => assert.strictEqual(plan.mode, "PLAN_ONLY"));
  await test("plan performs no writes", async () => assert.strictEqual(fs.existsSync(service.outputRoot), false));
  await test("plan authorizes no provider writes", async () => assert.strictEqual(plan.providerWritesAuthorized, false));
  const report = service.build({ apply: true });
  await test("activation inventories are prepared", async () => assert.strictEqual(report.status, "ACTIVATION_INVENTORIES_PREPARED"));
  await test("existing count is preserved", async () => assert.strictEqual(report.summary.existingVerified, 2));
  await test("new verified count is preserved", async () => assert.strictEqual(report.summary.newlyVerified, 3));
  await test("cross-source overlap is deduplicated", async () => assert.strictEqual(report.summary.duplicateOverlap, 1));
  await test("unique count is correct", async () => assert.strictEqual(report.summary.uniqueVerifiedLeads, 4));
  await test("conservation passes", async () => assert.strictEqual(report.conservation.ok, true));
  await test("one primary segment is assigned", async () => assert.strictEqual(report.onePrimarySegmentPerLead, true));
  await test("expired segment wins priority", async () => assert.strictEqual(report.summary.segmentCounts["Expired Everything"], 1));
  await test("pipe-delimited underscore GSA segment maps correctly", async () => assert.strictEqual(report.summary.segmentCounts.GSA, 1));\n  await test("no verified lead loses segment provenance", async () => assert.strictEqual(report.summary.segmentCounts.Unclassified || 0, 0));
  await test("overlap combines segments and uses higher priority", async () => assert.strictEqual(report.summary.segmentCounts["Expiring 12 Months"], 1));
  await test("SBS remains represented", async () => assert.strictEqual(report.summary.segmentCounts.SBS, 1));
  await test("master artifact exists", async () => assert.strictEqual(fs.existsSync(report.artifacts.master.filePath), true));
  await test("segment artifacts are created", async () => assert.strictEqual(Object.keys(report.artifacts.segments).length, 4));
  await test("segment artifact hashes are recorded", async () => assert.ok(Object.values(report.artifacts.segments).every(item => /^[A-F0-9]{64}$/.test(item.sha256))));
  await test("activation fingerprint is recorded", async () => assert.match(report.activationFingerprint, /^[A-F0-9]{64}$/));
  await test("no provider writes occur", async () => assert.strictEqual(report.providerWritesAuthorized, false));
  await test("no leads are uploaded", async () => assert.strictEqual(report.leadsUploaded, false));
  await test("no emails are sent", async () => assert.strictEqual(report.emailsSent, false));
  await test("no campaigns change", async () => assert.strictEqual(report.campaignsChanged, false));
  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { apply: false }));
  await test("CLI requires explicit apply", async () => assert.deepStrictEqual(parseArguments(["--apply"]), { apply: true }));

  console.log("REVENUE_VERIFIED_SEGMENT_ACTIVATION_TEST_PASS " + passed + "/26");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
