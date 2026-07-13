"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  process.cwd();

const EVIDENCE_FILES = Object.freeze({
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
});

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch {
    return fallback;
  }
}

function statusScore(status) {
  const value =
    String(status || "Unknown")
      .trim()
      .toLowerCase();

  if (
    ["healthy", "operational", "running", "ready"]
      .includes(value)
  ) {
    return 100;
  }

  if (
    ["watch", "warning", "partial", "degraded"]
      .includes(value)
  ) {
    return 70;
  }

  if (
    ["critical", "failed", "down", "unavailable"]
      .includes(value)
  ) {
    return 20;
  }

  return 50;
}

function normalizeSeverity(value) {
  const severity =
    String(value || "Info")
      .trim()
      .toLowerCase();

  if (severity === "critical") return "Critical";
  if (severity === "warning") return "Warning";
  return "Info";
}

function flattenRecommendations(value) {
  if (!Array.isArray(value)) return [];

  return value.map(item => {
    if (typeof item === "string") {
      return {
        text: item,
        protected: false,
        raw: item
      };
    }

    const action =
      item.action ||
      item.title ||
      item.recommendation ||
      item.message ||
      "Review recommendation";

    return {
      text: String(action),
      protected: Boolean(
        item.protected ||
        item.requiresCEOApproval ||
        item.requiresKevin ||
        item.submissionProtected
      ),
      raw: item
    };
  });
}

function latestGeneratedAt(record) {
  return (
    record?.generatedAt ||
    record?.verifiedAt ||
    record?.completedAt ||
    null
  );
}

function ageHours(timestamp) {
  if (!timestamp) return null;

  const value =
    new Date(timestamp).getTime();

  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round(
    (
      Date.now() - value
    ) / 3600000 * 100
  ) / 100;
}

class ExecutiveBriefService {
  constructor(
    executiveState,
    options = {}
  ) {
    if (!executiveState) {
      throw new Error(
        "ExecutiveBriefService requires executiveState."
      );
    }

    this.state =
      executiveState;

    this.rootDir =
      options.rootDir ||
      ROOT;

    this.evidenceFiles = {
      ...EVIDENCE_FILES,
      ...(options.evidenceFiles || {})
    };
  }

  loadDepartmentEvidence() {
    const evidence = {};

    for (
      const [department, file]
      of Object.entries(
        this.evidenceFiles
      )
    ) {
      const record =
        readJson(file, null);

      evidence[department] = {
        department,
        available:
          Boolean(record),
        file,
        generatedAt:
          latestGeneratedAt(record),
        ageHours:
          ageHours(
            latestGeneratedAt(record)
          ),
        status:
          record?.status ||
          (
            record?.ok === true
              ? "Healthy"
              : record?.ok === false
                ? "Critical"
                : "Unknown"
          ),
        metrics:
          record?.metrics || {},
        exceptions:
          Array.isArray(
            record?.exceptions
          )
            ? record.exceptions
            : [],
        recommendations:
          flattenRecommendations(
            record?.recommendations
          ),
        safety:
          record?.safety || {},
        raw:
          record
      };
    }

    return evidence;
  }

  generate() {
    const departments =
      this.loadDepartmentEvidence();

    const operatingPlan =
      this.buildOperatingPlan(
        departments
      );

    const businessHealth =
      this.calculateBusinessHealth(
        departments
      );

    return {
      generatedAt:
        new Date().toISOString(),
      title:
        "MILES Executive COO Brief",
      businessHealth:
        businessHealth.status,
      businessHealthScore:
        businessHealth.score,
      executiveSummary:
        this.buildExecutiveSummary(
          departments,
          businessHealth,
          operatingPlan
        ),
      todayPriorities:
        operatingPlan.priorities,
      operatingPlan,
      departments:
        this.buildDepartmentSummary(
          departments
        ),
      revenueAndMarketing:
        this.buildMarketingSummary(
          departments
        ),
      sales:
        this.buildSalesSummary(
          departments
        ),
      orion:
        this.buildOrionSummary(
          departments
        ),
      website:
        this.buildWebsiteSummary(
          departments
        ),
      googleWorkspace:
        this.buildGoogleSummary(
          departments
        ),
      exceptions:
        this.buildExceptions(
          departments
        ),
      recommendations:
        this.buildRecommendations(
          departments
        ),
      executiveDecisionsNeeded:
        operatingPlan.ceoProtected,
      authorizedWork:
        operatingPlan.authorizedNow
    };
  }

