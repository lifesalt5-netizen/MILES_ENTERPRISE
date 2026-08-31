"use strict";

const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const GsaHolderSnapshotResilientService = require("../SERVICES/GsaHolderSnapshotResilientService");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-gsa-resilient-"));
  const service = new GsaHolderSnapshotResilientService({ root });

  service.samAwardsUrl = "https://api.sam.gov/contract-awards/v1/search";
  service.requestText = async () => {
    throw new Error("Official source returned HTTP 401.");
  };

  const monthly = await service.loadMonthlyAwards("bad-key", {
    start: "08/01/2026",
    end: "08/31/2026"
  });

  assert.strictEqual(monthly.degraded, true);
  assert.strictEqual(monthly.awards.length, 0);
  assert.strictEqual(service.samEnrichmentWarning.code, "SAM_ENRICHMENT_UNAVAILABLE");
  assert.strictEqual(service.samEnrichmentWarning.nonBlockingForCurrentHolderSnapshot, true);

  console.log("GSA_RESILIENT_SAM_ENRICHMENT_TEST_PASS");
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
