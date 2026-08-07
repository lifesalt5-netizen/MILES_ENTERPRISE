"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueInstantlyActivationPlanService");
const { parseArguments } = require("../SCRIPTS/PlanInstantlyRevenueActivation");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-instantly-plan-"));
  const activationRoot = path.join(root, "activation");
  const resultsRoot = path.join(root, "results");
  const runtimeRoot = path.join(root, "runtime", "instantly_coo");
  fs.mkdirSync(activationRoot, { recursive: true }); fs.mkdirSync(resultsRoot); fs.mkdirSync(runtimeRoot, { recursive: true });
  const leads = [
    { email: "gsa@example.com", primarySegment: "GSA", segments: ["GSA_NO_SALES"] },
    { email: "wosb@example.com", primarySegment: "Certifications", segments: ["SETASIDE_WOSB"] },
    { email: "unknown@example.com", primarySegment: "Unclassified", segments: [] }
  ];
  fs.writeFileSync(path.join(activationRoot, "verified_segment_master.jsonl"), leads.map(JSON.stringify).join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(activationRoot, "manifest.json"), JSON.stringify({
    ok: true, status: "ACTIVATION_INVENTORIES_PREPARED", activationFingerprint: "A".repeat(64),
    summary: { uniqueVerifiedLeads: 3 }, conservation: { ok: true },
    artifacts: { segments: { GSA: { filePath: "gsa.csv" }, Certifications: { filePath: "cert.csv" } } }
  }), "utf8");
  fs.writeFileSync(path.join(resultsRoot, "risky_blocked.jsonl"), JSON.stringify({ email: "risk@example.com" }) + "\n", "utf8");
  fs.writeFileSync(path.join(resultsRoot, "invalid_do_not_mail.jsonl"), JSON.stringify({ email: "bad@example.com" }) + "\n", "utf8");
  fs.writeFileSync(path.join(runtimeRoot, "segment_inventory.json"), JSON.stringify([
    { segmentId: "gsa", segmentName: "GSA", liveCampaignId: "c1", assignedInboxes: ["gsa@sender.test"], blockers: [] },
    { segmentId: "wosb", segmentName: "WOSB", liveCampaignId: "c2", assignedInboxes: ["cert@sender.test"], blockers: [] }
  ]), "utf8");
  fs.writeFileSync(path.join(runtimeRoot, "campaign_registry.json"), JSON.stringify([
    { campaignId: "c1", name: "GSA", status: "PAUSED" },
    { campaignId: "c2", name: "WOSB", status: "PAUSED" }
  ]), "utf8");
  const service = new Service({
    rootDir: root, activationRoot, resultsRoot,
    segmentInventoryPath: path.join(runtimeRoot, "segment_inventory.json"),
    campaignRegistryPath: path.join(runtimeRoot, "campaign_registry.json"),
    outputPath: path.join(root, "output", "plan.json"),
    generatedAt: () => "2026-08-07T00:00:00.000Z"
  });

  await test("service is constructable", async () => assert.ok(service));
  const plan = service.build({});
  await test("default mode is plan-only", async () => assert.strictEqual(plan.mode, "PLAN_ONLY"));
  await test("plan performs no writes", async () => assert.strictEqual(fs.existsSync(service.outputPath), false));
  await test("plan authorizes no provider writes", async () => assert.strictEqual(plan.providerWritesAuthorized, false));
  const report = service.build({ apply: true });
  await test("activation plan is prepared", async () => assert.strictEqual(report.status, "ACTIVATION_PLAN_PREPARED"));
  await test("verified lead count is preserved", async () => assert.strictEqual(report.summary.verifiedLeads, 3));
  await test("GSA route matches campaign", async () => assert.strictEqual(report.activationRoutes.find(item => item.route === "GSA").liveCampaignId, "c1"));
  await test("WOSB route matches campaign", async () => assert.strictEqual(report.activationRoutes.find(item => item.route === "WOSB").liveCampaignId, "c2"));
  await test("configured routes await duplicate check only", async () => assert.strictEqual(report.summary.routesReadyAfterProviderDuplicateCheck, 2));
  await test("unclassified route is blocked", async () => assert.ok(report.activationRoutes.find(item => item.route === "Unclassified").blockers.includes("UNCLASSIFIED_LEADS")));
  await test("risky suppression is counted", async () => assert.strictEqual(report.suppression.riskyBlocked, 1));
  await test("invalid suppression is counted", async () => assert.strictEqual(report.suppression.doNotMail, 1));
  await test("verified suppression conflicts are zero", async () => assert.strictEqual(report.suppression.verifiedSuppressionConflicts, 0));
  await test("duplicate verified emails are zero", async () => assert.strictEqual(report.summary.duplicateEmails, 0));
  await test("fingerprint is recorded", async () => assert.match(report.planFingerprint, /^[A-F0-9]{64}$/));
  await test("artifact is written", async () => assert.strictEqual(fs.existsSync(report.artifact.filePath), true));
  await test("artifact hash is recorded", async () => assert.match(report.artifact.sha256, /^[A-F0-9]{64}$/));
  await test("no provider writes occur", async () => assert.strictEqual(report.providerWritesAuthorized, false));
  await test("no leads are uploaded", async () => assert.strictEqual(report.leadsUploaded, false));
  await test("no emails are sent", async () => assert.strictEqual(report.emailsSent, false));
  await test("no campaigns change", async () => assert.strictEqual(report.campaignsChanged, false));
  await test("no campaigns launch", async () => assert.strictEqual(report.campaignsLaunched, false));
  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { apply: false }));
  await test("CLI requires explicit apply", async () => assert.deepStrictEqual(parseArguments(["--apply"]), { apply: true }));

  const conflicting = [...leads, { email: "bad@example.com", primarySegment: "GSA", segments: ["GSA"] }];
  fs.writeFileSync(path.join(activationRoot, "verified_segment_master.jsonl"), conflicting.map(JSON.stringify).join("\n") + "\n", "utf8");
  const changedManifest = JSON.parse(fs.readFileSync(path.join(activationRoot, "manifest.json"), "utf8"));
  changedManifest.summary.uniqueVerifiedLeads = 4;
  fs.writeFileSync(path.join(activationRoot, "manifest.json"), JSON.stringify(changedManifest), "utf8");
  await test("suppressed verified lead fails closed", async () => assert.throws(() => service.build({ apply: true }), /suppressed/));

  console.log("REVENUE_INSTANTLY_ACTIVATION_PLAN_TEST_PASS " + passed + "/25");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
