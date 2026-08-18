"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  CaptureCapacitySourceBootstrapService
} = require("../SERVICES/revenue/CaptureCapacitySourceBootstrapService");
const {
  CaptureCapacityRevenueDiscovery
} = require("../SERVICES/Discovery/CaptureCapacityRevenueDiscovery");

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capture-source-bootstrap-"));
  const currentDir = path.join(root, "CONSOLIDATION OF LEADS", "EVENTS");
  const archiveDir = path.join(root, "_ARCHIVE_OLD", "CONSOLIDATION OF LEADS");
  fs.mkdirSync(currentDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  const ready = path.join(currentDir, "HAS_EMAIL_READY_FOR_OUTREACH.csv");
  const contacts = path.join(root, "P2GC_GSA_LEADS_WITH_CONTACTS.csv");
  const archive = path.join(archiveDir, "P2GC_READY_TO_SEND.csv");
  const unsupported = path.join(root, "P2GC_GSA_LEADS_WITH_CONTACTS.xlsx");

  fs.writeFileSync(ready, "company,email\nAlpha,alpha@example.com\n", "utf8");
  fs.writeFileSync(contacts, "company,email\nBravo,bravo@example.com\n", "utf8");
  fs.writeFileSync(archive, "company,email\nOld,old@example.com\n", "utf8");
  fs.writeFileSync(unsupported, "not-an-xlsx", "utf8");

  const indexFile = path.join(root, "SEGMENT_FILE_DISCOVERY.csv");
  fs.writeFileSync(
    indexFile,
    [
      '"FullName"',
      `"${archive}"`,
      `"${unsupported}"`,
      `"${contacts}"`,
      `"${ready}"`,
      `"${path.join(root, "missing_leads.csv")}"`
    ].join("\n"),
    "utf8"
  );

  const env = {};
  const bootstrap = new CaptureCapacitySourceBootstrapService({
    rootDir: root,
    env,
    indexFiles: [indexFile],
    maxSources: 10,
    maxFileBytes: 1024 * 1024
  });

  const report = bootstrap.apply();

  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.status, "CONTACT_SOURCES_BOOTSTRAPPED");
  assert.strictEqual(report.autoConfigured, true);
  assert.strictEqual(report.selectedCount, 2);
  assert.strictEqual(report.selectedSources[0].filePath, ready);
  assert.ok(report.selectedSources.some(item => item.filePath === contacts));
  assert.strictEqual(report.rejectionCounts.ARCHIVE_EXCLUDED, 1);
  assert.strictEqual(report.rejectionCounts.UNSUPPORTED_EXTENSION, 1);
  assert.strictEqual(report.rejectionCounts.FILE_NOT_FOUND, 1);
  assert.ok(env.CAPTURE_CAPACITY_CONTACT_SOURCES.includes(ready));
  assert.ok(env.CAPTURE_CAPACITY_CONTACT_SOURCES.includes(contacts));
  assert.ok(!env.CAPTURE_CAPACITY_CONTACT_SOURCES.includes(archive));
  assert.ok(fs.existsSync(report.artifact));

  const newest = path.join(currentDir, "HAS_EMAIL_VERIFIED_CONTACTS_READY_TO_SEND.csv");
  fs.writeFileSync(newest, "company,email\nCharlie,charlie@example.com\n", "utf8");
  fs.appendFileSync(indexFile, `\n"${newest}"`, "utf8");

  const refreshed = bootstrap.apply();

  assert.strictEqual(refreshed.status, "CONTACT_SOURCES_BOOTSTRAPPED");
  assert.strictEqual(refreshed.mode, "AUTO_INDEX");
  assert.strictEqual(refreshed.selectedCount, 3);
  assert.strictEqual(refreshed.selectedSources[0].filePath, newest);
  assert.ok(env.CAPTURE_CAPACITY_CONTACT_SOURCES.includes(newest));

  const explicitEnv = {
    CAPTURE_CAPACITY_CONTACT_SOURCES: contacts
  };
  const explicit = new CaptureCapacitySourceBootstrapService({
    rootDir: root,
    env: explicitEnv,
    indexFiles: [indexFile]
  }).apply();

  assert.strictEqual(explicit.ok, true);
  assert.strictEqual(explicit.status, "EXPLICIT_CONTACT_SOURCES_PRESERVED");
  assert.strictEqual(explicit.autoConfigured, false);
  assert.strictEqual(explicit.selectedCount, 1);
  assert.strictEqual(explicitEnv.CAPTURE_CAPACITY_CONTACT_SOURCES, contacts);

  const order = [];
  const revenueDiscovery = new CaptureCapacityRevenueDiscovery({
    sourceBootstrap: {
      apply() {
        order.push("bootstrap");
        return {
          ok: true,
          status: "CONTACT_SOURCES_BOOTSTRAPPED",
          selectedCount: 2,
          artifact: "bootstrap.json"
        };
      }
    },
    service: {
      discover() {
        order.push("discover");
        return {
          artifact: "feed.json",
          sourceCounts: {
            contactRows: 2,
            signalRows: 1,
            enrichedRows: 1,
            qualifiedRows: 1,
            blockedByCampaignGate: 0
          },
          campaignGate: {
            eligibleCount: 1,
            blockedCount: 0
          },
          nextAction: "READY_FOR_CAPTURE_CAPACITY_CAMPAIGN_HANDOFF"
        };
      }
    }
  });

  const discoveryResult = await revenueDiscovery.discover();

  assert.deepStrictEqual(order, ["bootstrap", "discover"]);
  assert.strictEqual(discoveryResult.work.length, 1);
  assert.strictEqual(discoveryResult.work[0].capability, "revenue.capture_capacity_handoff");
  assert.strictEqual(discoveryResult.work[0].metadata.sourceBootstrapStatus, "CONTACT_SOURCES_BOOTSTRAPPED");
  assert.strictEqual(discoveryResult.feed.sourceBootstrap.selectedCount, 2);

  fs.rmSync(root, { recursive: true, force: true });

  console.log("PASS capture_capacity_source_bootstrap_test");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
