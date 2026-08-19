"use strict";

/*
  MILES Enterprise
  Business Work Planner

  Contract:
  - Read-only CEO reviews return recommendations and queue NO external work.
  - Execution missions emit only concrete work packages backed by canonical
    connector contracts. Conceptual departments such as "Revenue" are never
    used as connector identities.
  - Generic business planning never infers protected writes. Those remain
    explicit governed actions handled by their dedicated command paths.
*/

const SAFE_INSTANTLY_READ_ACTIONS = Object.freeze([
  "listCampaigns",
  "listAccounts",
  "getCampaignAnalyticsOverview"
]);

function normalizeObjective(task = {}) {
  return String(
    task.objective ||
    task.payload?.objective ||
    task.payload?.command ||
    task.command ||
    ""
  ).trim();
}

function isReadOnlyReview(objective = "") {
  const text = String(objective || "");

  return (
    /\bread[\s-]?only\b/i.test(text) ||
    /\bdo\s+not\s+(?:send|modify|change|publish|launch|activate|pause|delete|create|update|write)\b/i.test(text) ||
    /\bdon['’]t\s+(?:send|modify|change|publish|launch|activate|pause|delete|create|update|write)\b/i.test(text) ||
    /\bwithout\s+(?:sending|modifying|changing|publishing|launching|activating|pausing|deleting|creating|updating|writing)\b/i.test(text)
  );
}

function recommendations() {
  return [
    {
      priority: 1,
      area: "Outbound Operations",
      title: "Verify campaign coverage against the highest-priority revenue segments",
      reason: "Revenue execution should start with the segments most likely to produce qualified meetings and near-term pipeline."
    },
    {
      priority: 2,
      area: "Sending Infrastructure",
      title: "Validate sending-account capacity and deliverability before expanding volume",
      reason: "Mailbox capacity and health determine whether outbound can scale without creating avoidable delivery risk."
    },
    {
      priority: 3,
      area: "Revenue Conversion",
      title: "Review campaign analytics and prioritize the motions producing replies, meetings, and qualified opportunities",
      reason: "MILES should concentrate effort on measurable revenue conversion rather than raw send volume."
    }
  ];
}

function executableReadPackages() {
  return [
    {
      priority: 1,
      taskType: "REFRESH_CAMPAIGN_INVENTORY",
      department: "Revenue",
      provider: "INSTANTLY",
      connector: "INSTANTLY",
      system: "INSTANTLY",
      action: "listCampaigns",
      capability: "READ_CAMPAIGNS",
      readOnly: true,
      requiresKevin: false,
      description: "Refresh live Instantly campaign inventory."
    },
    {
      priority: 2,
      taskType: "REFRESH_SENDING_ACCOUNT_INVENTORY",
      department: "Revenue",
      provider: "INSTANTLY",
      connector: "INSTANTLY",
      system: "INSTANTLY",
      action: "listAccounts",
      capability: "READ_SENDING_ACCOUNTS",
      readOnly: true,
      requiresKevin: false,
      description: "Refresh live Instantly sending-account inventory."
    },
    {
      priority: 3,
      taskType: "REFRESH_CAMPAIGN_ANALYTICS",
      department: "Revenue",
      provider: "INSTANTLY",
      connector: "INSTANTLY",
      system: "INSTANTLY",
      action: "getCampaignAnalyticsOverview",
      capability: "READ_CAMPAIGN_ANALYTICS",
      readOnly: true,
      requiresKevin: false,
      description: "Refresh aggregate Instantly campaign analytics for executive prioritization."
    }
  ];
}

class BusinessWorkPlannerService {
  async plan(task = {}) {
    const objective = normalizeObjective(task);
    const readOnly = isReadOnlyReview(objective);
    const recommendedActions = recommendations();
    const workPackages = readOnly
      ? []
      : executableReadPackages();

    return {
      ok: true,
      service: "BusinessWorkPlannerService",
      mode: readOnly ? "READ_ONLY_REVIEW" : "EXECUTION",
      readOnly,
      objective,
      generatedAt: new Date().toISOString(),
      recommendationCount: recommendedActions.length,
      recommendations: recommendedActions,
      workPackageCount: workPackages.length,
      workPackages,
      connectorContract: {
        canonicalConnectors: ["INSTANTLY"],
        safeInstantlyReadActions: [...SAFE_INSTANTLY_READ_ACTIONS],
        pseudoConnectorsForbidden: ["Revenue"],
        protectedWritesInferred: false
      }
    };
  }
}

module.exports = new BusinessWorkPlannerService();
module.exports.BusinessWorkPlannerService = BusinessWorkPlannerService;
module.exports.SAFE_INSTANTLY_READ_ACTIONS = SAFE_INSTANTLY_READ_ACTIONS;
module.exports.isReadOnlyReview = isReadOnlyReview;
