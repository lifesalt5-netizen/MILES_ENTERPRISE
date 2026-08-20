"use strict";

/*
  MILES Enterprise
  Business Work Planner

  Contract:
  - Read-only CEO reviews return recommendations and queue NO external work.
  - Execution missions emit only concrete work packages backed by canonical
    connector contracts. Conceptual departments such as "Revenue" are never
    used as connector identities.
  - Capture-capacity / CURRENTLY_LOOKING_FOR_HELP missions use the existing
    governed MILES capture-capacity execution lane; they do not infer live
    campaign activation.
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

function isCaptureRevenueMission(objective = "") {
  const text = String(objective || "").toLowerCase();
  const directSignals = [
    "currently_looking_for_help",
    "currently looking for help",
    "capture capacity",
    "capture hiring",
    "proposal manager",
    "capture manager",
    "capture director",
    "outbound to meeting",
    "qualified meeting",
    "discover prospects",
    "prospect discovery",
    "hcrc"
  ];
  if (directSignals.some(signal => text.includes(signal))) return true;
  return /\b(discover|find|identify|source)\b.{0,80}\b(compan(?:y|ies)|prospects?|contractors?)\b/i.test(text) &&
    /\b(govcon|government contract|capture|proposal|federal|revenue|outbound|meeting)\b/i.test(text);
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

function captureRevenuePackages(objective) {
  return [
    {
      priority: 1,
      taskType: "CAPTURE_CAPACITY_DISCOVERY",
      department: "Revenue Operations",
      provider: "MILES",
      connector: "MILES",
      system: "MILES",
      action: "CAPTURE_CAPACITY_DISCOVERY",
      capability: "revenue.capture_capacity_handoff",
      readOnly: false,
      requiresKevin: false,
      description: "Discover evidence-backed CURRENTLY_LOOKING_FOR_HELP prospects and stage qualified capture-capacity work through the existing governed revenue lane.",
      objective,
      activationPolicy: "NEVER_AUTO_ACTIVATE"
    }
  ];
}

class BusinessWorkPlannerService {
  async plan(task = {}) {
    const objective = normalizeObjective(task);
    const readOnly = isReadOnlyReview(objective);
    const captureMission = !readOnly && isCaptureRevenueMission(objective);
    const recommendedActions = recommendations();
    const workPackages = readOnly
      ? []
      : captureMission
        ? captureRevenuePackages(objective)
        : executableReadPackages();

    return {
      ok: true,
      service: "BusinessWorkPlannerService",
      mode: readOnly ? "READ_ONLY_REVIEW" : captureMission ? "CAPTURE_REVENUE_EXECUTION" : "EXECUTION",
      readOnly,
      captureMission,
      objective,
      generatedAt: new Date().toISOString(),
      recommendationCount: recommendedActions.length,
      recommendations: recommendedActions,
      workPackageCount: workPackages.length,
      workPackages,
      connectorContract: {
        canonicalConnectors: captureMission ? ["MILES"] : ["INSTANTLY"],
        safeInstantlyReadActions: [...SAFE_INSTANTLY_READ_ACTIONS],
        captureAction: captureMission ? "CAPTURE_CAPACITY_DISCOVERY" : null,
        pseudoConnectorsForbidden: ["Revenue"],
        protectedWritesInferred: false,
        campaignAutoActivationAllowed: false
      }
    };
  }
}

module.exports = new BusinessWorkPlannerService();
module.exports.BusinessWorkPlannerService = BusinessWorkPlannerService;
module.exports.SAFE_INSTANTLY_READ_ACTIONS = SAFE_INSTANTLY_READ_ACTIONS;
module.exports.isReadOnlyReview = isReadOnlyReview;
module.exports.isCaptureRevenueMission = isCaptureRevenueMission;
module.exports.captureRevenuePackages = captureRevenuePackages;