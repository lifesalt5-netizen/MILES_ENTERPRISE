"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueInstantlyDuplicateAuditService");
const { parseArguments } = require("../SCRIPTS/AuditInstantlyRevenueDuplicates");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-instantly-audit-"));
  const planPath = path.join(root, "plan.json");
  const masterPath = path.join(root, "master.jsonl");
  const outputRoot = path.join(root, "output");
  const plan = {
    ok: true,
    status: "ACTIVATION_PLAN_PREPARED",
    planFingerprint: "A".repeat(64),
    summary: { verifiedLeads: 5 },
    activationRoutes: [
      { route: "GSA", liveCampaignId: "campaign-gsa", campaignName: "GSA", blockers: ["PROVIDER_DUPLICATE_SUPPRESSION_CHECK_REQUIRED"] },
      { route: "SBS", liveCampaignId: "campaign-sbs", campaignName: "SBS", blockers: ["PROVIDER_DUPLICATE_SUPPRESSION_CHECK_REQUIRED"] },
      { route: "VA", liveCampaignId: null, campaignName: null, blockers: ["LIVE_CAMPAIGN_NOT_MAPPED"] }
    ]
  };
  const leads = [
    { email: "existing-gsa@example.com", primarySegment: "GSA" },
    { email: "new-gsa@example.com", primarySegment: "GSA" },
    { email: "existing-sbs@example.com", primarySegment: "SBS" },
    { email: "new-sbs@example.com", primarySegment: "SBS" },
    { email: "va@example.com", primarySegment: "VA" }
  ];
  fs.writeFileSync(planPath, JSON.stringify(plan), "utf8");
  fs.writeFileSync(masterPath, leads.map(JSON.stringify).join("\n") + "\n", "utf8");

  const calls = [];
  const pages = {
    "campaign-gsa": [
      { items: [{ email: "existing-gsa@example.com" }], next_starting_after: "gsa-next" },
      { items: [{ email: "other@example.com" }] }
    ],
    "campaign-sbs": [
      { leads: [{ email_address: "EXISTING-SBS@EXAMPLE.COM" }] }
    ]
  };
  const offsets = {};
  const service = new Service({
    rootDir: root,
    activationPlanPath: planPath,
    verifiedMasterPath: masterPath,
    outputRoot,
    generatedAt: () => "2026-08-07T00:00:00.000Z",
    planner: { route: lead => ({ name: lead.primarySegment }) },
    leadProvider: async filters => {
      calls.push(filters);
      const index = offsets[filters.campaign_id] || 0;
      offsets[filters.campaign_id] = index + 1;
      return pages[filters.campaign_id][index];
    }
  });

  await test("service is constructable", async () => assert.ok(service));
  const preview = await service.audit({});
  await test("default mode is plan-only", async () => assert.strictEqual(preview.mode, "PLAN_ONLY"));
  await test("plan performs no writes", async () => assert.strictEqual(fs.existsSync(outputRoot), false));
  await test("plan performs no provider reads", async () => assert.strictEqual(calls.length, 0));
  await test("plan authorizes no provider writes", async () => assert.strictEqual(preview.providerWritesAuthorized, false));
  await test("apply requires explicit live read", async () => assert.rejects(() => service.audit({ apply: true }), /--live/));

  const report = await service.audit({ apply: true, live: true });
  await test("audit completes", async () => assert.strictEqual(report.status, "DUPLICATE_AUDIT_COMPLETED"));
  await test("only eligible routes are audited", async () => assert.strictEqual(report.summary.eligibleRoutes, 2));
  await test("candidate count is conserved", async () => assert.strictEqual(report.summary.candidates, 4));
  await test("existing leads are detected", async () => assert.strictEqual(report.summary.alreadyPresent, 2));
  await test("upload delta is calculated", async () => assert.strictEqual(report.summary.uploadDelta, 2));
  await test("provider pages are counted", async () => assert.strictEqual(report.summary.providerLeadsRead, 3));
  await test("pagination cursor is used", async () => assert.strictEqual(calls[1].starting_after, "gsa-next"));
  await test("campaign scoping is used", async () => assert.strictEqual(calls[0].campaign_id, "campaign-gsa"));
  await test("email matching is case insensitive", async () => assert.strictEqual(report.routes.find(route => route.route === "SBS").alreadyPresent, 1));
  await test("GSA delta artifact exists", async () => assert.strictEqual(fs.existsSync(report.routes.find(route => route.route === "GSA").artifacts.uploadDelta.filePath), true));
  await test("SBS duplicate artifact exists", async () => assert.strictEqual(fs.existsSync(report.routes.find(route => route.route === "SBS").artifacts.existing.filePath), true));
  await test("artifact hashes are recorded", async () => assert.match(report.routes[0].artifacts.uploadDelta.sha256, /^[A-F0-9]{64}$/));
  await test("manifest exists", async () => assert.strictEqual(fs.existsSync(report.artifact.filePath), true));
  await test("manifest hash is recorded", async () => assert.match(report.artifact.sha256, /^[A-F0-9]{64}$/));
  await test("audit fingerprint is recorded", async () => assert.match(report.auditFingerprint, /^[A-F0-9]{64}$/));
  await test("conservation passes", async () => assert.strictEqual(report.conservation.ok, true));
  await test("provider reads are explicit", async () => assert.strictEqual(report.providerReadsPerformed, true));
  await test("no provider writes occur", async () => assert.strictEqual(report.providerWritesAuthorized, false));
  await test("no leads are uploaded", async () => assert.strictEqual(report.leadsUploaded, false));
  await test("no emails are sent", async () => assert.strictEqual(report.emailsSent, false));
  await test("no campaigns change", async () => assert.strictEqual(report.campaignsChanged, false));
  await test("no campaigns launch", async () => assert.strictEqual(report.campaignsLaunched, false));
  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { apply: false, live: false }));
  await test("CLI requires explicit live apply flags", async () => assert.deepStrictEqual(parseArguments(["--apply", "--live"]), { apply: true, live: true }));

  const badService = new Service({
    rootDir: root, activationPlanPath: planPath, verifiedMasterPath: masterPath,
    outputRoot: path.join(root, "bad-output"),
    planner: { route: lead => ({ name: lead.primarySegment }) },
    leadProvider: async () => ({ unexpected: [] })
  });
  await test("malformed provider response fails closed", async () => assert.rejects(() => badService.audit({ apply: true, live: true }), /does not contain an array/));

  console.log("REVENUE_INSTANTLY_DUPLICATE_AUDIT_TEST_PASS " + passed + "/31");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