  calculateBusinessHealth(
    departments
  ) {
    const records =
      Object.values(departments);

    if (records.length === 0) {
      return {
        score: 0,
        status: "Unknown"
      };
    }

    const score =
      Math.round(
        records.reduce(
          (sum, item) =>
            sum +
            statusScore(item.status),
          0
        ) / records.length
      );

    return {
      score,
      status:
        score >= 90
          ? "Healthy"
          : score >= 65
            ? "Watch"
            : "Critical"
    };
  }

  buildExecutiveSummary(
    departments,
    businessHealth,
    operatingPlan
  ) {
    const available =
      Object.values(departments)
        .filter(
          item =>
            item.available
        ).length;

    const total =
      Object.keys(departments)
        .length;

    return {
      overallStatus:
        businessHealth.status,
      score:
        businessHealth.score,
      providerCoverage:
        `${available}/${total} department evidence sources available`,
      criticalDepartments:
        Object.values(departments)
          .filter(
            item =>
              statusScore(
                item.status
              ) < 40
          ).length,
      authorizedActions:
        operatingPlan.authorizedNow.length,
      ceoDecisions:
        operatingPlan.ceoProtected.length,
      summary: [
        `Business health is ${businessHealth.status} with a score of ${businessHealth.score}.`,
        `${available} of ${total} department evidence sources are available.`,
        `${operatingPlan.authorizedNow.length} action(s) can proceed without CEO approval.`,
        `${operatingPlan.ceoProtected.length} decision(s) require CEO review.`
      ]
    };
  }

  buildOperatingPlan(
    departments
  ) {
    const priorities = [];

    this.addSalesPriorities(
      priorities,
      departments.sales
    );

    this.addMarketingPriorities(
      priorities,
      departments.marketing
    );

    this.addGooglePriorities(
      priorities,
      departments.googleWorkspace
    );

    this.addOrionPriorities(
      priorities,
      departments.orion
    );

    this.addWebsitePriorities(
      priorities,
      departments.website
    );

    for (
      const department
      of Object.values(departments)
    ) {
      for (
        const exception
        of department.exceptions
      ) {
        const severity =
          normalizeSeverity(
            exception.severity
          );

        if (
          severity === "Critical"
        ) {
          priorities.push({
            priority: 1,
            area:
              department.department,
            action:
              `Investigate critical ${department.department} exception: ${exception.message}`,
            objective:
              `Evaluate and repair critical ${department.department} operating issue: ${exception.message}`,
            impact:
              "Protects business continuity and revenue operations.",
            owner: "MILES",
            requiresKevin: false,
            source:
              department.file
          });
        }
      }
    }

    priorities.sort((a, b) => {
      if (
        a.priority !== b.priority
      ) {
        return (
          a.priority -
          b.priority
        );
      }

      return (
        String(a.area)
          .localeCompare(
            String(b.area)
          )
      );
    });

    const deduped = [];
    const seen = new Set();

    for (const item of priorities) {
      const key =
        `${item.area}|${item.action}`
          .toLowerCase();

      if (seen.has(key)) continue;

      seen.add(key);
      deduped.push(item);
    }

    if (deduped.length === 0) {
      deduped.push({
        priority: 3,
        area: "Executive",
        action:
          "Continue monitoring all operational departments.",
        objective:
          "Review department evidence and maintain operational readiness",
        impact:
          "Maintains business visibility and operating continuity.",
        owner: "MILES",
        requiresKevin: false,
        source: null
      });
    }

    const authorizedNow =
      deduped.filter(
        item =>
          item.requiresKevin !== true
      );

    const ceoProtected =
      deduped.filter(
        item =>
          item.requiresKevin === true
      );

    return {
      generatedAt:
        new Date().toISOString(),
      priorities:
        deduped.slice(0, 20),
      authorizedNow,
      ceoProtected,
      counts: {
        total:
          deduped.length,
        authorized:
          authorizedNow.length,
        protected:
          ceoProtected.length,
        priorityOne:
          deduped.filter(
            item =>
              item.priority === 1
          ).length
      }
    };
  }

