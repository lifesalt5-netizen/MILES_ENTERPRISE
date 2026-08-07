"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueOperationsInventorySyncService");
const { parseArguments } = require("../SCRIPTS/SyncRevenueOperationsInventory");

let passed = 0;
async function test(name, action) {
  await action();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-revenue-sync-"));
  let segmentCalls = 0;
  let campaignCalls = 0;
  const canonical = {
    ok: true,
    segments: [
      { segmentName: "New GSA Holders", companyCount: 10, verifiedEmailCount: 8, campaignName: "New GSA", campaignReady: true, uploadReady: true, assignedDomain: "p2gcoutreach.com", assignedInboxes: ["kevin@p2gcoutreach.com"], sourceFile: "new-gsa.csv", priority: 1 },
      { segmentName: "GSA No Sales", companyCount: 20, verifiedEmailCount: 0, campaignName: "GSA No Sales", campaignReady: false, uploadReady: false, blockers: ["NO_VERIFIED_EMAILS"], priority: 2 }
    ]
  };
  const liveCampaigns = { items: [{ id: "C1", name: "New GSA", status: "ACTIVE", daily_limit: 25 }] };
  const service = new Service({
    rootDir: root,
    segmentProvider: async () => { segmentCalls += 1; return canonical; },
    campaignProvider: async () => { campaignCalls += 1; return liveCampaigns; },
    generatedAt: () => "2026-08-07T16:00:00.000Z"
  });

  await test("inventory sync service is constructable", async () => assert.strictEqual(service.service, "REVENUE_OPERATIONS_INVENTORY_SYNC"));
  const plan = await service.sync();
  await test("default mode is plan-only", async () => assert.strictEqual(plan.mode, "PLAN_ONLY"));
  await test("plan performs no provider reads", async () => assert.deepStrictEqual([segmentCalls, campaignCalls], [0, 0]));
  await test("plan performs no writes", async () => assert.strictEqual(fs.existsSync(service.reportPath), false));
  await test("plan authorizes no external mutations", async () => assert.strictEqual(plan.externalMutationsAuthorized, false));
  const noLive = await service.sync({ apply: true });
  await test("apply requires explicit live read", async () => assert.strictEqual(noLive.status, "LIVE_READ_REQUIRED"));
  await test("missing live flag performs no provider reads", async () => assert.deepStrictEqual([segmentCalls, campaignCalls], [0, 0]));
  const result = await service.sync({ apply: true, live: true });
  await test("explicit live apply synchronizes", async () => assert.strictEqual(result.status, "SYNCHRONIZED"));
  await test("canonical segments are preserved", async () => assert.strictEqual(result.summary.canonicalSegments, 2));
  await test("live campaigns are captured", async () => assert.strictEqual(result.summary.liveCampaigns, 1));
  await test("campaigns match deterministically by name", async () => assert.strictEqual(result.segments[0].liveCampaignId, "C1"));
  await test("unmatched campaigns remain explicit", async () => assert.ok(result.segments[1].blockers.includes("LIVE_CAMPAIGN_NOT_FOUND")));
  await test("existing segment blockers are preserved", async () => assert.ok(result.segments[1].blockers.includes("NO_VERIFIED_EMAILS")));
  await test("segment inventory is persisted", async () => assert.strictEqual(JSON.parse(fs.readFileSync(service.segmentInventoryPath)).length, 2));
  await test("campaign registry is persisted", async () => assert.strictEqual(JSON.parse(fs.readFileSync(service.campaignRegistryPath)).length, 1));
  await test("sync report is persisted", async () => assert.strictEqual(fs.existsSync(service.reportPath), true));
  await test("artifacts contain integrity hashes", async () => assert.match(result.artifacts.report.sha256, /^[A-F0-9]{64}$/));
  await test("no emails are sent", async () => assert.strictEqual(result.emailsSent, false));
  await test("no leads are uploaded", async () => assert.strictEqual(result.leadsUploaded, false));
  await test("no campaigns are changed or launched", async () => assert.deepStrictEqual([result.campaignsChanged, result.campaignsLaunched], [false, false]));
  await test("CLI defaults to safe plan", async () => assert.deepStrictEqual(parseArguments([]), { apply: false, live: false }));
  await test("CLI requires explicit live apply flags", async () => assert.deepStrictEqual(parseArguments(["--apply", "--live"]), { apply: true, live: true }));
  await test("empty canonical inventory fails closed", async () => {
    const broken = new Service({ rootDir: root, segmentProvider: async () => ({ ok: true, segments: [] }), campaignProvider: async () => [] });
    await assert.rejects(() => broken.sync({ apply: true, live: true }), /unavailable or empty/);
  });
  await test("invalid campaign response fails closed", async () => {
    const broken = new Service({ rootDir: root, segmentProvider: async () => canonical, campaignProvider: async () => ({ unexpected: true }) });
    await assert.rejects(() => broken.sync({ apply: true, live: true }), /does not contain an array/);
  });

  console.log(`REVENUE_OPERATIONS_INVENTORY_SYNC_TEST_PASS ${passed}/24`);
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

