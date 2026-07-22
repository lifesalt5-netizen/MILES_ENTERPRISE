"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..", "..");

const DEFAULT_ALIAS_FILE =
  path.join(
    ROOT,
    "CONFIG",
    "marketing_segment_aliases.json"
  );

function safeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function round(value, decimals = 2) {
  const multiplier = 10 ** decimals;

  return Math.round(
    safeNumber(value) * multiplier
  ) / multiplier;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/&/g, " AND ")
    .replace(/[^A-Za-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compactName(value) {
  return normalizeName(value)
    .replace(/\s+/g, "");
}

function readJson(file) {
  const text = fs
    .readFileSync(file, "utf8")
    .replace(/^\uFEFF/, "");

  return JSON.parse(text);
}
function uniqueStrings(values = []) {
  return [
    ...new Set(
      values
        .filter(Boolean)
        .map(value => String(value).trim())
        .filter(Boolean)
    )
  ];
}

function uniqueObjects(values = [], keyFn) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const key = keyFn(value);

    if (!seen.has(key)) {
      seen.add(key);
      output.push(value);
    }
  }

  return output;
}

function campaignStatus(rawStatus) {
  const status = Number(rawStatus);

  if (status === 1) {
    return "ACTIVE";
  }

  if (status === 0) {
    return "DRAFT";
  }

  if (status === -1) {
    return "PAUSED";
  }

  if (status === -2) {
    return "COMPLETED_OR_STOPPED";
  }

  return "UNKNOWN";
}

function calculateHealth(input = {}) {
  const leads = safeNumber(input.leads);
  const contacted = safeNumber(input.contacted);
  const remaining = Math.max(0, leads - contacted);
  const bounced = safeNumber(input.bounced);
  const replies = safeNumber(input.replies);

  const bounceRate =
    contacted > 0
      ? round((bounced / contacted) * 100)
      : 0;

  const replyRate =
    contacted > 0
      ? round((replies / contacted) * 100)
      : 0;

  let health = "HEALTHY";

  if (leads <= 0) {
    health = "EMPTY";
  }
  else if (remaining <= 0) {
    health = "DEPLETED";
  }
  else if (bounceRate >= 5) {
    health = "CRITICAL_BOUNCE";
  }
  else if (bounceRate >= 3) {
    health = "WARNING_BOUNCE";
  }
  else if (remaining <= Math.max(50, leads * 0.1)) {
    health = "LOW_INVENTORY";
  }

  return {
    leads,
    contacted,
    remaining,
    bounced,
    replies,
    bounceRate,
    replyRate,
    health
  };
}

class MarketingStateReconciliationService {
  constructor(options = {}) {
    this.aliasFile =
      options.aliasFile ||
      DEFAULT_ALIAS_FILE;

    this.config =
      options.config ||
      readJson(this.aliasFile);

    this.aliases =
      this.buildAliasIndex(
        this.config.aliases || {}
      );

    this.priority =
      Array.isArray(this.config.priority)
        ? this.config.priority
        : [];
  }

  buildAliasIndex(aliases = {}) {
    const index = new Map();

    for (const [alias, canonical] of Object.entries(aliases)) {
      const normalized = normalizeName(alias);
      const compacted = compactName(alias);

      index.set(normalized, canonical);
      index.set(compacted, canonical);
    }

    return index;
  }

  canonicalizeSegmentName(value) {
    const normalized = normalizeName(value);
    const compacted = compactName(value);

    if (!normalized) {
      return {
        canonicalName: "UNKNOWN",
        matched: false,
        sourceName: value || null
      };
    }

    const direct =
      this.aliases.get(normalized) ||
      this.aliases.get(compacted);

    if (direct) {
      return {
        canonicalName: direct,
        matched: true,
        sourceName: value
      };
    }

    const normalizedCanonical =
      normalized
        .replace(/\+/g, " plus ")
        .replace(/\s+/g, "_")
        .toUpperCase();

    return {
      canonicalName: normalizedCanonical,
      matched: false,
      sourceName: value
    };
  }