  addSalesPriorities(
    priorities,
    sales
  ) {
    if (!sales?.available) return;

    const metrics =
      sales.metrics || {};

    if (
      Number(
        metrics.repliesProcessed ||
        0
      ) > 0
    ) {
      priorities.push({
        priority: 1,
        area: "Sales",
        action:
          `Review ${metrics.repliesProcessed} classified inbound reply record(s).`,
        objective:
          "Review classified inbound replies and create approved follow-up work",
        impact:
          "Protects response speed and revenue conversion.",
        owner:
          "Sales COO",
        requiresKevin:
          Number(
            metrics.protectedActions ||
            0
          ) > 0,
        source:
          sales.file
      });
    }

    if (
      Number(
        metrics.critical ||
        0
      ) > 0
    ) {
      priorities.push({
        priority: 1,
        area: "Sales",
        action:
          `Prepare ${metrics.critical} critical proposal deadline action(s).`,
        objective:
          "Review critical proposal deadlines and prepare submission-readiness evidence",
        impact:
          "Prevents missed proposal deadlines.",
        owner:
          "Sales COO",
        requiresKevin: true,
        source:
          sales.file
      });
    }

    if (
      Number(
        metrics.stalledDeals ||
        0
      ) > 0
    ) {
      priorities.push({
        priority: 1,
        area: "Sales",
        action:
          `Create next-action recommendations for ${metrics.stalledDeals} stalled deal(s).`,
        objective:
          "Review stalled sales opportunities and create follow-up recommendations",
        impact:
          "Improves pipeline velocity and close probability.",
        owner:
          "Sales COO",
        requiresKevin: false,
        source:
          sales.file
      });
    }
  }

  addMarketingPriorities(
    priorities,
    marketing
  ) {
    if (!marketing?.available) return;

    const metrics =
      marketing.metrics || {};

    if (
      Number(
        metrics.criticalAccounts ||
        0
      ) > 0 ||
      Number(
        metrics.criticalCampaigns ||
        0
      ) > 0
    ) {
      priorities.push({
        priority: 1,
        area: "Marketing",
        action:
          "Investigate critical Instantly account or campaign health.",
        objective:
          "Audit Instantly critical account and campaign health and prepare safe remediation",
        impact:
          "Protects sender reputation and outbound revenue.",
        owner:
          "Marketing COO",
        requiresKevin: false,
        source:
          marketing.file
      });
    }

    if (
      Number(
        metrics.segmentInventory
          ?.uploadReadySegments ||
        0
      ) > 0
    ) {
      priorities.push({
        priority: 2,
        area: "Marketing",
        action:
          `Prepare verified lead uploads for ${metrics.segmentInventory.uploadReadySegments} campaign-ready segment(s).`,
        objective:
          "Review campaign-ready verified segments and prepare governed lead upload work",
        impact:
          "Expands safe outbound coverage.",
        owner:
          "Marketing COO",
        requiresKevin: false,
        source:
          marketing.file
      });
    }

    if (
      Number(
        metrics.segmentInventory
          ?.depletedSegments ||
        0
      ) > 0
    ) {
      priorities.push({
        priority: 2,
        area: "Marketing",
        action:
          `Replenish ${metrics.segmentInventory.depletedSegments} depleted segment(s).`,
        objective:
          "Identify depleted outreach segments and create enrichment work",
        impact:
          "Prevents campaign inventory exhaustion.",
        owner:
          "Marketing COO",
        requiresKevin: false,
        source:
          marketing.file
      });
    }
  }

