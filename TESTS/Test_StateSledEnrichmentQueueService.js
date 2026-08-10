"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const service = require("../SERVICES/StateSledEnrichmentQueueService");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p1-3d-"));
  const inputFile = path.join(root, "input.csv");
  const rulesFile = path.join(root, "rules.json");
  const outDir = path.join(root, "out");

  fs.writeFileSync(
    inputFile,
    [
      "UEI,Legal_Name,NORMALIZED_STATE,Industry_Segment,Market_Priority,Lead_Score,POC_Name,POC_Email,Website",
      "A1,Alpha LLC,FL,IT_SERVICES,TOP_MARKET,90,Alice,alice@example.com,https://alpha.example",
      "A2,Beta LLC,TX,CONSULTING,TOP_MARKET,80,Bob,,https://beta.example",
      "A3,Gamma LLC,CA,ENGINEERING,TOP_MARKET,70,Carol,,",
      "A4,Delta LLC,MD,BUSINESS_SUPPORT,NORMAL,60,Dan,not-an-email,https://delta.example"
    ].join("\n"),
    "utf8"
  );

  fs.writeFileSync(
    rulesFile,
    JSON.stringify({
      version: "test",
      gate: "P1.3D_ENRICHMENT_VERIFICATION_QUEUE",
      batchSize: 2,
      statePriority: ["FL", "TX", "CA", "VA", "MD"],
      industryPriority: ["IT_SERVICES", "CONSULTING", "BUSINESS_SUPPORT", "ENGINEERING", "TRAINING_EDUCATION_SERVICES"],
      emailFields: ["POC_Email"],
      websiteFields: ["Website"],
      nameFields: ["POC_Name"],
      stateFields: ["NORMALIZED_STATE"],
      industryFields: ["Industry_Segment"],
      leadScoreFields: ["Lead_Score"],
      safety: {
        inventEmails: false,
        callEnrichmentProvider: false,
        callVerificationProvider: false,
        createInstantlyCampaigns: false,
        uploadInstantlyLeads: false,
        activateCampaigns: false,
        deleteCampaigns: false
      }
    }, null, 2),
    "utf8"
  );

  const r = await service.run({ inputFile, rulesFile, outDir });

  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stats.totalCleanWave1, 4);
  assert.strictEqual(r.stats.existingEmailVerificationRequired, 1);
  assert.strictEqual(r.stats.emailDiscoveryRequired, 2);
  assert.strictEqual(r.stats.websiteResearchRequired, 1);
  assert.strictEqual(r.stats.discoveryBatches, 1);
  assert.strictEqual(service.validEmail("alice@example.com"), true);
  assert.strictEqual(service.validEmail("bad-email"), false);
  assert.strictEqual(service.normalizeWebsite("www.example.com"), "example.com");
  assert.strictEqual(r.stats.safety.inventEmails, false);
  assert.ok(fs.existsSync(r.outputs.enrichmentFile));
  assert.ok(fs.existsSync(r.outputs.verificationFile));
  assert.ok(fs.existsSync(r.outputs.researchHoldFile));
  assert.ok(fs.existsSync(r.outputs.auditFile));

  console.log("STATE_SLED_ENRICHMENT_QUEUE_TEST=PASS");
  console.dir(r.stats, { depth: 8 });
})();
