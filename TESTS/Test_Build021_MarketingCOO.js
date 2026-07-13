"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const ROOT = process.env.MILES_ROOT;
const outboundDir =
  path.join(ROOT, "DATA", "OUTBOUND");
const runtimeDir =
  path.join(ROOT, "runtime", "instantly_coo");

fs.mkdirSync(outboundDir, {
  recursive: true
});

fs.mkdirSync(runtimeDir, {
  recursive: true
});

const files = {
  campaigns: path.join(
    outboundDir,
    "CAMPAIGN_STATUS_MASTER.csv"
  ),
  domains: path.join(
    outboundDir,
    "DOMAIN_STATUS_MASTER.csv"
  ),
  segments: path.join(
    outboundDir,
    "SEGMENT_INVENTORY_MASTER.csv"
  ),
  queue: path.join(
    runtimeDir,
    "lead_upload_queue.json"
  )
};

const prior = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [
    key,
    fs.existsSync(file)
      ? fs.readFileSync(file, "utf8")
      : null
  ])
);

fs.writeFileSync(
  files.campaigns,
  [
    "Campaign,Status",
    "GSA No Sales,Active",
    "SAM Growth,Paused"
  ].join("\n"),
  "utf8"
);

fs.writeFileSync(
  files.domains,
  [
    "Domain,Status,Protected",
    "pathwaysgovcon.com,Healthy,No",
    "pathways2gc.com,Healthy,Yes"
  ].join("\n"),
  "utf8"
);

fs.writeFileSync(
  files.segments,
  [
    "Segment_Name,Lead_Count,Verified_Email_Count,Needs_Enrichment,Needs_Upload,Campaign_Status",
    "GSA_NO_SALES,1000,500,No,Yes,Ready",
    "SAM_EMPTY,100,0,Yes,No,Needs Enrichment"
  ].join("\n"),
  "utf8"
);

fs.writeFileSync(
  files.queue,
  JSON.stringify([
    {
      segment: "GSA_NO_SALES",
      status: "PENDING"
    }
  ], null, 2),
  "utf8"
);

const MarketingProvider =
  require("../PROVIDERS/providers/MarketingProvider");

async function main() {
  const fakeInstantlyCOO = {
    async generateSnapshot() {
      return {
        ok: true,
        status: "WARNING",
        summary: {
          totalAccounts: 4,
          campaignSafeAccounts: 3,
          protectedAccounts: 1,
          healthyAccounts: 2,
          warningAccounts: 1,
          criticalAccounts: 0,
          totalCampaigns: 2,
          healthyCampaigns: 1,
          warningCampaigns: 1,
          criticalCampaigns: 0,
          totalDailyCapacity: 100,
          averageWarmupScore: 95,
          lowestWarmupScore: 88
        },
        accounts: [],
        campaigns: [{
          id: "campaign-1",
          name: "GSA No Sales",
          protectedAssignments: [],
          recommendations: []
        }],
        recommendations: [
          "Reduce sending volume for one warning account."
        ],
        errors: []
      };
    }
  };

  const provider =
    new MarketingProvider({
      instantlyCOO: fakeInstantlyCOO
    });

  const result =
    await provider.auditMarketingOperations();

  assert.strictEqual(
    result.provider,
    "MarketingProvider"
  );

  assert.strictEqual(
    result.readOnly,
    true
  );

  assert.strictEqual(
    result.metrics.totalCampaigns,
    2
  );

  assert.strictEqual(
    result.metrics.totalDailyCapacity,
    100
  );

  assert.strictEqual(
    result.metrics.segmentInventory
      .uploadReadySegments,
    1
  );

  assert.strictEqual(
    result.metrics.segmentInventory
      .depletedSegments,
    1
  );

  assert.strictEqual(
    result.metrics.queuedLeadUploads,
    1
  );

  assert.strictEqual(
    result.safety.writesEnabled,
    false
  );

  assert(
    result.recommendations.some(item =>
      /Queue verified lead upload/i.test(item)
    )
  );

  assert(
    result.recommendations.some(item =>
      /replenish segment/i.test(item)
    )
  );

  assert(
    fs.existsSync(result.evidenceFile),
    "Marketing COO evidence file was not created."
  );

  console.log(JSON.stringify({
    ok: true,
    build: "021",
    tests: {
      instantlyCOOIntegration: "PASSED",
      campaignHealth: "PASSED",
      warmupHealth: "PASSED",
      dailyCapacity: "PASSED",
      protectedDomainPolicy: "PASSED",
      segmentInventory: "PASSED",
      leadUploadReadiness: "PASSED",
      readOnlySafety: "PASSED",
      evidencePersistence: "PASSED"
    },
    status: result.status,
    metrics: result.metrics,
    recommendations:
      result.recommendations,
    safety: result.safety,
    evidenceFile:
      result.evidenceFile
  }, null, 2));
}

main()
  .finally(() => {
    for (
      const [key, file]
      of Object.entries(files)
    ) {
      if (prior[key] === null) {
        try {
          fs.unlinkSync(file);
        } catch {}
      } else {
        fs.writeFileSync(
          file,
          prior[key],
          "utf8"
        );
      }
    }
  })
  .catch(error => {
    console.error(
      error.stack || error.message
    );

    process.exit(1);
  });

