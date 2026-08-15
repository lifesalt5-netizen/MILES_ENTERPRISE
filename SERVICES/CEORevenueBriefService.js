"use strict";

const fs = require("fs");
const path = require("path");
const dashboardData = require("./DashboardDataService");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "DATA", "executive_dashboard");
const JSON_FILE = path.join(OUT_DIR, "ceo_daily_brief.json");
const MD_FILE = path.join(OUT_DIR, "ceo_daily_brief.md");

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function list(value) { return Array.isArray(value) ? value : []; }
function uniq(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = String(item || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function ensureDir() { fs.mkdirSync(OUT_DIR, { recursive: true }); }

class CEORevenueBriefService {
  build(options = {}) {
    const state = options.state || dashboardData.run({ source: "CEORevenueBriefService" });
    const weeklyGoal = Math.max(1, number(process.env.MILES_WEEKLY_REVENUE_GOAL || state?.revenue?.goal || state?.executiveSummary?.revenueGoal || 10000, 10000));
    const current = Math.max(0, number(state?.revenue?.current || state?.executiveSummary?.revenueCurrent, 0));
    const pipeline = Math.max(0, number(state?.revenue?.pipeline || state?.executiveSummary?.pipeline, 0));
    const progressPct = Math.min(999, Math.round((current / weeklyGoal) * 1000) / 10);
    const gap = Math.max(0, weeklyGoal - current);
    const pipelineCoverage = gap > 0 ? Math.round((pipeline / gap) * 100) / 100 : null;

    const priorityText = list(state?.companyState?.priorities).map(p => p?.title || p?.objective || p?.action).filter(Boolean);
    const alertText = list(state?.alerts)
      .filter(a => String(a?.severity || "").toUpperCase() !== "INFO")
      .map(a => a?.action || a?.message || a?.title)
      .filter(Boolean);
    const workText = list(state?.workQueue?.recentItems)
      .filter(w => ["queued","pending","blocked","awaiting approval","in progress","running"].includes(String(w?.status || "").toLowerCase().replace(/[_-]+/g," ")))
      .map(w => w?.title || w?.objective || w?.action)
      .filter(Boolean);

    const topActions = uniq([...priorityText, ...alertText, ...workText]).slice(0, 5);
    if (!topActions.length) {
      if (gap > 0 && pipeline <= 0) topActions.push("Create or restore qualified revenue pipeline before expecting progress toward the weekly goal.");
      if (gap > 0 && pipeline > 0) topActions.push("Advance the highest-probability active deals toward a close this week.");
      if (number(state?.workQueue?.awaitingApproval, 0) > 0) topActions.push("Clear CEO approvals that are blocking revenue-producing work.");
    }

    let status = "ON_TRACK";
    if (current >= weeklyGoal) status = "GOAL_MET";
    else if (pipeline < gap) status = "AT_RISK";
    else if (pipelineCoverage !== null && pipelineCoverage < 2) status = "WATCH";

    const brief = {
      ok: true,
      type: "CEO_DAILY_REVENUE_BRIEF",
      generatedAt: new Date().toISOString(),
      goal: { weeklyRevenue: weeklyGoal },
      scorecard: {
        currentRevenue: current,
        remainingGap: gap,
        progressPct,
        pipeline,
        pipelineCoverage,
        status
      },
      operatingState: {
        companyHealth: state?.executiveSummary?.companyHealthStatus || "UNKNOWN",
        runtime: state?.executiveSummary?.runtimeStatus || state?.cooRuntime?.runtimeHealthStatus || "UNKNOWN",
        openWork: number(state?.workQueue?.open, 0),
        awaitingApproval: number(state?.workQueue?.awaitingApproval, 0),
        blocked: number(state?.workQueue?.blocked, 0),
        failed: number(state?.workQueue?.failed, 0),
        activeCampaigns: number(state?.marketing?.activeCampaigns, 0),
        proposalsOutstanding: number(state?.revenue?.proposalsOutstanding, 0)
      },
      milesAssessment: current >= weeklyGoal
        ? "The weekly revenue target is met. Protect delivery quality and build next week's pipeline."
        : pipeline <= 0
          ? `P2GC is ${gap.toLocaleString("en-US", {style:"currency",currency:"USD",maximumFractionDigits:0})} short of the weekly goal and has no supported pipeline coverage in the current dashboard truth.`
          : `P2GC is ${gap.toLocaleString("en-US", {style:"currency",currency:"USD",maximumFractionDigits:0})} short of the weekly goal with ${pipeline.toLocaleString("en-US", {style:"currency",currency:"USD",maximumFractionDigits:0})} in pipeline (${pipelineCoverage}x gap coverage).`,
      topActions,
      requiresKevin: number(state?.workQueue?.awaitingApproval, 0) > 0,
      approvalCount: number(state?.workQueue?.awaitingApproval, 0),
      sourceGeneratedAt: state?.generatedAt || null
    };

    ensureDir();
    fs.writeFileSync(JSON_FILE, JSON.stringify(brief, null, 2), "utf8");
    fs.writeFileSync(MD_FILE, this.renderMarkdown(brief), "utf8");
    return brief;
  }

  renderMarkdown(brief) {
    const money = value => Number(value || 0).toLocaleString("en-US", { style:"currency", currency:"USD", maximumFractionDigits:0 });
    return [
      "# MILES CEO Daily Revenue Brief",
      `Generated: ${brief.generatedAt}`,
      "",
      `## $10K/Week Scorecard`,
      `- Weekly goal: ${money(brief.goal.weeklyRevenue)}`,
      `- Revenue recorded: ${money(brief.scorecard.currentRevenue)}`,
      `- Remaining gap: ${money(brief.scorecard.remainingGap)}`,
      `- Progress: ${brief.scorecard.progressPct}%`,
      `- Pipeline: ${money(brief.scorecard.pipeline)}`,
      `- Pipeline coverage of remaining gap: ${brief.scorecard.pipelineCoverage == null ? "Goal met" : brief.scorecard.pipelineCoverage + "x"}`,
      `- Status: ${brief.scorecard.status}`,
      "",
      "## Where You Are",
      brief.milesAssessment,
      "",
      "## What Needs To Be Done Next",
      ...(brief.topActions.length ? brief.topActions.map((action, i) => `${i + 1}. ${action}`) : ["1. No supported action was available from current operating truth."]),
      "",
      "## CEO Attention",
      brief.requiresKevin ? `${brief.approvalCount} item(s) currently require Kevin approval.` : "No current CEO approval blocker."
    ].join("\n");
  }
}

module.exports = new CEORevenueBriefService();
module.exports.CEORevenueBriefService = CEORevenueBriefService;
