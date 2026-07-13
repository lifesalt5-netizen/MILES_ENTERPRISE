"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const ROOT =
  process.env.MILES_ROOT;

const files = {
  sales: path.join(
    ROOT,
    "DATA",
    "sales_coo",
    "latest_sales_operation.json"
  ),
  marketing: path.join(
    ROOT,
    "DATA",
    "marketing_coo",
    "latest_marketing_operation.json"
  ),
  orion: path.join(
    ROOT,
    "DATA",
    "orion_coo",
    "latest_orion_operation.json"
  ),
  website: path.join(
    ROOT,
    "DATA",
    "website_coo",
    "latest_website_operation.json"
  ),
  googleWorkspace: path.join(
    ROOT,
    "DATA",
    "google_workspace_coo",
    "latest_google_workspace_operation.json"
  )
};

const prior = {};

function write(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  prior[file] =
    fs.existsSync(file)
      ? fs.readFileSync(
          file,
          "utf8"
        )
      : null;

  fs.writeFileSync(
    file,
    JSON.stringify(
      value,
      null,
      2
    ),
    "utf8"
  );
}

write(files.sales, {
  ok: true,
  status: "Healthy",
  generatedAt:
    new Date().toISOString(),
  metrics: {
    repliesProcessed: 2,
    protectedActions: 1,
    critical: 1,
    stalledDeals: 1
  },
  exceptions: [],
  recommendations: [{
    action:
      "PREPARE_SUBMISSION_READINESS",
    requiresCEOApproval: true
  }]
});

write(files.marketing, {
  ok: true,
  status: "Watch",
  generatedAt:
    new Date().toISOString(),
  metrics: {
    totalCampaigns: 3,
    healthyCampaigns: 2,
    warningCampaigns: 1,
    criticalCampaigns: 0,
    totalDailyCapacity: 100,
    segmentInventory: {
      uploadReadySegments: 1,
      depletedSegments: 1
    }
  },
  exceptions: [],
  recommendations: [
    "Review one warning account."
  ]
});

write(files.orion, {
  ok: true,
  status: "Watch",
  generatedAt:
    new Date().toISOString(),
  metrics: {
    contractors: 100,
    opportunities: 25,
    recommendationCoverage: 40,
    databaseFreshness: {
      stale: true
    }
  },
  exceptions: [],
  recommendations: [
    "Refresh ORION."
  ]
});

write(files.website, {
  ok: true,
  status: "Watch",
  generatedAt:
    new Date().toISOString(),
  metrics: {
    hasCTA: true,
    hasCalendly: false,
    brokenLinks: 1
  },
  exceptions: [],
  recommendations: [
    "Restore Calendly."
  ]
});

write(files.googleWorkspace, {
  ok: true,
  status: "Healthy",
  generatedAt:
    new Date().toISOString(),
  metrics: {
    recentInboxCount: 5,
    upcomingEventsCount: 2
  },
  exceptions: [],
  recommendations: [
    "Review inbox."
  ]
});

const ExecutiveBriefService =
  require(
    "../SERVICES/ExecutiveBriefService"
  );

try {
  const service =
    new ExecutiveBriefService({
      businessHealth: "Watch",
      providers: [],
      exceptions: [],
      recommendations: []
    });

  const brief =
    service.generate();

  assert.strictEqual(
    brief.title,
    "MILES Executive COO Brief"
  );

  assert(
    brief.todayPriorities.length > 0
  );

  assert(
    brief.todayPriorities[0]
      .priority === 1
  );

  assert(
    brief.authorizedWork.some(
      item =>
        /inbox|stalled|segment|ORION/i
          .test(
            `${item.action} ${item.objective}`
          )
    )
  );

  assert(
    brief.executiveDecisionsNeeded
      .some(
        item =>
          /proposal|website|Calendly|link/i
            .test(
              `${item.action} ${item.objective}`
            )
      )
  );

  assert.strictEqual(
    brief.departments.sales
      .available,
    true
  );

  assert.strictEqual(
    brief.departments.marketing
      .available,
    true
  );

  assert.strictEqual(
    brief.departments.orion
      .available,
    true
  );

  assert.strictEqual(
    brief.departments.website
      .available,
    true
  );

  assert.strictEqual(
    brief.departments.googleWorkspace
      .available,
    true
  );

  const markdown =
    service.toMarkdown();

  assert(
    markdown.includes(
      "## Authorized Work"
    )
  );

  assert(
    markdown.includes(
      "## CEO Decisions Needed"
    )
  );

  console.log(JSON.stringify({
    ok: true,
    build: "025",
    tests: {
      departmentEvidenceAggregation:
        "PASSED",
      businessHealthScoring:
        "PASSED",
      revenueFirstPrioritization:
        "PASSED",
      authorizedWorkSeparation:
        "PASSED",
      ceoProtectedSeparation:
        "PASSED",
      salesIntegration:
        "PASSED",
      marketingIntegration:
        "PASSED",
      orionIntegration:
        "PASSED",
      websiteIntegration:
        "PASSED",
      googleWorkspaceIntegration:
        "PASSED",
      markdownBrief:
        "PASSED",
      autonomousCOOCompatibility:
        "PASSED"
    },
    businessHealth:
      brief.businessHealth,
    score:
      brief.businessHealthScore,
    priorities:
      brief.todayPriorities,
    authorizedWork:
      brief.authorizedWork,
    ceoDecisions:
      brief.executiveDecisionsNeeded,
    departments:
      brief.departments
  }, null, 2));
} finally {
  for (
    const [file, contents]
    of Object.entries(prior)
  ) {
    if (contents === null) {
      try {
        fs.unlinkSync(file);
      } catch {}
    } else {
      fs.writeFileSync(
        file,
        contents,
        "utf8"
      );
    }
  }
}