  analyticsIndex(campaignAnalytics = []) {
    const index = new Map();

    for (const analytics of campaignAnalytics) {
      const id =
        analytics.campaign_id ||
        analytics.id ||
        null;

      const name =
        analytics.campaign_name ||
        analytics.name ||
        null;

      if (id) {
        index.set(
          `id:${String(id)}`,
          analytics
        );
      }

      if (name) {
        index.set(
          `name:${normalizeName(name)}`,
          analytics
        );
      }
    }

    return index;
  }

  findAnalytics(campaign, analyticsIndex) {
    const id =
      campaign.id ||
      campaign.campaign_id ||
      null;

    const name =
      campaign.name ||
      campaign.campaign_name ||
      null;

    if (id) {
      const byId =
        analyticsIndex.get(`id:${String(id)}`);

      if (byId) {
        return byId;
      }
    }

    if (name) {
      return (
        analyticsIndex.get(
          `name:${normalizeName(name)}`
        ) || null
      );
    }

    return null;
  }

  reconcileCampaign(campaign, analyticsIndex) {
    const analytics =
      this.findAnalytics(
        campaign,
        analyticsIndex
      ) || {};

    const sourceName =
      campaign.name ||
      campaign.campaign_name ||
      analytics.campaign_name ||
      "Unknown";

    const canonical =
      this.canonicalizeSegmentName(
        sourceName
      );

    const leads =
      safeNumber(
        analytics.leads_count ??
        campaign.leads_count ??
        campaign.leadCount
      );

    const contacted =
      safeNumber(
        analytics.contacted_count ??
        analytics.new_leads_contacted_count ??
        campaign.contacted_count ??
        campaign.contactedCount
      );

    const replies =
      safeNumber(
        analytics.reply_count_unique ??
        analytics.reply_count ??
        campaign.reply_count
      );

    const bounced =
      safeNumber(
        analytics.bounced_count ??
        campaign.bounced_count
      );

    const health =
      calculateHealth({
        leads,
        contacted,
        bounced,
        replies
      });

    return {
      campaignId:
        campaign.id ||
        campaign.campaign_id ||
        analytics.campaign_id ||
        null,

      campaignName: sourceName,

      canonicalSegment:
        canonical.canonicalName,

      canonicalMatch:
        canonical.matched,

      status:
        campaignStatus(
          campaign.rawStatus ??
          campaign.campaign_status ??
          analytics.campaign_status
        ),

      sendingAccounts:
        Array.isArray(campaign.sendingAccounts)
          ? campaign.sendingAccounts
          : [],

      protectedAssignments:
        Array.isArray(campaign.protectedAssignments)
          ? campaign.protectedAssignments
          : [],

      dailyLimit:
        safeNumber(
          campaign.dailyLimit ??
          campaign.daily_limit
        ),

      stopOnReply:
        campaign.stopOnReply ?? null,

      bounceProtectionEnabled:
        campaign.bounceProtectionEnabled ?? null,

      ...health,

      opportunityCount:
        safeNumber(
          analytics.total_opportunities
        ),

      opportunityValue:
        safeNumber(
          analytics.total_opportunity_value
        )
    };
  }

  reconcileSourceSegment(segment = {}) {
    const sourceName =
      segment.name ||
      segment.segmentName ||
      segment.segment ||
      "Unknown";

    const canonical =
      this.canonicalizeSegmentName(
        sourceName
      );

    const leadCount =
      safeNumber(
        segment.leadCount ??
        segment.totalLeads ??
        segment.rows
      );

    const verifiedEmailCount =
      safeNumber(
        segment.verifiedEmailCount ??
        segment.verifiedEmails ??
        segment.validEmails
      );

    return {
      sourceName,
      canonicalSegment:
        canonical.canonicalName,
      canonicalMatch:
        canonical.matched,
      leadCount,
      verifiedEmailCount,
      needsEnrichment:
        Boolean(segment.needsEnrichment),
      needsUpload:
        Boolean(segment.needsUpload),
      campaignStatus:
        segment.campaignStatus ||
        "UNKNOWN"
    };
  }

