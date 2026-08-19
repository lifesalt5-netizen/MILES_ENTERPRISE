"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, "CONFIG", "state_sled_fl_monitoring_rules.json");

function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
}

function unwrapItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function numberFrom(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function deriveMetrics(analytics = {}, leads = []) {
  const sent = numberFrom(analytics, ["sent", "emails_sent", "sent_count", "total_sent"]);
  const replies = numberFrom(analytics, ["replies", "reply_count", "total_replies"]);
  const positiveReplies = numberFrom(analytics, ["positive_replies", "positive_reply_count"]);
  const bounced = numberFrom(analytics, ["bounced", "bounce_count", "bounces"]);

  return {
    sent,
    replies,
    positiveReplies,
    bounced,
    replyRate: sent > 0 ? replies / sent : 0,
    positiveReplyRate: sent > 0 ? positiveReplies / sent : 0,
    bounceRate: sent > 0 ? bounced / sent : 0,
    leadCountObserved: leads.length
  };
}

async function run() {
  const rules = loadRules();

  if (rules.safety?.readOnly !== true) {
    throw new Error("P1.3N safety invariant failed: monitoring must remain read-only.");
  }

  const connector = require("../CONNECTORS/INSTANTLY/connector");

  const campaignResult = await connector.execute({
    action: "GET_CAMPAIGN",
    payload: { campaign_id: rules.campaignId }
  });

  const campaign = campaignResult?.campaign || campaignResult?.result || {};

  const analyticsResult = await connector.execute({
    action: "INSTANTLY_CAMPAIGN_ANALYTICS",
    payload: { campaign_id: rules.campaignId }
  });

  const analytics = analyticsResult?.analytics || analyticsResult?.result || {};

  const leadsResult = await connector.execute({
    action: "LIST_LEADS",
    payload: { campaign_id: rules.campaignId, limit: 100 }
  });

  const leads = unwrapItems(leadsResult?.leads || leadsResult?.result || []);
  const metrics = deriveMetrics(analytics, leads);

  const checks = {
    campaignExists: Boolean(campaign?.id),
    campaignIdExact: String(campaign?.id || "") === rules.campaignId,
    campaignNameExact: String(campaign?.name || "").trim().toUpperCase() === rules.campaignName.toUpperCase(),
    campaignActive: Number(campaign?.status) === 1,
    minimumLeadCountObserved: metrics.leadCountObserved >= Number(rules.minimumLeadCount || 0),
    bounceRateWithinThreshold: metrics.sent === 0 || metrics.bounceRate < Number(rules.thresholds?.bounceRatePauseRecommend || 0.05)
  };

  const recommendations = [];
  if (!checks.campaignActive) recommendations.push("CAMPAIGN_NOT_ACTIVE_INVESTIGATE");
  if (!checks.minimumLeadCountObserved) recommendations.push("LEAD_COUNT_BELOW_EXPECTED_INVESTIGATE");
  if (!checks.bounceRateWithinThreshold) recommendations.push("PAUSE_RECOMMENDED_HIGH_BOUNCE_RATE");
  if (metrics.sent > 0 && metrics.replyRate < Number(rules.thresholds?.replyRateHealthy || 0.01)) {
    recommendations.push("REPLY_RATE_BELOW_TARGET_REVIEW_COPY_TARGETING");
  }

  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);

  const result = {
    ok: true,
    gate: rules.gate,
    generatedAt: new Date().toISOString(),
    campaign: {
      id: campaign?.id || null,
      name: campaign?.name || null,
      status: campaign?.status ?? null
    },
    metrics,
    checks,
    failedChecks,
    recommendations,
    safety: rules.safety
  };

  const outDir = path.join(ROOT, "DATA", "OUTBOUND", "STATE_SLED", "LIVE_MONITORING");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "STATE_SLED_FL_LIVE_MONITORING.json");
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  result.outputFile = outFile;

  return result;
}

module.exports = {
  run,
  deriveMetrics
};