  addGooglePriorities(
    priorities,
    google
  ) {
    if (!google?.available) return;

    const metrics =
      google.metrics || {};

    if (
      Number(
        metrics.recentInboxCount ||
        0
      ) > 0
    ) {
      priorities.push({
        priority: 1,
        area:
          "Google Workspace",
        action:
          `Review ${metrics.recentInboxCount} recent inbox message(s).`,
        objective:
          "Review Gmail inbox and triage recent email",
        impact:
          "Protects prospect, client, proposal, and operational response times.",
        owner:
          "Google Workspace COO",
        requiresKevin: false,
        source:
          google.file
      });
    }

    if (
      Number(
        metrics.upcomingEventsCount ||
        0
      ) > 0
    ) {
      priorities.push({
        priority: 2,
        area:
          "Google Workspace",
        action:
          `Prepare for ${metrics.upcomingEventsCount} upcoming calendar event(s).`,
        objective:
          "Review upcoming calendar meetings and prepare operating briefs",
        impact:
          "Improves meeting readiness.",
        owner:
          "Google Workspace COO",
        requiresKevin: false,
        source:
          google.file
      });
    }
  }

  addOrionPriorities(
    priorities,
    orion
  ) {
    if (!orion?.available) return;

    const metrics =
      orion.metrics || {};

    if (
      metrics.databaseFreshness
        ?.stale === true
    ) {
      priorities.push({
        priority: 2,
        area: "ORION",
        action:
          "Prepare an authorized ORION data refresh.",
        objective:
          "Refresh ORION data and verify contractor and opportunity intelligence",
        impact:
          "Keeps targeting and revenue decisions current.",
        owner:
          "ORION COO",
        requiresKevin: false,
        source:
          orion.file
      });
    }

    if (
      Number(
        metrics.recommendationCoverage ||
        0
      ) < 50 &&
      Number(
        metrics.contractors ||
        0
      ) > 0
    ) {
      priorities.push({
        priority: 2,
        area: "ORION",
        action:
          "Prepare recommendation regeneration for uncovered contractors.",
        objective:
          "Review ORION recommendation coverage and create regeneration work",
        impact:
          "Improves contractor intelligence and sales targeting.",
        owner:
          "ORION COO",
        requiresKevin: false,
        source:
          orion.file
      });
    }
  }

  addWebsitePriorities(
    priorities,
    website
  ) {
    if (!website?.available) return;

    const metrics =
      website.metrics || {};

    if (
      Number(
        metrics.brokenLinks ||
        0
      ) > 0
    ) {
      priorities.push({
        priority: 2,
        area: "Website",
        action:
          `Prepare repairs for ${metrics.brokenLinks} broken internal link(s).`,
        objective:
          "Review website broken links and prepare an approved repair plan",
        impact:
          "Protects conversion paths and credibility.",
        owner:
          "Website COO",
        requiresKevin: true,
        source:
          website.file
      });
    }

    if (
      metrics.hasCTA === false ||
      metrics.hasCalendly === false
    ) {
      priorities.push({
        priority: 1,
        area: "Website",
        action:
          "Restore or verify primary scheduling conversion paths.",
        objective:
          "Review website CTA and Calendly availability and prepare an approved repair plan",
        impact:
          "Protects lead conversion and call bookings.",
        owner:
          "Website COO",
        requiresKevin: true,
        source:
          website.file
      });
    }
  }

  buildDepartmentSummary(
    departments
  ) {
    return Object.fromEntries(
      Object.entries(
        departments
      ).map(
        ([key, item]) => [
          key,
          {
            available:
              item.available,
            status:
              item.status,
            generatedAt:
              item.generatedAt,
            ageHours:
              item.ageHours,
            exceptionCount:
              item.exceptions.length,
            recommendationCount:
              item.recommendations.length,
            metrics:
              item.metrics
          }
        ]
      )
    );
  }

  buildSalesSummary(
    departments
  ) {
    const sales =
      departments.sales;

    return {
      status:
        sales.status,
      metrics:
        sales.metrics,
      available:
        sales.available
    };
  }

  buildMarketingSummary(
    departments
  ) {
    const marketing =
      departments.marketing;

    const metrics =
      marketing.metrics || {};

    return {
      status:
        marketing.status,
      totalCampaigns:
        metrics.totalCampaigns || 0,
      healthyCampaigns:
        metrics.healthyCampaigns || 0,
      warningCampaigns:
        metrics.warningCampaigns || 0,
      criticalCampaigns:
        metrics.criticalCampaigns || 0,
      totalDailyCapacity:
        metrics.totalDailyCapacity || 0,
      segmentInventory:
        metrics.segmentInventory || {}
    };
  }