  mergeInventory(
    reconciledCampaigns = [],
    sourceSegments = []
  ) {
    const merged = new Map();

    function ensure(canonicalSegment) {
      if (!merged.has(canonicalSegment)) {
        merged.set(canonicalSegment, {
          canonicalSegment,
          campaignNames: [],
          campaignIds: [],
          campaignStatuses: [],
          sourceNames: [],
          sendingAccounts: [],
          protectedAssignments: [],
          campaignLeads: 0,
          contacted: 0,
          remainingInCampaigns: 0,
          bounced: 0,
          replies: 0,
          sourceLeadCount: 0,
          verifiedEmailCount: 0,
          opportunityCount: 0,
          opportunityValue: 0,
          needsEnrichment: false,
          needsUpload: false
        });
      }

      return merged.get(canonicalSegment);
    }

    for (const campaign of reconciledCampaigns) {
      const record =
        ensure(campaign.canonicalSegment);

      record.campaignNames.push(
        campaign.campaignName
      );

      if (campaign.campaignId) {
        record.campaignIds.push(
          campaign.campaignId
        );
      }

      record.campaignStatuses.push(
        campaign.status
      );

      record.sendingAccounts.push(
        ...campaign.sendingAccounts
      );

      record.protectedAssignments.push(
        ...campaign.protectedAssignments
      );

      record.campaignLeads +=
        campaign.leads;

      record.contacted +=
        campaign.contacted;

      record.remainingInCampaigns +=
        campaign.remaining;

      record.bounced +=
        campaign.bounced;

      record.replies +=
        campaign.replies;

      record.opportunityCount +=
        campaign.opportunityCount;

      record.opportunityValue +=
        campaign.opportunityValue;
    }

    for (const segment of sourceSegments) {
      const record =
        ensure(segment.canonicalSegment);

      record.sourceNames.push(
        segment.sourceName
      );

      record.sourceLeadCount +=
        segment.leadCount;

      record.verifiedEmailCount +=
        segment.verifiedEmailCount;

      record.needsEnrichment =
        record.needsEnrichment ||
        segment.needsEnrichment;

      record.needsUpload =
        record.needsUpload ||
        segment.needsUpload;
    }

    return [...merged.values()]
      .map(record => {
        const bounceRate =
          record.contacted > 0
            ? round(
                (record.bounced /
                  record.contacted) * 100
              )
            : 0;

        const replyRate =
          record.contacted > 0
            ? round(
                (record.replies /
                  record.contacted) * 100
              )
            : 0;

        const unallocatedVerified =
          Math.max(
            0,
            record.verifiedEmailCount -
            record.campaignLeads
          );

        const hasActiveCampaign =
          record.campaignStatuses
            .includes("ACTIVE");

        const hasDraftCampaign =
          record.campaignStatuses
            .includes("DRAFT");

        let readiness =
          "NO_ACTION";

        if (
          record.protectedAssignments.length > 0
        ) {
          readiness =
            "PROTECTED_ASSIGNMENT_BLOCK";
        }
        else if (
          record.campaignLeads === 0 &&
          record.verifiedEmailCount > 0 &&
          hasDraftCampaign
        ) {
          readiness =
            "UPLOAD_READY";
        }
        else if (
          record.remainingInCampaigns === 0 &&
          unallocatedVerified > 0
        ) {
          readiness =
            "REPLENISH_READY";
        }
        else if (
          record.remainingInCampaigns <= 100 &&
          unallocatedVerified > 0
        ) {
          readiness =
            "REPLENISH_SOON";
        }
        else if (
          record.verifiedEmailCount === 0 &&
          record.remainingInCampaigns === 0
        ) {
          readiness =
            "SOURCE_INVENTORY_REQUIRED";
        }
        else if (hasActiveCampaign) {
          readiness =
            "MONITOR_ACTIVE";
        }
        else if (
          hasDraftCampaign &&
          record.campaignLeads > 0
        ) {
          readiness =
            "DRAFT_REVIEW_REQUIRED";
        }

        return {
          ...record,
          campaignNames:
            uniqueStrings(record.campaignNames),
          campaignIds:
            uniqueStrings(record.campaignIds),
          campaignStatuses:
            uniqueStrings(record.campaignStatuses),
          sourceNames:
            uniqueStrings(record.sourceNames),
          sendingAccounts:
            uniqueStrings(record.sendingAccounts),
          protectedAssignments:
            uniqueStrings(
              record.protectedAssignments
            ),
          bounceRate,
          replyRate,
          unallocatedVerified,
          hasActiveCampaign,
          hasDraftCampaign,
          readiness
        };
      })
      .sort((a, b) => {
        const aPriority =
          this.priority.indexOf(
            a.canonicalSegment
          );

        const bPriority =
          this.priority.indexOf(
            b.canonicalSegment
          );

        const aRank =
          aPriority === -1
            ? Number.MAX_SAFE_INTEGER
            : aPriority;

        const bRank =
          bPriority === -1
            ? Number.MAX_SAFE_INTEGER
            : bPriority;

        return (
          aRank - bRank ||
          a.canonicalSegment.localeCompare(
            b.canonicalSegment
          )
        );
      });
  }

