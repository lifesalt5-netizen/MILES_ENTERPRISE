"use strict";

const fs = require("fs");
const path = require("path");

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, filePath);
}

class CurrentPhaseRevenueStatusService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.revenueDir = path.join(this.rootDir, "DATA", "runtime", "revenue");
    this.outputDir = path.join(this.revenueDir, "current_phase");
    this.outputPath = options.outputPath || path.join(this.outputDir, "current_phase_revenue_status_latest.json");
    this.now = options.now || (() => new Date().toISOString());
  }

  paths() {
    return {
      reply: path.join(this.revenueDir, "replies", "reply_intelligence_latest.json"),
      replyKpi: path.join(this.revenueDir, "replies", "reply_kpis_latest.json"),
      qualifiedReplies: path.join(this.revenueDir, "replies", "qualified_reply_queue.json"),
      followups: path.join(this.revenueDir, "replies", "followup_queue.json"),
      manualReview: path.join(this.revenueDir, "replies", "manual_review_queue.json"),
      suppression: path.join(this.revenueDir, "replies", "global_suppression_master.json"),
      winback: path.join(this.revenueDir, "winback", "winback_master_export_latest.json"),
      winbackCampaign: path.join(this.revenueDir, "winback", "campaign_latest.json"),
      captureDiscovery: path.join(this.revenueDir, "capture_capacity", "capture_capacity_prospect_feed_latest.json"),
      captureCampaign: path.join(this.revenueDir, "capture_capacity_campaign_latest.json")
    };
  }

  execute(options = {}) {
    const p = this.paths();
    const reply = readJson(p.reply);
    const replyKpi = readJson(p.replyKpi);
    const qualifiedReplies = arrayValue(readJson(p.qualifiedReplies, []));
    const followups = arrayValue(readJson(p.followups, []));
    const manualReview = arrayValue(readJson(p.manualReview, []));
    const suppression = readJson(p.suppression, { entries: [] }) || { entries: [] };
    const winback = readJson(p.winback);
    const winbackCampaign = readJson(p.winbackCampaign);
    const captureDiscovery = readJson(p.captureDiscovery);
    const captureCampaign = readJson(p.captureCampaign);

    const blockers = [];
    const warnings = [];

    if (!reply) blockers.push({ lane: "REPLY_INTELLIGENCE", code: "ARTIFACT_MISSING", path: p.reply });
    else if (reply.ok === false) blockers.push({ lane: "REPLY_INTELLIGENCE", code: reply.status || "POLL_FAILED", detail: reply.error || "" });

    if (!winback) blockers.push({ lane: "WINBACK", code: "MASTER_EXPORT_MISSING", path: p.winback });
    else if (winback.ok === false) blockers.push({ lane: "WINBACK", code: "MASTER_EXPORT_FAILED" });

    if (!captureDiscovery) blockers.push({ lane: "CAPTURE_CAPACITY", code: "DISCOVERY_ARTIFACT_MISSING", path: p.captureDiscovery });
    else if (captureDiscovery.ok === false) warnings.push({ lane: "CAPTURE_CAPACITY", code: captureDiscovery.nextAction || "NO_QUALIFIED_PROSPECTS" });

    if (!captureCampaign) blockers.push({ lane: "CAPTURE_CAPACITY", code: "CAMPAIGN_PLAN_MISSING", path: p.captureCampaign });
    else if (captureCampaign.ok === false && captureDiscovery?.campaignGate?.eligibleCount > 0) {
      blockers.push({ lane: "CAPTURE_CAPACITY", code: captureCampaign.status || "CAMPAIGN_PLAN_FAILED" });
    }

    if (!winbackCampaign) warnings.push({ lane: "WINBACK", code: "CAMPAIGN_PLAN_MISSING", path: p.winbackCampaign });

    const replyMetrics = {
      latestHumanReplies: num(reply?.latest?.humanReplies),
      latestQualifiedPositiveReplies: num(reply?.latest?.qualifiedPositiveReplies),
      cumulativeHumanReplies: num(reply?.cumulative?.humanReplies || replyKpi?.cumulative?.humanReplies),
      cumulativeQualifiedPositiveReplies: num(reply?.cumulative?.qualifiedPositiveReplies || replyKpi?.cumulative?.qualifiedPositiveReplies),
      qualifiedQueueOpen: qualifiedReplies.filter(row => String(row?.status || "OPEN").toUpperCase() !== "CLOSED").length,
      followupsScheduled: followups.filter(row => String(row?.status || "SCHEDULED").toUpperCase() !== "CLOSED").length,
      manualReviewOpen: manualReview.filter(row => String(row?.status || "OPEN").toUpperCase() !== "CLOSED").length,
      globalSuppressions: arrayValue(suppression.entries).filter(row => row?.active !== false).length,
      rawReplyMetricDeprecated: replyKpi?.rawReplyMetricDeprecated === true
    };

    const winbackMetrics = {
      masterCount: num(winback?.masterCount),
      priorConversationReady: num(winback?.priorReadyCount),
      reactivationReady: num(winback?.reactivationReadyCount),
      reviewCount: num(winback?.reviewCount),
      totalReady: num(winback?.priorReadyCount) + num(winback?.reactivationReadyCount),
      campaignPlanPresent: Boolean(winbackCampaign)
    };

    const captureMetrics = {
      contactRows: num(captureDiscovery?.sourceCounts?.contactRows),
      signalRows: num(captureDiscovery?.sourceCounts?.signalRows),
      enrichedRows: num(captureDiscovery?.sourceCounts?.enrichedRows),
      qualifiedProspects: num(captureDiscovery?.sourceCounts?.qualifiedRows || captureDiscovery?.campaignGate?.eligibleCount),
      blockedByGate: num(captureDiscovery?.sourceCounts?.blockedByCampaignGate || captureDiscovery?.campaignGate?.blockedCount),
      nextAction: captureDiscovery?.nextAction || null,
      campaignPlanPresent: Boolean(captureCampaign)
    };

    const actions = [];
    if (replyMetrics.qualifiedQueueOpen > 0) actions.push({ priority: 1, owner: "KEVIN", action: "RESPOND_TO_QUALIFIED_REPLIES", count: replyMetrics.qualifiedQueueOpen, reason: "Highest-intent human replies should be handled before new cold activity." });
    if (winbackMetrics.priorConversationReady > 0) actions.push({ priority: 2, owner: "KEVIN_MILES", action: "REVIEW_WINBACK_PRIOR_CONVERSATIONS", count: winbackMetrics.priorConversationReady, reason: "Prior conversations are the highest-trust dormant audience." });
    if (winbackMetrics.reactivationReady > 0) actions.push({ priority: 3, owner: "MILES", action: "REVIEW_WINBACK_REACTIVATION", count: winbackMetrics.reactivationReady, reason: "No-show/reschedule prospects require separate reactivation language." });
    if (captureMetrics.qualifiedProspects > 0) actions.push({ priority: 4, owner: "MILES", action: "REVIEW_CAPTURE_CAPACITY_PROSPECTS", count: captureMetrics.qualifiedProspects, reason: "Evidence-backed capture-capacity prospects are ready for campaign review." });
    if (replyMetrics.followupsScheduled > 0) actions.push({ priority: 5, owner: "MILES", action: "PROCESS_DUE_OOO_NOT_NOW_FOLLOWUPS", count: replyMetrics.followupsScheduled, reason: "Follow-up timing should not be lost in raw reply noise." });
    if (replyMetrics.manualReviewOpen > 0) actions.push({ priority: 6, owner: "KEVIN", action: "REVIEW_AMBIGUOUS_HUMAN_REPLIES", count: replyMetrics.manualReviewOpen, reason: "Neutral/unknown human replies need judgment before routing." });

    actions.sort((a, b) => a.priority - b.priority);

    const technicalReady = blockers.length === 0;
    const revenueActionsReady = actions.some(action => action.count > 0);
    const currentPhaseStatus = technicalReady
      ? (revenueActionsReady ? "CURRENT_PHASE_TECHNICALLY_STABLE_REVENUE_ACTIONS_READY" : "CURRENT_PHASE_TECHNICALLY_STABLE_NO_READY_ACTIONS")
      : "CURRENT_PHASE_BLOCKED";

    const report = {
      ok: technicalReady,
      service: "CURRENT_PHASE_REVENUE_STATUS",
      status: currentPhaseStatus,
      generatedAt: this.now(),
      technicalReady,
      revenueActionsReady,
      dashboardNextPhaseEligible: technicalReady,
      dashboardNextPhaseIssue: 101,
      governance: {
        milesOwnsExecution: true,
        kevinOwnsDirectionAndProtectedDecisions: true,
        noAutonomousProspectFacingReplies: true,
        noCampaignActivationFromAudit: true,
        dashboardWorkMustWaitForCurrentPhaseStability: true
      },
      replies: replyMetrics,
      winback: winbackMetrics,
      captureCapacity: captureMetrics,
      blockers,
      warnings,
      nextActions: actions.slice(0, 10),
      artifacts: { ...p, consolidated: this.outputPath }
    };

    if (options.writeReport !== false) writeJsonAtomic(this.outputPath, report);
    return report;
  }
}

module.exports = CurrentPhaseRevenueStatusService;
module.exports.CurrentPhaseRevenueStatusService = CurrentPhaseRevenueStatusService;
module.exports.helpers = { readJson, arrayValue, num, writeJsonAtomic };
