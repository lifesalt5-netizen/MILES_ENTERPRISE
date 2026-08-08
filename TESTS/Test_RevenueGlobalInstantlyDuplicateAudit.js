"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueGlobalInstantlyDuplicateAuditService");
const { parseArguments } = require("../SCRIPTS/AuditGlobalInstantlyRevenueDuplicates");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-global-audit-"));
  const masterPath = path.join(root, "master.jsonl");
  const planPath = path.join(root, "plan.json");
  const applyPath = path.join(root, "apply.json");
  const outputRoot = path.join(root, "output");
  const names = ["Expiring GSA 12 Months", "Expiring VA 12 Months", "GSA", "VA", "8(a)", "HUBZone", "SDVOSB", "VOSB", "WOSB", "SBS"];
  const counts = [900, 900, 900, 900, 900, 900, 900, 900, 900, 476];
  const leads = [];
  names.forEach((route, index) => {
    for (let item = 0; item < counts[index]; item += 1) leads.push({ email: "lead-" + index + "-" + item + "@example.com", primaryRoute: route });
  });
  leads.push({ email: "hold-1@example.com", primaryRoute: "Unclassified" }, { email: "hold-2@example.com", primaryRoute: "Unclassified" });
  fs.writeFileSync(masterPath, leads.map(JSON.stringify).join("\n") + "\n", "utf8");
  fs.writeFileSync(planPath, JSON.stringify({
    ok: true, status: "ALL_SEGMENT_CONFIGURATION_PLANNED", configurationFingerprint: "A".repeat(64),
    globalDeduplication: { ok: true },
    routes: [...names.map((route, index) => ({ route, currentCampaignId: "campaign-" + index, currentCampaignName: route })), { route: "Unclassified", currentCampaignId: null }]
  }), "utf8");
  fs.writeFileSync(applyPath, JSON.stringify({
    ok: true, status: "SEGMENT_CONFIGURATION_COMPLETED", configurationApplyFingerprint: "B".repeat(64),
    summary: { routesWithInboxes: 10 },
    routes: names.map((route, index) => ({ route, campaignId: "campaign-" + index, paused: true, inboxesConfigured: true }))
  }), "utf8");

  const calls = [];
  const service = new Service({
    rootDir: root, masterPath, configurationPlanPath: planPath, configurationApplyPath: applyPath, outputRoot,
    generatedAt: () => "2026-08-08T00:00:00.000Z",
    planner: { route: lead => ({ name: lead.primaryRoute }) },
    leadProvider: async filters => {
      calls.push(filters);
      const index = Number(String(filters.campaign).split("-")[1]);
      return { items: [{ email: "LEAD-" + index + "-0@EXAMPLE.COM" }, { email: "unrelated-" + index + "@example.com" }] };
    }
  });

  await test("service is constructable", async () => assert.ok(service));
  const preview = await service.audit({});
  await test("default mode is plan-only", async () => assert.strictEqual(preview.mode, "PLAN_ONLY"));
  await test("plan performs no writes", async () => assert.strictEqual(fs.existsSync(outputRoot), false));
  await test("plan performs no provider reads", async () => assert.strictEqual(calls.length, 0));
  await test("plan authorizes no provider writes", async () => assert.strictEqual(preview.providerWritesAuthorized, false));
  await test("apply requires live flag", async () => assert.rejects(() => service.audit({ apply: true }), /--live/));

  const report = await service.audit({ apply: true, live: true });
  await test("audit completes", async () => assert.strictEqual(report.status, "GLOBAL_DUPLICATE_AUDIT_COMPLETED"));
  await test("all ten campaigns are audited", async () => assert.strictEqual(report.summary.campaignsAudited, 10));
  await test("every provider call is campaign scoped", async () => assert.ok(calls.every(call => /^campaign-/.test(call.campaign))));
  await test("provider records are counted", async () => assert.strictEqual(report.summary.providerRecordsRead, 20));
  await test("provider emails are globally deduplicated", async () => assert.strictEqual(report.summary.providerUniqueEmails, 20));
  await test("classified candidate total is exact", async () => assert.strictEqual(report.summary.classifiedCandidates, 8576));
  await test("global existing leads are detected", async () => assert.strictEqual(report.summary.alreadyPresentGlobally, 10));
  await test("upload delta is exact", async () => assert.strictEqual(report.summary.uploadDelta, 8566));
  await test("two unclassified leads are held", async () => assert.strictEqual(report.summary.unclassifiedHeld, 2));
  await test("case insensitive matching is used", async () => assert.strictEqual(report.routes[0].alreadyPresentGlobally, 1));
  await test("each route conserves candidates", async () => assert.ok(report.routes.every(route => route.conservationOk)));
  await test("global conservation passes", async () => assert.strictEqual(report.conservation.ok, true));
  await test("all-campaign comparison is recorded", async () => assert.strictEqual(report.globalProviderDeduplication.comparedAgainstAllTenCampaigns, true));
  await test("delta artifacts exist", async () => assert.ok(report.routes.every(route => fs.existsSync(route.artifacts.uploadDelta.filePath))));
  await test("existing artifacts exist", async () => assert.ok(report.routes.every(route => fs.existsSync(route.artifacts.existing.filePath))));
  await test("artifact hashes are recorded", async () => assert.match(report.routes[0].artifacts.uploadDelta.sha256, /^[A-F0-9]{64}$/));
  await test("manifest exists", async () => assert.strictEqual(fs.existsSync(report.artifact.filePath), true));
  await test("manifest hash is recorded", async () => assert.match(report.artifact.sha256, /^[A-F0-9]{64}$/));
  await test("audit fingerprint is recorded", async () => assert.match(report.auditFingerprint, /^[A-F0-9]{64}$/));
  await test("provider reads are explicit", async () => assert.strictEqual(report.providerReadsPerformed, true));
  await test("no provider writes occur", async () => assert.strictEqual(report.providerWritesAuthorized, false));
  await test("no leads upload", async () => assert.strictEqual(report.leadsUploaded, 0));
  await test("no emails send", async () => assert.strictEqual(report.emailsSent, false));
  await test("no campaigns change", async () => assert.strictEqual(report.campaignsChanged, false));
  await test("no campaigns launch", async () => assert.strictEqual(report.campaignsLaunched, false));
  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { apply: false, live: false }));
  await test("CLI parses live apply", async () => assert.deepStrictEqual(parseArguments(["--apply", "--live"]), { apply: true, live: true }));

  const malformed = new Service({
    rootDir: root, masterPath, configurationPlanPath: planPath, configurationApplyPath: applyPath, outputRoot: path.join(root, "bad"),
    planner: { route: lead => ({ name: lead.primaryRoute }) }, leadProvider: async () => ({ unexpected: [] })
  });
  await test("malformed provider response fails closed", async () => assert.rejects(() => malformed.audit({ apply: true, live: true }), /does not contain an array/));

  let repeatCalls = 0;
  const repeated = new Service({
    rootDir: root, masterPath, configurationPlanPath: planPath, configurationApplyPath: applyPath, outputRoot: path.join(root, "repeat"),
    planner: { route: lead => ({ name: lead.primaryRoute }) },
    leadProvider: async () => { repeatCalls += 1; return { items: [{ email: "x@example.com" }], next_starting_after: "same" }; }
  });
  await test("repeated pagination cursor fails closed", async () => assert.rejects(() => repeated.audit({ apply: true, live: true }), /repeated cursor/));
  await test("repeated cursor stops promptly", async () => assert.strictEqual(repeatCalls, 2));

  console.log("REVENUE_GLOBAL_INSTANTLY_DUPLICATE_AUDIT_TEST_PASS " + passed + "/36");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
