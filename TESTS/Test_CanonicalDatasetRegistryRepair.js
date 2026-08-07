"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const CanonicalDatasetRegistry = require("../SERVICES/CanonicalDatasetRegistry");

let passed = 0;

async function test(name, action) {
  await action();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-canonical-registry-"));
  const segmentFile = path.join(root, "segment.csv");
  const repositoryFile = path.join(root, "verified.csv");
  const inventoryFile = path.join(root, "inventory.csv");
  const registryPath = path.join(root, "registry.json");

  fs.writeFileSync(segmentFile, "email\nverified@example.com\n", "utf8");
  fs.writeFileSync(repositoryFile, "email\nverified@example.com\n", "utf8");
  fs.writeFileSync(inventoryFile, "Segment,VerifiedEmails\nGSA,1\n", "utf8");

  const contract = {
    version: "test-1.0.0",
    segments: {
      GSA: {
        id: "gsa",
        primary: segmentFile,
        fallback: "",
        campaign: "GSA Campaign",
        domain: "example.com"
      }
    },
    verifiedRepositories: {
      primary: {
        id: "verified",
        path: repositoryFile
      }
    },
    campaignMappings: {
      GSA: {
        segment: "GSA",
        campaign: "GSA Campaign"
      }
    },
    domains: {
      "example.com": {
        enabled: true,
        purpose: "GSA"
      }
    },
    inventory: {
      segmentInventory: inventoryFile
    }
  };

  fs.writeFileSync(registryPath, JSON.stringify(contract, null, 2), "utf8");

  const registry = new CanonicalDatasetRegistry(registryPath);

  await test("canonical registry service is constructable", async () => {
    assert.ok(registry);
  });

  await test("registry contract loads", async () => {
    assert.strictEqual(registry.getRegistry().version, "test-1.0.0");
  });

  await test("segment resolves its primary dataset", async () => {
    const segment = registry.getSegment("GSA");
    assert.strictEqual(segment.exists, true);
    assert.strictEqual(segment.using, "PRIMARY");
    assert.strictEqual(segment.resolvedPath, segmentFile);
  });

  await test("all segment names are returned", async () => {
    assert.deepStrictEqual(registry.getAllSegments(), ["GSA"]);
  });

  await test("verified repository resolves", async () => {
    assert.strictEqual(registry.getVerifiedRepository().exists, true);
  });

  await test("campaign mapping resolves", async () => {
    assert.strictEqual(registry.getCampaign("GSA").campaign, "GSA Campaign");
  });

  await test("domain mapping resolves", async () => {
    assert.strictEqual(registry.getDomain("example.com").enabled, true);
  });

  await test("registry validation is healthy", async () => {
    assert.strictEqual(registry.validate().valid, true);
  });

  const health = registry.health();

  await test("health reports every registry collection", async () => {
    assert.strictEqual(health.status, "HEALTHY");
    assert.strictEqual(health.totalSegments, 1);
    assert.strictEqual(health.verifiedRepositories, 1);
    assert.strictEqual(health.campaignMappings, 1);
    assert.strictEqual(health.domains, 1);
  });

  await test("health confirms inventory contract", async () => {
    assert.strictEqual(health.inventoryConfigured, true);
  });

  await test("unknown segment fails closed", async () => {
    assert.throws(() => registry.getSegment("UNKNOWN"), /Unknown segment/);
  });

  console.log(`CANONICAL_DATASET_REGISTRY_REPAIR_TEST_PASS ${passed}/11`);
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
