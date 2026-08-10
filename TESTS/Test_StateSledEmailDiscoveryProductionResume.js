"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "p1-3f-"));
  const originalCwd = process.cwd();
  const originalLimit = process.env.MILES_EMAIL_DISCOVERY_LIMIT;
  const originalOffset = process.env.MILES_EMAIL_DISCOVERY_OFFSET;
  const originalMv = process.env.MILLIONVERIFIER_API_KEY;

  try {
    process.chdir(temp);
    fs.mkdirSync(path.join(temp, "CONFIG"), { recursive: true });
    fs.mkdirSync(path.join(temp, "DATA", "OUTBOUND", "STATE_SLED", "ENRICHMENT_QUEUE"), { recursive: true });
    fs.writeFileSync(path.join(temp, ".env"), "MILLIONVERIFIER_API_KEY=test-only-key\n", "utf8");
    fs.writeFileSync(path.join(temp, "CONFIG", "state_sled_email_discovery_rules.json"), JSON.stringify({
      version: "1.0.0",
      gate: "P1.3E_EMAIL_DISCOVERY_AND_VERIFICATION",
      sourceQueue: "DATA/OUTBOUND/STATE_SLED/ENRICHMENT_QUEUE/STATE_SLED_WAVE1_EMAIL_DISCOVERY_QUEUE.csv",
      outputDir: "DATA/OUTBOUND/STATE_SLED/EMAIL_DISCOVERY",
      execution: { defaultLimit: 2, maxLimit: 2, concurrency: 1, requestTimeoutMs: 25, maxPagesPerDomain: 1, candidatePaths: ["/"] },
      verification: { provider: "MillionVerifier", apiBaseUrl: "https://api.millionverifier.com/api/v3/", apiKeyEnvNames: ["MILLIONVERIFIER_API_KEY"], timeoutSeconds: 1, acceptedResults: ["ok"], rejectedResults: ["invalid"] },
      discovery: { excludeLocalParts: [], preferredLocalParts: [] },
      safety: { createInstantlyCampaigns: false, uploadInstantlyLeads: false, activateCampaigns: false, deleteCampaigns: false, inventEmails: false }
    }, null, 2));
    fs.writeFileSync(path.join(temp, "DATA", "OUTBOUND", "STATE_SLED", "ENRICHMENT_QUEUE", "STATE_SLED_WAVE1_EMAIL_DISCOVERY_QUEUE.csv"), [
      "uei,legalName,state,domain",
      "A1,One,FL,",
      "A2,Two,FL,",
      "A3,Three,FL,"
    ].join("\n"));

    delete require.cache[require.resolve("../SERVICES/StateSledEmailDiscoveryService")];
    const servicePath = path.join(originalCwd, "SERVICES", "StateSledEmailDiscoveryService.js");
    delete require.cache[servicePath];
    const service = require(servicePath);

    process.env.MILES_EMAIL_DISCOVERY_LIMIT = "2";
    delete process.env.MILES_EMAIL_DISCOVERY_OFFSET;

    const first = await service.run();
    assert.strictEqual(first.stats.offset, 0);
    assert.strictEqual(first.stats.processed, 2);
    assert.strictEqual(first.stats.nextOffset, 2);
    assert.strictEqual(first.stats.millionVerifierConfigured, true);

    const second = await service.run();
    assert.strictEqual(second.stats.offset, 2);
    assert.strictEqual(second.stats.processed, 1);
    assert.strictEqual(second.stats.nextOffset, 3);
    assert.strictEqual(second.stats.remainingInQueue, 0);

    console.log("STATE_SLED_EMAIL_DISCOVERY_PRODUCTION_RESUME_TEST=PASS");
  } finally {
    process.chdir(originalCwd);
    if (originalLimit === undefined) delete process.env.MILES_EMAIL_DISCOVERY_LIMIT; else process.env.MILES_EMAIL_DISCOVERY_LIMIT = originalLimit;
    if (originalOffset === undefined) delete process.env.MILES_EMAIL_DISCOVERY_OFFSET; else process.env.MILES_EMAIL_DISCOVERY_OFFSET = originalOffset;
    if (originalMv === undefined) delete process.env.MILLIONVERIFIER_API_KEY; else process.env.MILLIONVERIFIER_API_KEY = originalMv;
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