  buildExceptions(inventory = []) {
    const exceptions = [];

    for (const segment of inventory) {
      if (
        segment.protectedAssignments.length > 0
      ) {
        exceptions.push({
          type:
            "ProtectedAssignmentViolation",
          severity:
            "Critical",
          canonicalSegment:
            segment.canonicalSegment,
          message:
            `${segment.canonicalSegment} contains protected inbox or domain assignments.`
        });
      }

      if (segment.bounceRate >= 5) {
        exceptions.push({
          type:
            "HighBounceRate",
          severity:
            "Critical",
          canonicalSegment:
            segment.canonicalSegment,
          message:
            `${segment.canonicalSegment} bounce rate is ${segment.bounceRate}%.`
        });
      }
      else if (segment.bounceRate >= 3) {
        exceptions.push({
          type:
            "BounceRateWarning",
          severity:
            "Warning",
          canonicalSegment:
            segment.canonicalSegment,
          message:
            `${segment.canonicalSegment} bounce rate is ${segment.bounceRate}%.`
        });
      }

      if (
        segment.readiness ===
        "SOURCE_INVENTORY_REQUIRED"
      ) {
        exceptions.push({
          type:
            "SegmentInventoryUnavailable",
          severity:
            "Info",
          canonicalSegment:
            segment.canonicalSegment,
          message:
            `${segment.canonicalSegment} has no remaining campaign inventory and no verified source inventory.`
        });
      }
    }

    return uniqueObjects(
      exceptions,
      exception =>
        [
          exception.type,
          exception.canonicalSegment,
          exception.message
        ].join("|")
    );
  }

  buildRecommendations(inventory = []) {
    const recommendations = [];

    for (const segment of inventory) {
      switch (segment.readiness) {
        case "UPLOAD_READY":
          recommendations.push(
            `Prepare ${segment.verifiedEmailCount} verified ${segment.canonicalSegment} contacts for controlled upload.`
          );
          break;

        case "REPLENISH_READY":
          recommendations.push(
            `Replenish ${segment.canonicalSegment}; ${segment.unallocatedVerified} verified contacts are available outside current campaigns.`
          );
          break;

        case "REPLENISH_SOON":
          recommendations.push(
            `${segment.canonicalSegment} has only ${segment.remainingInCampaigns} campaign contacts remaining; prepare the next verified batch.`
          );
          break;

        case "SOURCE_INVENTORY_REQUIRED":
          recommendations.push(
            `Locate, validate, or enrich source inventory for ${segment.canonicalSegment}.`
          );
          break;

        case "MONITOR_ACTIVE":
          recommendations.push(
            `Monitor active ${segment.canonicalSegment} campaign: ${segment.remainingInCampaigns} contacts remain, ${segment.replyRate}% reply rate, ${segment.bounceRate}% bounce rate.`
          );
          break;

        case "DRAFT_REVIEW_REQUIRED":
          recommendations.push(
            `Review draft ${segment.canonicalSegment} campaign for sequence, schedule, inbox assignment, and approval readiness.`
          );
          break;

        case "PROTECTED_ASSIGNMENT_BLOCK":
          recommendations.push(
            `Remove protected assignments from ${segment.canonicalSegment} before any campaign action.`
          );
          break;

        default:
          break;
      }
    }

    return uniqueStrings(recommendations);
  }

