"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueAllSegmentConfigurationPlanService");
const { parseArguments } = require("../SCRIPTS/PlanAllRevenueSegments");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-all-segment-plan-"));
  const masterPath = path.join(root, "master.jsonl");
  const activationPlanPath = path.join(root, "activation.json");
  const uploadManifestPath = path.join(root, "upload.json");
  const outputRoot = path.join(root, "output");
  const leads = [];
  for (let index = 0; index < 8574; index += 1) leads.push({ email: "gsa" + index + "@example.com", primarySegment: "GSA", segments: ["GSA"] });
  leads.push({ email: "sbs@example.com", primarySegment: "SBS", segments: ["SBS"] });
  leads.push({ email: "wosb@example.com", primarySegment: "Certifications", segments: ["WOSB"] });
  leads.push({ email: "unknown1@example.com", primarySegment: "Unclassified", segments: [] });
  leads.push({ email: "unknown2@example.com", primarySegment: "Unclassified", segments: [] });
  fs.writeFileSync(masterPath, leads.map(JSON.stringify).join("\n") + "\n", "utf8");
  fs.writeFileSync(activationPlanPath, JSON.stringify({
    ok: true, status: "ACTIVATION_PLAN_PREPARED", planFingerprint: "A".repeat(64),
    summary: { verifiedLeads: 8578 },
    activationRoutes: [
      { route: "GSA", liveCampaignId: "c-gsa", assignedInboxes: ["gsa@sender.test"] },
      { route: "SBS", liveCampaignId: "c-sbs", assignedInboxes: [] },
      { route: "WOSB", liveCampaignId: null, assignedInboxes: [] },
      { route: "Unclassified", liveCampaignId: null, assignedInboxes: [] }
    ]
  }), "utf8");
  fs.writeFileSync(uploadManifestPath, JSON.stringify({
    ok: true, status: "UPLOAD_COMPLETED", uploadFingerprint: "B".repeat(64), summary: { uploaded: 522 }
  }), "utf8");

  let campaignCalls = 0, accountCalls = 0;
  const service = new Service({
    rootDir: root, masterPath, activationPlanPath, uploadManifestPath, outputRoot,
    outputPath: path.join(outputRoot, "plan.json"), unclassifiedPath: path.join(outputRoot, "unclassified.jsonl"),
    generatedAt: () => "2026-08-08T00:00:00.000Z",
    planner: { route: lead => {
      const value = lead.segments[0] || "Unclassified";
      return { name: value, rank: value === "GSA" ? 4 : value === "SBS" ? 8 : value === "WOSB" ? 7 : 99 };
    }},
    campaignProvider: async filters => {
      campaignCalls += 1;
      if (!filters.starting_after) return { items: [{ id: "c-gsa", name: "GSA No Sales" }], next_starting_after: "next" };
      return { items: [{ id: "c-sbs", name: "SBS Verified Email Targets" }] };
    },
    accountProvider: async () => {
      accountCalls += 1;
      return { items: [
        { email: "gsa@sender.test", status: 1 },
        { email: "available1@sender.test", status: 1 },
        { email: "available2@sender.test", status: "ACTIVE" },
        { email: "bad@sender.test", status: "DISABLED" }
      ] };
    }
  });

  await test("service is constructable", async () => assert.ok(service));
  const preview = await service.build({});
  await test("default mode is plan-only", async () => assert.strictEqual(preview.mode, "PLAN_ONLY"));
  await test("plan performs no provider reads", async () => assert.strictEqual(campaignCalls + accountCalls, 0));
  await test("plan performs no writes", async () => assert.strictEqual(fs.existsSync(outputRoot), false));
  await test("apply requires live flag", async () => assert.rejects(() => service.build({ apply: true }), /--live/));
  const report = await service.build({ apply: true, live: true });
  await test("configuration plan completes", async () => assert.strictEqual(report.status, "ALL_SEGMENT_CONFIGURATION_PLANNED"));
  await test("all verified leads are preserved", async () => assert.strictEqual(report.summary.verifiedLeads, 8578));
  await test("every email is unique", async () => assert.strictEqual(report.summary.uniqueEmails, 8578));
  await test("one route per lead is enforced", async () => assert.strictEqual(report.globalDeduplication.onePrimaryRoutePerLead, true));
  await test("duplicate count is zero", async () => assert.strictEqual(report.globalDeduplication.duplicateEmails, 0));
  await test("route conservation passes", async () => assert.strictEqual(report.conservation.ok, true));
  await test("campaign pagination is followed", async () => assert.strictEqual(campaignCalls, 2));
  await test("accounts are read", async () => assert.strictEqual(accountCalls, 1));
  await test("disabled account is excluded", async () => assert.strictEqual(report.summary.healthySenderAccounts, 3));
  await test("existing GSA campaign is retained", async () => assert.strictEqual(report.routes.find(item => item.route === "GSA").currentCampaignId, "c-gsa"));
  await test("existing GSA inbox is retained", async () => assert.deepStrictEqual(report.routes.find(item => item.route === "GSA").proposedInboxes, ["gsa@sender.test"]));
  await test("SBS receives available inbox proposal", async () => assert.strictEqual(report.routes.find(item => item.route === "SBS").proposedInboxes.length, 1));
  await test("missing WOSB campaign is proposed", async () => assert.ok(report.routes.find(item => item.route === "WOSB").configurationActions.includes("CREATE_PAUSED_CAMPAIGN")));
  await test("unclassified leads are isolated", async () => assert.strictEqual(report.summary.unclassifiedLeads, 2));
  await test("unclassified review artifact exists", async () => assert.strictEqual(fs.existsSync(report.artifacts.unclassifiedReview.filePath), true));
  await test("unclassified leads receive no inbox", async () => assert.strictEqual(report.routes.find(item => item.route === "Unclassified").proposedInboxes.length, 0));
  await test("every route still requires global audit", async () => assert.ok(report.routes.every(item => item.blockers.includes("GLOBAL_PROVIDER_DUPLICATE_AUDIT_REQUIRED"))));
  await test("provider writes remain unauthorized", async () => assert.strictEqual(report.providerWritesAuthorized, false));
  await test("no campaigns are created", async () => assert.strictEqual(report.campaignsCreated, 0));
  await test("no inbox assignments change", async () => assert.strictEqual(report.inboxAssignmentsChanged, 0));
  await test("no leads upload", async () => assert.strictEqual(report.leadsUploaded, 0));
  await test("no emails send", async () => assert.strictEqual(report.emailsSent, false));
  await test("no campaigns launch", async () => assert.strictEqual(report.campaignsLaunched, false));
  await test("fingerprint is recorded", async () => assert.match(report.configurationFingerprint, /^[A-F0-9]{64}$/));
  await test("plan artifact is written", async () => assert.strictEqual(fs.existsSync(report.artifacts.plan.filePath), true));
  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { apply: false, live: false }));
  await test("CLI parses live apply", async () => assert.deepStrictEqual(parseArguments(["--apply", "--live"]), { apply: true, live: true }));

  console.log("REVENUE_ALL_SEGMENT_CONFIGURATION_PLAN_TEST_PASS " + passed + "/32");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
