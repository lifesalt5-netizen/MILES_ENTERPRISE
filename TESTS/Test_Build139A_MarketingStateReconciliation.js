"use strict";

const assert = require("assert");

const reconciliation =
  require("../SERVICES/marketing/MarketingStateReconciliationService");

const result =
  reconciliation.reconcile({
    campaigns: [
      {
        id: "campaign-sbs",
        name: "SBS Verified Email Targets",
        rawStatus: 1,
        sendingAccounts: [
          "contacts@pathwaysgsa.com"
        ],
        protectedAssignments: [],
        dailyLimit: 240,
        stopOnReply: true,
        bounceProtectionEnabled: true
      },
      {
        id: "campaign-gsa",
        name: "GSA No Sales",
        rawStatus: -2,
        sendingAccounts: [
          "cora@pathwaysgovcon.com"
        ],
        protectedAssignments: [],
        dailyLimit: 100,
        stopOnReply: true,
        bounceProtectionEnabled: true
      },
      {
        id: "campaign-expired",
        name: "EXPIRED everything",
        rawStatus: 0,
        sendingAccounts: [],
        protectedAssignments: []
      }
    ],

    campaignAnalytics: [
      {
        campaign_id: "campaign-sbs",
        campaign_name:
          "SBS Verified Email Targets",
        campaign_status: 1,
        leads_count: 6482,
        contacted_count: 3146,
        reply_count_unique: 5,
        bounced_count: 63,
        total_opportunities: 1,
        total_opportunity_value: 2500
      },
      {
        campaign_id: "campaign-gsa",
        campaign_name:
          "GSA No Sales",
        campaign_status: -2,
        leads_count: 5292,
        contacted_count: 1553,
        reply_count_unique: 4,
        bounced_count: 82,
        total_opportunities: 0,
        total_opportunity_value: 0
      }
    ],

    sourceSegments: [
      {
        name:
          "SBS Verified Email Targets",
        leadCount: 7000,
        verifiedEmailCount: 7000,
        needsUpload: false,
        campaignStatus: "ACTIVE"
      },
      {
        name:
          "GSA No Sales",
        leadCount: 22775,
        verifiedEmailCount: 6000,
        needsUpload: true,
        campaignStatus: "STOPPED"
      },
      {
        name:
          "EXPIRED everything",
        leadCount: 500,
        verifiedEmailCount: 500,
        needsUpload: true,
        campaignStatus: "DRAFT"
      }
    ]
  });

assert.strictEqual(
  result.ok,
  true
);

assert.strictEqual(
  result.summary.campaignsProcessed,
  3
);

assert.strictEqual(
  result.summary.sourceSegmentsProcessed,
  3
);

const sbs =
  result.inventory.find(
    segment =>
      segment.canonicalSegment ===
      "SBS_VERIFIED_EMAIL_TARGETS"
  );

assert.ok(
  sbs,
  "SBS canonical segment missing"
);

assert.strictEqual(
  sbs.campaignLeads,
  6482
);

assert.strictEqual(
  sbs.contacted,
  3146
);

assert.strictEqual(
  sbs.remainingInCampaigns,
  3336
);

assert.strictEqual(
  sbs.verifiedEmailCount,
  7000
);

assert.strictEqual(
  sbs.hasActiveCampaign,
  true
);

const gsa =
  result.inventory.find(
    segment =>
      segment.canonicalSegment ===
      "GSA_NO_SALES"
  );

assert.ok(
  gsa,
  "GSA canonical segment missing"
);

assert.strictEqual(
  gsa.campaignLeads,
  5292
);

assert.strictEqual(
  gsa.contacted,
  1553
);

assert.strictEqual(
  gsa.remainingInCampaigns,
  3739
);

assert.strictEqual(
  gsa.verifiedEmailCount,
  6000
);

const expired =
  result.inventory.find(
    segment =>
      segment.canonicalSegment ===
      "EXPIRED_EVERYTHING"
  );

assert.ok(
  expired,
  "Expired canonical segment missing"
);

assert.strictEqual(
  expired.readiness,
  "UPLOAD_READY"
);

assert.strictEqual(
  result.summary.unknownSegments,
  0
);

assert.ok(
  result.recommendations.length > 0
);

const duplicateExceptionKeys =
  result.exceptions.map(
    exception =>
      [
        exception.type,
        exception.canonicalSegment,
        exception.message
      ].join("|")
  );

assert.strictEqual(
  duplicateExceptionKeys.length,
  new Set(duplicateExceptionKeys).size,
  "Duplicate exceptions detected"
);

console.log(
  "[PASS] Canonical campaign names resolved"
);

console.log(
  "[PASS] Campaign analytics reconciled"
);

console.log(
  "[PASS] Remaining campaign inventory calculated"
);

console.log(
  "[PASS] Source verified inventory merged"
);

console.log(
  "[PASS] Upload readiness calculated"
);

console.log(
  "[PASS] Duplicate exceptions suppressed"
);

console.log("");
console.log(
  JSON.stringify(
    {
      summary:
        result.summary,
      inventory:
        result.inventory.map(
          segment => ({
            canonicalSegment:
              segment.canonicalSegment,
            campaignLeads:
              segment.campaignLeads,
            contacted:
              segment.contacted,
            remainingInCampaigns:
              segment.remainingInCampaigns,
            verifiedEmailCount:
              segment.verifiedEmailCount,
            readiness:
              segment.readiness
          })
        ),
      recommendations:
        result.recommendations
    },
    null,
    2
  )
);

console.log("");
console.log(
  "BUILD139A_MARKETING_RECONCILIATION_TEST_PASS"
);
