"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueAllSegmentUploadPreparationService");
const { parseArguments } = require("../SCRIPTS/PrepareRevenueAllSegmentUpload");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-upload-prep-"));
  const auditPath = path.join(root, "audit.json");
  const sourceRoot = path.join(root, "source");
  const outputRoot = path.join(root, "output");
  fs.mkdirSync(sourceRoot, { recursive: true });
  const expected = {
    "Expiring GSA 12 Months": 2807, "Expiring VA 12 Months": 28, "GSA": 0, "VA": 108, "8(a)": 38,
    "HUBZone": 78, "SDVOSB": 1674, "VOSB": 317, "WOSB": 604, "SBS": 0
  };
  const routes = Object.entries(expected).map(([route, count], routeIndex) => {
    const campaignId = "campaign-" + routeIndex;
    const filePath = path.join(sourceRoot, "delta-" + routeIndex + ".csv");
    let content = "email,route,campaign_id\n";
    for (let index = 0; index < count; index += 1) content += "route" + routeIndex + "-" + index + "@example.com," + route + "," + campaignId + "\n";
    fs.writeFileSync(filePath, content, "utf8");
    return { route, campaignId, uploadDelta: count, artifacts: { uploadDelta: { filePath, records: count, sha256: sha256(fs.readFileSync(filePath)) } } };
  });
  const audit = {
    ok: true, status: "GLOBAL_DUPLICATE_AUDIT_COMPLETED",
    auditFingerprint: "8326CCCE56DF9F1F4EEA838007BE00DCFC56C4EDBD8A81EB420FA174DF0A79CB",
    summary: { classifiedCandidates: 8576, alreadyPresentGlobally: 2922, uploadDelta: 5654, unclassifiedHeld: 2 },
    conservation: { ok: true }, routes,
    providerWritesAuthorized: false, leadsUploaded: 0, emailsSent: false, campaignsLaunched: false
  };
  fs.writeFileSync(auditPath, JSON.stringify(audit), "utf8");
  const service = new Service({ rootDir: root, auditPath, outputRoot, generatedAt: () => "2026-08-08T00:00:00.000Z" });

  await test("service is constructable", async () => assert.ok(service));
  const preview = service.prepare({});
  await test("default mode is plan-only", async () => assert.strictEqual(preview.mode, "PLAN_ONLY"));
  await test("preview performs no writes", async () => assert.strictEqual(fs.existsSync(outputRoot), false));
  await test("preview authorizes no provider reads", async () => assert.strictEqual(preview.providerReadsAuthorized, false));
  await test("preview authorizes no provider writes", async () => assert.strictEqual(preview.providerWritesAuthorized, false));
  await test("preview uploads no leads", async () => assert.strictEqual(preview.leadsUploaded, 0));

  const report = service.prepare({ apply: true });
  await test("preparation completes", async () => assert.strictEqual(report.status, "ALL_SEGMENT_UPLOAD_PREPARED"));
  await test("ten routes are prepared", async () => assert.strictEqual(report.summary.routes, 10));
  await test("exactly 5654 leads are prepared", async () => assert.strictEqual(report.summary.prepared, 5654));
  await test("all prepared emails are globally unique", async () => assert.strictEqual(report.summary.globallyUniqueEmails, 5654));
  await test("existing global count is preserved", async () => assert.strictEqual(report.summary.alreadyPresentGlobally, 2922));
  await test("two unclassified leads stay held", async () => assert.strictEqual(report.summary.unclassifiedHeld, 2));
  await test("global conservation passes", async () => assert.strictEqual(report.conservation.ok, true));
  await test("global deduplication passes", async () => assert.strictEqual(report.globalDeduplication.ok, true));
  await test("GSA has zero new uploads", async () => assert.strictEqual(report.routes.find(route => route.route === "GSA").records, 0));
  await test("SBS has zero new uploads", async () => assert.strictEqual(report.routes.find(route => route.route === "SBS").records, 0));
  await test("expiring GSA count is preserved", async () => assert.strictEqual(report.routes.find(route => route.route === "Expiring GSA 12 Months").records, 2807));
  await test("SDVOSB count is preserved", async () => assert.strictEqual(report.routes.find(route => route.route === "SDVOSB").records, 1674));
  await test("source hashes are recorded", async () => assert.match(report.routes[0].sourceSha256, /^[A-F0-9]{64}$/));
  await test("consolidated artifact exists", async () => assert.strictEqual(fs.existsSync(report.artifact.filePath), true));
  await test("consolidated artifact has 5654 records", async () => assert.strictEqual(report.artifact.records, 5654));
  await test("consolidated artifact hash is recorded", async () => assert.match(report.artifact.sha256, /^[A-F0-9]{64}$/));
  await test("manifest exists", async () => assert.strictEqual(fs.existsSync(report.manifest.filePath), true));
  await test("manifest hash is recorded", async () => assert.match(report.manifest.sha256, /^[A-F0-9]{64}$/));
  await test("preparation fingerprint is recorded", async () => assert.match(report.preparationFingerprint, /^[A-F0-9]{64}$/));
  await test("exact upload authorization is declared", async () => assert.strictEqual(report.authorizationRequired, "AUTHORIZE_INSTANTLY_UPLOAD_5654_NO_LAUNCH"));
  await test("provider writes remain unauthorized", async () => assert.strictEqual(report.providerWritesAuthorized, false));
  await test("upload remains unauthorized", async () => assert.strictEqual(report.uploadAuthorized, false));
  await test("no leads upload", async () => assert.strictEqual(report.leadsUploaded, 0));
  await test("no emails send", async () => assert.strictEqual(report.emailsSent, false));
  await test("no campaigns change", async () => assert.strictEqual(report.campaignsChanged, false));
  await test("no campaigns launch", async () => assert.strictEqual(report.campaignsLaunched, false));
  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { apply: false }));
  await test("CLI parses explicit apply", async () => assert.deepStrictEqual(parseArguments(["--apply"]), { apply: true }));

  const wrongFingerprintPath = path.join(root, "wrong-fingerprint.json");
  fs.writeFileSync(wrongFingerprintPath, JSON.stringify({ ...audit, auditFingerprint: "A".repeat(64) }), "utf8");
  await test("changed Gate 15 fingerprint fails closed", async () => assert.throws(() => new Service({ rootDir: root, auditPath: wrongFingerprintPath, outputRoot: path.join(root, "bad1") }).prepare({ apply: true }), /fingerprint changed/));

  const tamperedPath = routes[0].artifacts.uploadDelta.filePath;
  fs.appendFileSync(tamperedPath, "tampered@example.com,Expiring GSA 12 Months,campaign-0\n", "utf8");
  await test("tampered route artifact fails closed", async () => assert.throws(() => new Service({ rootDir: root, auditPath, outputRoot: path.join(root, "bad2") }).prepare({ apply: true }), /hash mismatch/));

  console.log("REVENUE_ALL_SEGMENT_UPLOAD_PREPARATION_TEST_PASS " + passed + "/36");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