  buildOrionSummary(
    departments
  ) {
    const orion =
      departments.orion;

    return {
      status:
        orion.status,
      ...(orion.metrics || {})
    };
  }

  buildWebsiteSummary(
    departments
  ) {
    const website =
      departments.website;

    return {
      status:
        website.status,
      ...(website.metrics || {})
    };
  }

  buildGoogleSummary(
    departments
  ) {
    const google =
      departments.googleWorkspace;

    return {
      status:
        google.status,
      ...(google.metrics || {})
    };
  }

  buildExceptions(
    departments
  ) {
    const exceptions = [];

    for (
      const department
      of Object.values(departments)
    ) {
      for (
        const exception
        of department.exceptions
      ) {
        exceptions.push({
          department:
            department.department,
          severity:
            normalizeSeverity(
              exception.severity
            ),
          type:
            exception.type ||
            "OperationalException",
          message:
            exception.message ||
            String(exception)
        });
      }
    }

    if (
      exceptions.length === 0
    ) {
      return [{
        severity: "Info",
        message:
          "No executive exceptions detected."
      }];
    }

    return exceptions;
  }

  buildRecommendations(
    departments
  ) {
    const recommendations = [];

    for (
      const department
      of Object.values(departments)
    ) {
      for (
        const recommendation
        of department.recommendations
      ) {
        recommendations.push(
          `${department.department}: ${recommendation.text}`
        );
      }
    }

    if (
      recommendations.length === 0
    ) {
      return [
        "No immediate executive recommendations."
      ];
    }

    return recommendations;
  }

  toMarkdown() {
    const brief =
      this.generate();

    const lines = [];

    lines.push(
      `# ${brief.title}`
    );

    lines.push("");
    lines.push(
      `Generated: ${brief.generatedAt}`
    );

    lines.push("");
    lines.push(
      "## Business Health"
    );

    lines.push("");
    lines.push(
      `**${brief.businessHealth} â€” ${brief.businessHealthScore}/100**`
    );

    lines.push("");
    lines.push(
      "## Executive Summary"
    );

    lines.push("");

    for (
      const item
      of brief.executiveSummary.summary
    ) {
      lines.push(`- ${item}`);
    }

    lines.push("");
    lines.push(
      "## Today's Priorities"
    );

    lines.push("");

    for (
      const item
      of brief.todayPriorities
    ) {
      lines.push(
        `- P${item.priority} â€” ${item.area}: ${item.action}`
      );
    }

    lines.push("");
    lines.push(
      "## Authorized Work"
    );

    lines.push("");

    if (
      brief.authorizedWork.length === 0
    ) {
      lines.push(
        "- No autonomous work is currently required."
      );
    } else {
      for (
        const item
        of brief.authorizedWork
      ) {
        lines.push(
          `- ${item.area}: ${item.objective}`
        );
      }
    }

    lines.push("");
    lines.push(
      "## CEO Decisions Needed"
    );

    lines.push("");

    if (
      brief.executiveDecisionsNeeded
        .length === 0
    ) {
      lines.push(
        "- No CEO-level decisions required."
      );
    } else {
      for (
        const decision
        of brief.executiveDecisionsNeeded
      ) {
        lines.push(
          `- ${decision.area}: ${decision.action}`
        );
      }
    }

    lines.push("");
    lines.push(
      "## Department Status"
    );

    lines.push("");

    for (
      const [name, department]
      of Object.entries(
        brief.departments
      )
    ) {
      lines.push(
        `- ${name}: ${department.status} (${department.available ? "evidence available" : "no evidence"})`
      );
    }

    lines.push("");
    lines.push(
      "## Exceptions"
    );

    lines.push("");

    for (
      const exception
      of brief.exceptions
    ) {
      lines.push(
        `- ${exception.severity}: ${exception.message}`
      );
    }

    lines.push("");
    lines.push(
      "## Recommendations"
    );

    lines.push("");

    for (
      const recommendation
      of brief.recommendations
    ) {
      lines.push(
        `- ${recommendation}`
      );
    }

    return lines.join("\n");
  }
}

module.exports =
  ExecutiveBriefService;