  reconcile(input = {}) {
    const campaigns =
      Array.isArray(input.campaigns)
        ? input.campaigns
        : [];

    const campaignAnalytics =
      Array.isArray(input.campaignAnalytics)
        ? input.campaignAnalytics
        : [];

    const sourceSegments =
      Array.isArray(input.sourceSegments)
        ? input.sourceSegments
        : [];

    const analyticsIndex =
      this.analyticsIndex(
        campaignAnalytics
      );

    const reconciledCampaigns =
      campaigns.map(campaign =>
        this.reconcileCampaign(
          campaign,
          analyticsIndex
        )
      );

    const reconciledSourceSegments =
      sourceSegments.map(segment =>
        this.reconcileSourceSegment(
          segment
        )
      );

    const inventory =
      this.mergeInventory(
        reconciledCampaigns,
        reconciledSourceSegments
      );

    const exceptions =
      this.buildExceptions(inventory);

    const recommendations =
      this.buildRecommendations(inventory);

    const knownSegments =
      inventory.filter(
        segment =>
          segment.canonicalSegment !==
          "UNKNOWN"
      );

    const unknownSegments =
      inventory.filter(
        segment =>
          segment.canonicalSegment ===
          "UNKNOWN"
      );

    return {
      ok: true,
      type:
        "MARKETING_STATE_RECONCILIATION_RESULT",
      generatedAt:
        new Date().toISOString(),
      readOnly: true,
      summary: {
        campaignsProcessed:
          reconciledCampaigns.length,
        sourceSegmentsProcessed:
          reconciledSourceSegments.length,
        canonicalSegments:
          knownSegments.length,
        unknownSegments:
          unknownSegments.length,
        totalCampaignLeads:
          inventory.reduce(
            (sum, segment) =>
              sum +
              segment.campaignLeads,
            0
          ),
        totalContacted:
          inventory.reduce(
            (sum, segment) =>
              sum +
              segment.contacted,
            0
          ),
        totalRemainingInCampaigns:
          inventory.reduce(
            (sum, segment) =>
              sum +
              segment.remainingInCampaigns,
            0
          ),
        totalVerifiedSourceInventory:
          inventory.reduce(
            (sum, segment) =>
              sum +
              segment.verifiedEmailCount,
            0
          ),
        uploadReadySegments:
          inventory.filter(
            segment =>
              segment.readiness ===
              "UPLOAD_READY"
          ).length,
        replenishReadySegments:
          inventory.filter(
            segment =>
              segment.readiness ===
              "REPLENISH_READY" ||
              segment.readiness ===
              "REPLENISH_SOON"
          ).length,
        activeSegments:
          inventory.filter(
            segment =>
              segment.hasActiveCampaign
          ).length,
        exceptionCount:
          exceptions.length,
        recommendationCount:
          recommendations.length
      },
      inventory,
      campaigns:
        reconciledCampaigns,
      sourceSegments:
        reconciledSourceSegments,
      exceptions,
      recommendations
    };
  }
}

module.exports =
  new MarketingStateReconciliationService();

module.exports.MarketingStateReconciliationService =
  MarketingStateReconciliationService;

module.exports.normalizeName =
  normalizeName;

module.exports.calculateHealth =
  calculateHealth;
