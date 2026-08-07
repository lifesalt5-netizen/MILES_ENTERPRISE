"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require(
  "../SERVICES/revenue/RevenueOperationsBootstrapAuditService"
);
const { parseArguments } = require(
  "../SCRIPTS/AuditRevenueOperationsBootstrap"
);

let passed = 0;
async function test(name, action) {
  await action();
  passed += 1;
  console.log(`[PASS] ${name}`);
}
function write(root, relative, content) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-revenue-audit-"));
  write(root, "SERVICES/workers/InstantlyCOOWorker.js", "SYNC_CAMPAIGNS SYNC_SEGMENTS UPLOAD_LEADS CHECK_DELIVERABILITY");
  write(root, "CONNECTORS/INSTANTLY/connector.js", "healthCheck listCampaigns createLead");
  write(root, "SERVICES/InstantlyApiClient.js", "INSTANTLY_API_KEY credentialsPresent async request");
  write(root, "SERVICES/SegmentInventoryService.js", "SEGMENT_INVENTORY_MASTER.csv verifiedEmailCount needsUpload");
  write(root, "SERVICES/CapabilityService.js", "revenue.outbound.audit marketing.segment.replenish MarketingProvider");
  write(root, "SERVICES/ProviderRouterService.js", "MarketingProvider");
  write(root, "DATA/OUTBOUND/SEGMENT_INVENTORY_MASTER.csv", "Segment,VerifiedEmails\nGSA,10\n");
  write(root, "runtime/instantly_coo/segment_inventory.json", "[]");
  write(root, "runtime/instantly_coo/campaign_registry.json", "[]");
  write(root, "runtime/instantly_coo/lead_upload_queue.json", "[]");
  write(root, "runtime/worker_registry/registered_workers.json", JSON.stringify([{ name: "InstantlyCOOWorker" }]));
  const service = new Service({
    rootDir: root,
    env: { INSTANTLY_API_KEY: "valid-test-key-123456" },
    connectorHealth: async () => ({ ok: true, status: "HEALTHY", httpStatus: 200 }),
    generatedAt: () => "2026-08-07T15:00:00.000Z"
  });

  await test("revenue audit service is constructable", async () => assert.strictEqual(service.service, "REVENUE_OPERATIONS_BOOTSTRAP_AUDIT"));
  const preview = await service.audit();
  await test("default mode is plan-only", async () => assert.strictEqual(preview.mode, "PLAN_ONLY"));
  await test("plan-only performs no writes", async () => assert.strictEqual(fs.existsSync(service.outputPath), false));
  await test("all source contracts are verified", async () => assert.strictEqual(preview.sourceContractsHealthy, true));
  await test("credentials are reported without values", async () => {
    assert.strictEqual(preview.credentials.instantlyApiKeyPresent, true);
    assert.strictEqual(preview.credentials.valuesExposed, false);
    assert.strictEqual(JSON.stringify(preview).includes("valid-test-key"), false);
  });
  await test("Instantly worker registration is verified", async () => assert.strictEqual(preview.workerRegistry.ok, true));
  await test("inventory contracts are verified", async () => assert.strictEqual(preview.inventoryContractsHealthy, true));
  await test("live connector is not called unless requested", async () => assert.strictEqual(preview.liveConnector.checked, false));
  await test("audit never authorizes operational writes", async () => assert.strictEqual(preview.operationalWritesAuthorized, false));
  await test("audit sends no email", async () => assert.strictEqual(preview.emailsSent, false));
  await test("audit changes no campaigns", async () => assert.strictEqual(preview.campaignsChanged, false));
  await test("audit fingerprint is deterministic", async () => assert.match(preview.auditFingerprint, /^[A-F0-9]{64}$/));
  const live = await service.audit({ live: true });
  await test("explicit live health succeeds", async () => assert.strictEqual(live.liveConnector.ok, true));
  await test("healthy complete bootstrap reports ready", async () => assert.strictEqual(live.revenueBootstrapReady, true));
  const applied = await service.audit({ live: true, apply: true });
  await test("explicit apply persists audit evidence", async () => assert.strictEqual(fs.existsSync(applied.artifact.filePath), true));
  await test("persisted audit has integrity hash", async () => assert.match(applied.artifact.sha256, /^[A-F0-9]{64}$/));

  const missingKey = new Service({ rootDir: root, env: {}, connectorHealth: async () => ({ ok: true }) });
  const blockedKey = await missingKey.audit({ live: true });
  await test("missing credential blocks readiness", async () => assert.ok(blockedKey.blockers.includes("MISSING_INSTANTLY_API_KEY")));
  fs.unlinkSync(path.join(root, "runtime", "instantly_coo", "campaign_registry.json"));
  const blockedInventory = await service.audit({ live: true });
  await test("missing inventory blocks readiness", async () => assert.ok(blockedInventory.blockers.includes("INVENTORY:campaignRegistry")));
  await test("CLI defaults to plan-only and offline", async () => assert.deepStrictEqual(parseArguments([]), { apply: false, live: false }));
  await test("CLI live apply flags are explicit", async () => assert.deepStrictEqual(parseArguments(["--apply", "--live"]), { apply: true, live: true }));

  console.log(`REVENUE_OPERATIONS_BOOTSTRAP_AUDIT_TEST_PASS ${passed}/20`);
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

