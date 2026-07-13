"use strict";

const fs = require("fs");
const path = require("path");
const IDataProvider = require("../contracts/IDataProvider");
const ReplyIntelligenceEngine =
  require("../../SERVICES/ReplyIntelligenceEngine");
const DealClosureEngine =
  require("../../SERVICES/DealClosureEngine");

const ROOT = process.env.MILES_ROOT || process.cwd();
const OUT_DIR = path.join(ROOT, "DATA", "sales_coo");

function ensureDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function latestBusinessState() {
  const candidates = [
    path.join(ROOT, "DATA", "runtime", "latest_coo_cycle.json"),
    path.join(ROOT, "DATA", "executive", "latest_coo_cycle.json"),
    path.join(ROOT, "DATA", "executive_state.json")
  ];

  for (const file of candidates) {
    const value = readJson(file, null);
    if (!value) continue;

    const business =
      value.executiveState?.business ||
      value.business ||
      value.state?.business ||
      null;

    if (business) return business;
  }

  return {
    replies: [],
    proposals: [],
    deals: [],
    leads: [],
    campaigns: []
  };
}

function persistEvidence(name, result) {
  ensureDir();

  const file = path.join(OUT_DIR, name);

  fs.writeFileSync(
    file,
    JSON.stringify(result, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    path.join(OUT_DIR, "latest_sales_operation.json"),
    JSON.stringify(result, null, 2),
    "utf8"
  );

  return file;
}

function proposalDueDate(item = {}) {
  return (
    item.dueDate ||
    item.due ||
    item.deadline ||
    item.closeDate ||
    null
  );
}

class SalesProvider extends IDataProvider {
  constructor() {
    super("Sales");

    this.dependencies = [
      "CRM",
      "Email",
      "Calendar",
      "ORION"
    ];

    this.sourceSystems = [
      "DATA/runtime/latest_coo_cycle.json",
      "DATA/executive/latest_coo_cycle.json",
      "DATA/executive_state.json"
    ];
  }

  async initialize() {
    return this.reviewPipeline();
  }

  async refresh() {
    return this.reviewPipeline();
  }

  async processReplies() {
    const business = latestBusinessState();

    const replies = Array.isArray(business.replies)
      ? business.replies
      : [];

    const normalized = replies.map(reply => ({
      ...reply,
      text:
        reply.text ||
        reply.body ||
        reply.snippet ||
        reply.message ||
        ""
    }));

    const engine =
      new ReplyIntelligenceEngine({
        connectors: {}
      });

    const analysis =
      await engine.processReplies(normalized);

    const protectedActions =
      analysis.processed
        .filter(item =>
          ["meeting", "interested"].includes(
            item.classification.type
          )
        )
        .map(item => ({
          type: "CEO_REVIEW",
          reason:
            "Positive prospect response requires human-approved communication or commitment.",
          lead: item.reply?.lead || null,
          classification: item.classification
        }));

    this.lastRefresh =
      new Date().toISOString();

    this.dataFreshness = "Live";
    this.status = "Healthy";

    this.metrics = {
      repliesProcessed:
        analysis.processed.length,
      classifications:
        analysis.summary,
      protectedActions:
        protectedActions.length
    };

    this.exceptions = [];

    this.recommendations = [
      ...analysis.processed.map(item => ({
        action: "FOLLOW_UP_REVIEW",
        classification:
          item.classification.type,
        confidence:
          item.classification.confidence,
        lead:
          item.reply?.lead || null
      })),
      ...protectedActions
    ];

    const result = {
      ok: true,
      provider: "SalesProvider",
      action: "processReplies",
      generatedAt: this.lastRefresh,
      analysis,
      protectedActions,
      metrics: this.metrics
    };

    result.evidenceFile =
      persistEvidence(
        `reply_analysis_${Date.now()}.json`,
        result
      );

    return result;
  }

  async reviewPipeline() {
    const business = latestBusinessState();

    const deals = Array.isArray(business.deals)
      ? business.deals
      : [];

    const engine =
      new DealClosureEngine({
        connectors: {}
      });

    const analysis =
      await engine.run(deals);

    const pipelineValue =
      deals.reduce(
        (sum, deal) =>
          sum + Number(deal.value || 0),
        0
      );

    const weightedForecast =
      deals.reduce(
        (sum, deal) =>
          sum +
          Number(deal.value || 0) *
          Number(deal.probability || 0),
        0
      );

    const stalledDeals =
      deals.filter(deal => {
        const last =
          deal.lastActivity ||
          deal.updatedAt ||
          deal.lastUpdated;

        if (!last) return false;

        const ageDays =
          (
            Date.now() -
            new Date(last).getTime()
          ) / 86400000;

        return (
          Number.isFinite(ageDays) &&
          ageDays >= 3
        );
      });

    this.lastRefresh =
      new Date().toISOString();

    this.dataFreshness = "Live";
    this.status = "Healthy";

    this.metrics = {
      activeDeals: deals.length,
      pipelineValue,
      weightedForecast,
      stalledDeals:
        stalledDeals.length,
      hotDeals:
        analysis.summary.hot,
      warmDeals:
        analysis.summary.warm
    };

    this.exceptions = [];

    this.recommendations = [
      ...stalledDeals.map(deal => ({
        action: "CREATE_FOLLOW_UP",
        dealId: deal.id || null,
        dealName:
          deal.name ||
          deal.company ||
          "Unknown",
        reason:
          "No recorded activity for at least 3 days."
      })),
      ...analysis.outputs.map(output => ({
        action:
          output.decision.action,
        stage:
          output.decision.stage,
        dealId:
          output.deal.id || null,
        dealName:
          output.deal.name ||
          output.deal.company ||
          "Unknown",
        protected:
          output.decision.action ===
            "PROPOSAL" ||
          output.decision.action ===
            "CLOSE_NOW"
      }))
    ];

    const result = {
      ok: true,
      provider: "SalesProvider",
      action: "reviewPipeline",
      generatedAt: this.lastRefresh,
      analysis,
      metrics: this.metrics,
      recommendations:
        this.recommendations
    };

    result.evidenceFile =
      persistEvidence(
        `pipeline_review_${Date.now()}.json`,
        result
      );

    return result;
  }

  async reviewProposals() {
    const business = latestBusinessState();

    const proposals =
      Array.isArray(business.proposals)
        ? business.proposals
        : [];

    const now = Date.now();

    const reviewed =
      proposals
        .map(proposal => {
          const due =
            proposalDueDate(proposal);

          const dueMs =
            due
              ? new Date(due).getTime()
              : NaN;

          const hoursRemaining =
            Number.isFinite(dueMs)
              ? Math.round(
                  (dueMs - now) / 3600000
                )
              : null;

          return {
            ...proposal,
            dueDate: due,
            hoursRemaining,
            urgency:
              hoursRemaining === null
                ? "UNKNOWN"
                : hoursRemaining <= 24
                  ? "CRITICAL"
                  : hoursRemaining <= 72
                    ? "HIGH"
                    : "NORMAL",
            submissionProtected: true
          };
        })
        .sort((a, b) => {
          if (a.hoursRemaining === null) {
            return 1;
          }

          if (b.hoursRemaining === null) {
            return -1;
          }

          return (
            a.hoursRemaining -
            b.hoursRemaining
          );
        });

    this.lastRefresh =
      new Date().toISOString();

    this.dataFreshness = "Live";
    this.status = "Healthy";

    this.metrics = {
      proposals: reviewed.length,
      critical:
        reviewed.filter(
          item =>
            item.urgency === "CRITICAL"
        ).length,
      high:
        reviewed.filter(
          item =>
            item.urgency === "HIGH"
        ).length
    };

    this.exceptions =
      reviewed
        .filter(item =>
          item.hoursRemaining !== null &&
          item.hoursRemaining < 0
        )
        .map(item => ({
          type: "ProposalPastDue",
          severity: "Critical",
          message:
            `${item.title ||
              item.name ||
              item.id ||
              "Proposal"} is past due.`
        }));

    this.recommendations =
      reviewed.map(item => ({
        action:
          "PREPARE_SUBMISSION_READINESS",
        proposalId:
          item.id || null,
        title:
          item.title ||
          item.name ||
          "Proposal",
        dueDate: item.dueDate,
        urgency: item.urgency,
        requiresCEOApproval: true
      }));

    const result = {
      ok: true,
      provider: "SalesProvider",
      action: "reviewProposals",
      generatedAt: this.lastRefresh,
      proposals: reviewed,
      metrics: this.metrics,
      exceptions: this.exceptions,
      recommendations:
        this.recommendations
    };

    result.evidenceFile =
      persistEvidence(
        `proposal_review_${Date.now()}.json`,
        result
      );

    return result;
  }

  async executeTask(task = {}) {
    const action =
      task.payload?.action ||
      task.action ||
      "reviewPipeline";

    if (
      typeof this[action] !== "function"
    ) {
      throw new Error(
        `Unsupported SalesProvider action: ${action}`
      );
    }

    return this[action](task);
  }

  async shutdown() {
    return true;
  }
}

module.exports = SalesProvider;

