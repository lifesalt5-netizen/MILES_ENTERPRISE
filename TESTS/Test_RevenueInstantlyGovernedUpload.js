"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const Service = require("../SERVICES/revenue/RevenueInstantlyGovernedUploadService");
const { parseArguments } = require("../SCRIPTS/UploadAuthorizedInstantlyLeads");

const hash = value => crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-governed-upload-"));
  const auditRoot = path.join(root, "audit");
  const outputRoot = path.join(root, "output");
  fs.mkdirSync(auditRoot, { recursive: true });
  const makeDelta = (name, route, campaign, count) => {
    const filePath = path.join(auditRoot, name);
    const records = Array.from({ length: count }, (_, index) => route.toLowerCase() + index + "@example.com," + route + "," + campaign);
    fs.writeFileSync(filePath, "email,route,campaign_id\n" + records.join("\n") + "\n", "utf8");
    return { filePath, records: count, bytes: fs.statSync(filePath).size, sha256: hash(fs.readFileSync(filePath)) };
  };
  const gsa = makeDelta("gsa.csv", "GSA", "c-gsa", 428);
  const sbs = makeDelta("sbs.csv", "SBS", "c-sbs", 45);
  const audit = {
    ok: true, status: "DUPLICATE_AUDIT_COMPLETED", auditFingerprint: "A".repeat(64),
    summary: { candidates: 908, alreadyPresent: 435, uploadDelta: 473 },
    conservation: { ok: true }, providerWritesAuthorized: false, leadsUploaded: false, campaignsLaunched: false,
    routes: [
      { route: "GSA", uploadDelta: 428, artifacts: { uploadDelta: gsa } },
      { route: "SBS", uploadDelta: 45, artifacts: { uploadDelta: sbs } }
    ]
  };
  const auditManifestPath = path.join(auditRoot, "manifest.json");
  fs.writeFileSync(auditManifestPath, JSON.stringify(audit), "utf8");
  const uploads = [];
  const service = new Service({
    rootDir: root, auditRoot, auditManifestPath, outputRoot,
    generatedAt: () => "2026-08-08T00:00:00.000Z",
    uploadProvider: async payload => { uploads.push(payload); return { id: "lead-" + uploads.length }; }
  });
  const auth = "AUTHORIZE_INSTANTLY_UPLOAD_473_NO_LAUNCH";

  await test("service is constructable", async () => assert.ok(service));
  const preview = await service.upload({});
  await test("default mode is plan-only", async () => assert.strictEqual(preview.mode, "PLAN_ONLY"));
  await test("plan performs no uploads", async () => assert.strictEqual(uploads.length, 0));
  await test("plan authorizes no provider writes", async () => assert.strictEqual(preview.providerWritesAuthorized, false));
  await test("apply requires live flag", async () => assert.rejects(() => service.upload({ apply: true, authorization: auth, maximumUploads: 473 }), /--live/));
  await test("wrong authorization fails closed", async () => assert.rejects(() => service.upload({ apply: true, live: true, authorization: "WRONG", maximumUploads: 473 }), /Exact CEO/));
  await test("wrong upload cap fails closed", async () => assert.rejects(() => service.upload({ apply: true, live: true, authorization: auth, maximumUploads: 474 }), /exactly 473/));

  const report = await service.upload({ apply: true, live: true, authorization: auth, maximumUploads: 473 });
  await test("authorized upload completes", async () => assert.strictEqual(report.status, "UPLOAD_COMPLETED"));
  await test("exactly 473 leads upload", async () => assert.strictEqual(report.summary.uploaded, 473));
  await test("GSA count is preserved", async () => assert.strictEqual(report.summary.byRoute.GSA, 428));
  await test("SBS count is preserved", async () => assert.strictEqual(report.summary.byRoute.SBS, 45));
  await test("provider receives exact uploads", async () => assert.strictEqual(uploads.length, 473));
  await test("campaign IDs are included", async () => assert.strictEqual(uploads[0].campaign, "c-gsa"));
  await test("emails are included", async () => assert.match(uploads[0].email, /@example\.com$/));
  await test("conservation passes", async () => assert.strictEqual(report.conservation.ok, true));
  await test("write scope is leads only", async () => assert.strictEqual(report.providerWriteScope, "CREATE_LEADS_ONLY"));
  await test("emails are not sent", async () => assert.strictEqual(report.emailsSent, false));
  await test("campaigns are unchanged", async () => assert.strictEqual(report.campaignsChanged, false));
  await test("campaigns are not launched", async () => assert.strictEqual(report.campaignsLaunched, false));
  await test("progress evidence exists", async () => assert.strictEqual(fs.existsSync(service.progressPath), true));
  await test("manifest exists", async () => assert.strictEqual(fs.existsSync(report.artifact.filePath), true));
  await test("manifest hash is recorded", async () => assert.match(report.artifact.sha256, /^[A-F0-9]{64}$/));
  await test("upload fingerprint is recorded", async () => assert.match(report.uploadFingerprint, /^[A-F0-9]{64}$/));

  const second = await service.upload({ apply: true, live: true, authorization: auth, maximumUploads: 473 });
  await test("rerun is idempotent", async () => assert.strictEqual(second.summary.uploadedThisRun, 0));
  await test("rerun creates no duplicate provider calls", async () => assert.strictEqual(uploads.length, 473));
  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { apply: false, live: false, authorization: null, maximumUploads: 0 }));
  await test("CLI parses exact authorization", async () => assert.deepStrictEqual(
    parseArguments(["--apply", "--live", "--authorization=" + auth, "--maximum-uploads=473"]),
    { apply: true, live: true, authorization: auth, maximumUploads: 473 }
  ));

  const dryService = new Service({
    rootDir: root, auditRoot, auditManifestPath,
    outputRoot: path.join(root, "dry-output"),
    uploadProvider: async () => ({ dryRun: true, mutationExecuted: false })
  });
  await test("dry-run provider response fails closed", async () => assert.rejects(() => dryService.upload({ apply: true, live: true, authorization: auth, maximumUploads: 473 }), /did not confirm/));

  const tampered = fs.readFileSync(gsa.filePath, "utf8") + "tamper@example.com,GSA,c-gsa\n";
  fs.writeFileSync(gsa.filePath, tampered, "utf8");
  const tamperedService = new Service({
    rootDir: root, auditRoot, auditManifestPath,
    outputRoot: path.join(root, "tampered-output"),
    uploadProvider: async () => ({ id: "never" })
  });
  await test("tampered upload delta fails closed", async () => assert.rejects(() => tamperedService.upload({ apply: true, live: true, authorization: auth, maximumUploads: 473 }), /integrity/));

  console.log("REVENUE_INSTANTLY_GOVERNED_UPLOAD_TEST_PASS " + passed + "/29");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
