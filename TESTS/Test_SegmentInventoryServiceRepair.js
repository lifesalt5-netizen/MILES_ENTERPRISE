"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const SegmentInventoryService = require("../SERVICES/SegmentInventoryService");

let passed = 0;
async function test(name, action) {
  await action();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-segment-inventory-"));
  const inventoryFile = path.join(root, "SEGMENT_INVENTORY_MASTER.csv");
  const outputDir = path.join(root, "evidence");
  fs.writeFileSync(
    inventoryFile,
    "Segment,Companies,Contacts,VerifiedEmails,Campaign,AssignedDomain,AssignedInboxes,SourceFile,NeedsUpload,NeedsEnrichment,Priority\nNew GSA Holders,10,9,8,New GSA,p2gcoutreach.com,kevin@p2gcoutreach.com,new-gsa.csv,Yes,No,1\n",
    "utf8"
  );
  const registry = { getRegistry: () => ({ inventory: { segmentInventory: inventoryFile } }) };
  const service = new SegmentInventoryService({ rootDir: root, registry, inventoryFile, outputDir });

  await test("segment inventory service is constructable", async () => assert.ok(service));
  const inventory = service.getInventory();
  await test("inventory loads successfully", async () => assert.strictEqual(inventory.ok, true));
  await test("inventory preserves segment count", async () => assert.strictEqual(inventory.summary.totalSegments, 1));
  await test("verified email count is normalized", async () => assert.strictEqual(inventory.summary.totalVerifiedEmails, 8));
  await test("campaign-ready segment is recognized", async () => assert.strictEqual(inventory.summary.campaignReadySegments, 1));
  await test("inventory evidence is written", async () => assert.strictEqual(fs.existsSync(inventory.evidenceFile), true));
  const executed = await service.executeTask({ action: "getInventory" });
  await test("executeTask dispatches inventory action", async () => assert.strictEqual(executed.ok, true));
  await test("unsupported action fails closed", async () => {
    await assert.rejects(() => service.executeTask({ action: "deleteEverything" }), /Unsupported/);
  });

  console.log(`SEGMENT_INVENTORY_SERVICE_REPAIR_TEST_PASS ${passed}/8`);
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

