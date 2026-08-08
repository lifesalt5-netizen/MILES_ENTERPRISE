"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueAllSegmentGovernedUploadService");
const { parseArguments } = require("../SCRIPTS/UploadAuthorizedAllSegmentInstantlyLeads");

const hash = value => crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
const auth = "AUTHORIZE_INSTANTLY_UPLOAD_5654_NO_LAUNCH";
let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-all-upload-"));
  const preparationRoot = path.join(root, "preparation");
  const outputRoot = path.join(root, "output");
  fs.mkdirSync(preparationRoot, { recursive: true });
  const expected = {
    "Expiring GSA 12 Months": 2807, "Expiring VA 12 Months": 28, "GSA": 0, "VA": 108, "8(a)": 38,
    "HUBZone": 78, "SDVOSB": 1674, "VOSB": 317, "WOSB": 604, "SBS": 0
  };
  const uploadPath = path.join(preparationRoot, "all_segment_upload.csv");
  let content = "email,route,campaign_id\n";
  let routeIndex = 0;
  for (const [route, count] of Object.entries(expected)) {
    for (let index = 0; index < count; index += 1) content += "route" + routeIndex + "-" + index + "@example.com," + route + ",campaign-" + routeIndex + "\n";
    routeIndex += 1;
  }
  fs.writeFileSync(uploadPath, content, "utf8");
  const artifactSha = hash(fs.readFileSync(uploadPath));
  const fingerprint = "A".repeat(64);
  const manifest = {
    ok: true, status: "ALL_SEGMENT_UPLOAD_PREPARED", preparationFingerprint: fingerprint,
    authorizationRequired: auth,
    summary: { prepared: 5654, globallyUniqueEmails: 5654 },
    conservation: { ok: true }, globalDeduplication: { ok: true },
    providerWritesAuthorized: false, uploadAuthorized: false, leadsUploaded: 0, emailsSent: false, campaignsLaunched: false,
    artifact: { filePath: uploadPath, records: 5654, sha256: artifactSha }
  };
  const preparationManifestPath = path.join(preparationRoot, "manifest.json");
  fs.writeFileSync(preparationManifestPath, JSON.stringify(manifest), "utf8");
  const uploads = [];
  const service = new Service({
    rootDir: root, preparationRoot, preparationManifestPath, outputRoot,
    expectedPreparationFingerprint: fingerprint, expectedArtifactSha256: artifactSha,
    generatedAt: () => "2026-08-08T00:00:00.000Z",
    uploadProvider: async payload => { uploads.push(payload); return { id: "lead-" + uploads.length }; }
  });

  await test("service is constructable", async () => assert.ok(service));
  const preview = await service.upload({});
  await test("default mode is plan-only", async () => assert.strictEqual(preview.mode, "PLAN_ONLY"));
  await test("plan performs no uploads", async () => assert.strictEqual(uploads.length, 0));
  await test("plan authorizes no provider writes", async () => assert.strictEqual(preview.providerWritesAuthorized, false));
  await test("plan sets exact maximum", async () => assert.strictEqual(preview.maximumUploads, 5654));
  await test("apply requires live flag", async () => assert.rejects(() => service.upload({ apply: true, authorization: auth, maximumUploads: 5654 }), /--live/));
  await test("wrong authorization fails closed", async () => assert.rejects(() => service.upload({ apply: true, live: true, authorization: "WRONG", maximumUploads: 5654 }), /Exact CEO/));
  await test("wrong upload cap fails closed", async () => assert.rejects(() => service.upload({ apply: true, live: true, authorization: auth, maximumUploads: 5653 }), /exactly 5654/));

  const report = await service.upload({ apply: true, live: true, authorization: auth, maximumUploads: 5654 });
  await test("authorized upload completes", async () => assert.strictEqual(report.status, "UPLOAD_COMPLETED"));
  await test("exactly 5654 leads upload", async () => assert.strictEqual(report.summary.uploaded, 5654));
  await test("this run uploads 5654 leads", async () => assert.strictEqual(report.summary.uploadedThisRun, 5654));
  await test("provider receives exact uploads", async () => assert.strictEqual(uploads.length, 5654));
  await test("route counts are preserved", async () => assert.deepStrictEqual(report.summary.byRoute, expected));
  await test("campaign IDs are included", async () => assert.strictEqual(uploads[0].campaign, "campaign-0"));
  await test("emails are included", async () => assert.match(uploads[0].email, /@example\.com$/));
  await test("conservation passes", async () => assert.strictEqual(report.conservation.ok, true));
  await test("write scope is leads only", async () => assert.strictEqual(report.providerWriteScope, "CREATE_LEADS_ONLY"));
  await test("emails are not sent", async () => assert.strictEqual(report.emailsSent, false));
  await test("campaigns are unchanged", async () => assert.strictEqual(report.campaignsChanged, false));
  await test("campaigns are not launched", async () => assert.strictEqual(report.campaignsLaunched, false));
  await test("append-only progress evidence exists", async () => assert.strictEqual(fs.existsSync(service.progressPath), true));
  await test("progress contains one record per lead", async () => assert.strictEqual(fs.readFileSync(service.progressPath, "utf8").split(/\r?\n/).filter(Boolean).length, 5654));
  await test("manifest exists", async () => assert.strictEqual(fs.existsSync(report.artifact.filePath), true));
  await test("manifest hash is recorded", async () => assert.match(report.artifact.sha256, /^[A-F0-9]{64}$/));
  await test("upload fingerprint is recorded", async () => assert.match(report.uploadFingerprint, /^[A-F0-9]{64}$/));

  const second = await service.upload({ apply: true, live: true, authorization: auth, maximumUploads: 5654 });
  await test("rerun is idempotent", async () => assert.strictEqual(second.summary.uploadedThisRun, 0));
  await test("rerun creates no duplicate provider calls", async () => assert.strictEqual(uploads.length, 5654));
  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { apply: false, live: false, authorization: null, maximumUploads: 0 }));
  await test("CLI parses exact authorization", async () => assert.deepStrictEqual(
    parseArguments(["--apply", "--live", "--authorization=" + auth, "--maximum-uploads=5654"]),
    { apply: true, live: true, authorization: auth, maximumUploads: 5654 }
  ));

  const dryService = new Service({
    rootDir: root, preparationRoot, preparationManifestPath, outputRoot: path.join(root, "dry"),
    expectedPreparationFingerprint: fingerprint, expectedArtifactSha256: artifactSha,
    uploadProvider: async () => ({ dryRun: true, mutationExecuted: false })
  });
  await test("dry-run provider response fails closed", async () => assert.rejects(() => dryService.upload({ apply: true, live: true, authorization: auth, maximumUploads: 5654 }), /did not confirm/));

  const wrongFingerprintPath = path.join(preparationRoot, "wrong.json");
  fs.writeFileSync(wrongFingerprintPath, JSON.stringify({ ...manifest, preparationFingerprint: "B".repeat(64) }), "utf8");
  const wrongService = new Service({
    rootDir: root, preparationManifestPath: wrongFingerprintPath, outputRoot: path.join(root, "wrong"),
    expectedPreparationFingerprint: fingerprint, expectedArtifactSha256: artifactSha,
    uploadProvider: async () => ({ id: "never" })
  });
  await test("changed preparation fingerprint fails closed", async () => assert.rejects(() => wrongService.upload({ apply: true, live: true, authorization: auth, maximumUploads: 5654 }), /fingerprint changed/));

  fs.appendFileSync(uploadPath, "tampered@example.com,VA,campaign-3\n", "utf8");
  const tamperedService = new Service({
    rootDir: root, preparationRoot, preparationManifestPath, outputRoot: path.join(root, "tampered"),
    expectedPreparationFingerprint: fingerprint, expectedArtifactSha256: artifactSha,
    uploadProvider: async () => ({ id: "never" })
  });
  await test("tampered upload artifact fails closed", async () => assert.rejects(() => tamperedService.upload({ apply: true, live: true, authorization: auth, maximumUploads: 5654 }), /integrity/));

  console.log("REVENUE_ALL_SEGMENT_GOVERNED_UPLOAD_TEST_PASS " + passed + "/32");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
