"use strict";

/*
  MILES Enterprise
  Business Work Planner

  Governing rules:
  - Explicit review-only requests queue no execution work.
  - Scoped safety constraints (for example "do not send to Instantly") do NOT
    convert an otherwise explicit execution mission into a read-only review.
  - Revenue-universe reconciliation outranks government-data refresh when the
    CEO is commercializing known contractors, recovering historical leads, or
    rebuilding addressable-market coverage.
  - Government-data refresh/reconciliation missions use the governed MILES
    government-data execution lane, never generic Instantly inventory reads.
  - Generic business planning never infers protected writes.
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

function hasExecutionDirective(objective = "") {
  const text = String(objective || "");
  return /\b(execute|run|refresh|reconcile|reconciliation|ingest|pull|harvest|build|rebuild|generate|produce|stage|join|calculate|assign|update|create|route|queue|deploy|implement|recover|restore|enrich|qualify|commercialize)\b/i.test(text);
}

function isExplicitReadOnlyReview(objective = "") {
  const text = String(objective || "");
  return (
    /\bread[\s-]?only\b/i.test(text) ||
    /\b(?:review|analysis|audit|report)\s+only\b/i.test(text) ||
    /\bdo\s+not\s+execute\b/i.test(text) ||
    /\bdon['’]t\s+execute\b/i.test(text) ||
    /\bwithout\s+execut(?:e|ing)\b/i.test(text) ||
    /\bdo\s+not\s+make\s+(?:any\s+)?changes\b/i.test(text) ||
    /\bwithout\s+making\s+(?:any\s+)?changes\b/i.test(text)
  );
}

function isReadOnlyReview(objective = "") {
  const text = String(objective || "");
  if (isExplicitReadOnlyReview(text)) return true;

  const reviewSignal = /\b(review|audit|inspect|analy[sz]e|check|assess)\b/i.test(text);
  const scopedNoChange = (
    /\bdo\s+not\s+(?:send|modify|change|publish|launch|activate|pause|delete|create|update|write)\b/i.test(text) ||
    /\bdon['’]t\s+(?:send|modify|change|publish|launch|activate|pause|delete|create|update|write)\b/i.test(text) ||
    /\bwithout\s+(?:sending|modifying|changing|publishing|launching|activating|pausing|deleting|creating|updating|writing)\b/i.test(text)
  );

  return reviewSignal && scopedNoChange && !hasExecutionDirective(text);
}

function isRevenueUniverseMission(objective = "") {
  const text = String(objective || "");
  const universeSignal = (
    /\bb12\b|b12[- ]to[- ]instantly|historical\s+b12|lead\s+universe|prospect\s+universe|contractor\s+universe|addressable\s+market|revenue\s+lifecycle|commercial\s+disposition|recoverable\s+lead|recoverable\s+prospect|re[- ]?enrich|decision[- ]?maker|campaign[- ]?ready\s+inventory|market[- ]?coverage|campaign\s+starvation|continuous\s+refill|current\s+(?:~?26k|26,?000)|361,?873/.test(text.toLowerCase())
  );
  const revenueSignal = /\b(revenue|prospect|lead|contractor|company|contact|outreach|campaign|commercial|enrichment|verification|addressable|decision[- ]?maker)\b/i.test(text);
  return universeSignal && revenueSignal && hasExecutionDirective(text);
}

function isGovernmentDataMission(objective = "") {
  const text = String(objective || "");
  const govSubject = /\b(gsa|sam\.?gov|sam registration|usaspending|usa spending|government data|gsa holder|gsa holders|schedule holder|schedule holders|sin master|vendor universe|vendor ingest|vendor refresh|vendor reconciliation)\b/i.test(text);
  const govWork = /\b(refresh|reconcile|reconciliation|ingest|pull|harvest|holder|holders|dataset|data|sales|award|awards|segment|segmenting|segmentation|vendor|vendors)\b/i.test(text);
  return govSubject && govWork && hasExecutionDirective(text);
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

function revenueUniversePackages(objective) {
  return [{
    priority: 1,
    taskType: "REVENUE_UNIVERSE_RECONCILIATION",
    department: "Revenue Operations",
    provider: "MILES",
    connector: "MILES",
    system: "MILES",
    action: "REVENUE_UNIVERSE_RECONCILIATION",
    capability: "revenue.universe_reconciliation",
    readOnly: false,
    requiresKevin: false,
    description: "Reconcile the durable contractor/company universe into explicit commercial dispositions, current-contact states, enrichment queues, campaign-ready inventory, and evidence-backed market coverage without automatically sending or overriding suppression.",
    objective,
    activationPolicy: "STAGING_ONLY_NO_AUTO_SEND_NO_SUPPRESSION_OVERRIDE"
  }];
}

function captureRevenuePackages(objective) {
  return [{
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
  }];
}

function governmentDataPackages(objective) {
  return [{
    priority: 1,
    taskType: "GSA_DATA_EXECUTION",
    department: "Government Market Intelligence",
    provider: "MILES",
    connector: "MILES",
    system: "MILES",
    action: "GSA_DATA_EXECUTION",
    capability: "government_data.gsa_execution",
    readOnly: false,
    requiresKevin: false,
    description: "Execute the governed GSA vendor refresh/reconciliation mission, stage authoritative outputs, and fail closed when required execution capabilities or evidence are missing.",
    objective,
    activationPolicy: "STAGING_ONLY_NO_INSTANTLY_PUSH"
  }];
}

class BusinessWorkPlannerService {
  async plan(task = {}) {
    const objective = normalizeObjective(task);
    const readOnly = isReadOnlyReview(objective);
    const revenueUniverseMission = !readOnly && isRevenueUniverseMission(objective);
    const governmentDataMission = !readOnly && !revenueUniverseMission && isGovernmentDataMission(objective);
    const captureMission = !readOnly && !revenueUniverseMission && !governmentDataMission && isCaptureRevenueMission(objective);
    const recommendedActions = recommendations();

    const workPackages = readOnly
      ? []
      : revenueUniverseMission
        ? revenueUniversePackages(objective)
        : governmentDataMission
          ? governmentDataPackages(objective)
          : captureMission
            ? captureRevenuePackages(objective)
            : executableReadPackages();

    const mode = readOnly
      ? "READ_ONLY_REVIEW"
      : revenueUniverseMission
        ? "REVENUE_UNIVERSE_RECONCILIATION"
        : governmentDataMission
          ? "GOVERNMENT_DATA_EXECUTION"
          : captureMission
            ? "CAPTURE_REVENUE_EXECUTION"
            : "EXECUTION";

    return {
      ok: true,
      service: "BusinessWorkPlannerService",
      mode,
      readOnly,
      revenueUniverseMission,
      governmentDataMission,
      captureMission,
      objective,
      generatedAt: new Date().toISOString(),
      recommendationCount: recommendedActions.length,
      recommendations: recommendedActions,
      workPackageCount: workPackages.length,
      workPackages,
      connectorContract: {
        canonicalConnectors: revenueUniverseMission || governmentDataMission || captureMission ? ["MILES"] : ["INSTANTLY"],
        safeInstantlyReadActions: [...SAFE_INSTANTLY_READ_ACTIONS],
        revenueUniverseAction: revenueUniverseMission ? "REVENUE_UNIVERSE_RECONCILIATION" : null,
        governmentDataAction: governmentDataMission ? "GSA_DATA_EXECUTION" : null,
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
module.exports.hasExecutionDirective = hasExecutionDirective;
module.exports.isExplicitReadOnlyReview = isExplicitReadOnlyReview;
module.exports.isReadOnlyReview = isReadOnlyReview;
module.exports.isRevenueUniverseMission = isRevenueUniverseMission;
module.exports.isGovernmentDataMission = isGovernmentDataMission;
module.exports.isCaptureRevenueMission = isCaptureRevenueMission;
module.exports.revenueUniversePackages = revenueUniversePackages;
module.exports.governmentDataPackages = governmentDataPackages;
module.exports.captureRevenuePackages = captureRevenuePackages;
