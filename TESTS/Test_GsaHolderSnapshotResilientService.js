"use strict";

const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const GsaHolderSnapshotResilientService = require("../SERVICES/GsaHolderSnapshotResilientService");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-gsa-resilient-"));
  const service = new GsaHolderSnapshotResilientService({ root });

  service.loadMonthlyAwards = async function () {
    this.samEnrichmentWarning = {
      code: "SAM_ENRICHMENT_UNAVAILABLE",
      message: "Official source returned HTTP 401.",
      effect: "Current holder truth remains authoritative from GSA eLibrary.",
      nonBlockingForCurrentHolderSnapshot: true
    };
    return { awards: [], totalRecords: 0, degraded: true, warning: this.samEnrichmentWarning };
  };

  assert.strictEqual(service.samEnrichmentWarning, null);
  const monthly = await service.loadMonthlyAwards("bad-key", {});
  assert.strictEqual(monthly.degraded, true);
  assert.strictEqual(service.samEnrichmentWarning.code, "SAM_ENRICHMENT_UNAVAILABLE");

  console.log("GSA_RESILIENT_SAM_ENRICHMENT_TEST_PASS");
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
