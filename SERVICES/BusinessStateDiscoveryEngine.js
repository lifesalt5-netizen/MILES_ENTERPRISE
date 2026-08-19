"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const LiveBusinessStateService = require("./LiveBusinessStateService");

const ROOT =
  process.env.MILES_ROOT ||
  "C:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const DAY_MS = 24 * 60 * 60 * 1000;

const OPTIONAL_STATE_FILES = Object.freeze({
  email: "MILES_EMAIL_STATE_FILE",
  calendar: "MILES_CALENDAR_STATE_FILE",
  website: "MILES_WEBSITE_STATE_FILE",
  linkedin: "MILES_LINKEDIN_STATE_FILE",
  clients: "MILES_CLIENT_HEALTH_STATE_FILE",
  revenue: "MILES_REVENUE_STATE_FILE",
  approvals: "MILES_APPROVAL_STATE_FILE",
  workflows: "MILES_WORKFLOW_STATE_FILE"
});

const VISIBILITY_PROFILES = Object.freeze({
  campaigns: profile("MarketingProvider", "refresh", "revenue.outbound.audit", "Revenue Operations", "InstantlyExecutiveAdvisor"),
  replies: profile("MarketingProvider", "refresh", "revenue.replies.refresh", "Revenue Operations", "InstantlyExecutiveAdvisor"),
  mailboxes: profile("MarketingProvider", "refresh", "revenue.outbound.audit", "Revenue Operations", "InstantlyExecutiveAdvisor"),
  segments: profile("MarketingProvider", "refresh", "revenue.segments.refresh", "Revenue Operations", "Sophia"),
  deals: profile("MILES", "CRM_REFRESH", "revenue.crm.refresh", "Sales", "SalesExecutiveAdvisor"),
  proposals: profile("MILES", "PROPOSAL_PIPELINE_REVIEW", "proposal.pipeline.review", "Capture", "ProposalExecutiveAdvisor"),
  opportunities: profile("OrionProvider", "refresh", "orion.opportunities.refresh", "Intelligence", "Jeff"),
  contractors: profile("OrionProvider", "refresh", "orion.contractors.refresh", "Intelligence", "Eleanor"),
  email: profile("GoogleWorkspaceProvider", "auditWorkspace", "google.gmail.audit", "Operations", "GoogleWorkspaceExecutiveAdvisor"),
  calendar: profile("GoogleWorkspaceProvider", "auditWorkspace", "google.calendar.audit", "Operations", "GoogleWorkspaceExecutiveAdvisor"),
  website: profile("WebsiteProvider", "verifyWebsite", "website.health.audit", "Digital Infrastructure", "WebsiteExecutiveAdvisor"),
  linkedin: profile("MILES", "MARKETING_AUDIT", "marketing.linkedin.audit", "Marketing", "MarketingExecutiveAdvisor"),
  clients: profile("MILES", "CLIENT_HEALTH_REVIEW", "customer.success.health.review", "Customer Success", "CustomerSuccessExecutiveAdvisor"),
  revenue: profile("MILES", "REVENUE_GAP_REVIEW", "revenue.target.gap.review", "Revenue Operations", "RevenueExecutiveAdvisor"),
  approvals: profile("MILES", "APPROVAL_QUEUE_REVIEW", "governance.approvals.review", "Executive Operations", "GovernanceExecutiveAdvisor"),
  workflows: profile("MILES", "WORKFLOW_HEALTH_REVIEW", "workflow.pipeline.review", "Operations", "OperationsExecutiveAdvisor")
});

function profile(provider, action, capability, department, assignedTo) {
  return {
    provider,
    action,
    capability,
    department,
    assignedTo,
    safeToAutoExecute: true
  };
}

function nowIso() {
  return new Date().toISOString();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value) {
  return String(value || "").trim();
}

function status(value) {
  return text(value).toLowerCase();
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["items", "rows", "data", "results", "records"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return Object.keys(value).length ? [value] : [];
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function safeReadJson(file) {
  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")
    );
  } catch {
    return null;
  }
}

function resolveConfiguredFile(root, environmentName) {
  const configured = process.env[environmentName];
  if (!configured) return null;
  return path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(root, configured);
}

function timestamp(row) {
  for (const key of [
    "dueDate",
    "deadline",
    "closeDate",
    "nextActionAt",
    "followUpAt",
    "lastContactAt",
    "updatedAt",
    "createdAt"
  ]) {
    const parsed = new Date(row?.[key] || 0).getTime();
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function finding(input) {
  const key = hash({
    domain: input.domain,
    category: input.category,
    subject: input.subject || null,
    capability: input.execution?.capability || null
  });

  return {
    infrastructureId: `business_${input.domain}`,
    source: "BusinessStateDiscoveryEngine",
    category: input.category,
    status: input.status || "WARNING",
    score: number(input.score, 60),
    message: input.message,
    evidence: input.evidence || {},
    execution: input.execution || VISIBILITY_PROFILES[input.domain],
    findingKey: key,
    businessDomain: input.domain,
    subject: input.subject || null,
    cooldownMs: number(input.cooldownMs, 6 * 60 * 60 * 1000)
  };
}

class BusinessStateDiscoveryEngine {
  constructor(options = {}) {
    this.root = path.resolve(options.root || ROOT);
    this.liveState =
      options.liveState ||
      new LiveBusinessStateService({ root: this.root });
    this.taskQueue = options.taskQueue || null;
    this.monthlyRevenueTarget = number(
      options.monthlyRevenueTarget ||
        process.env.MILES_MONTHLY_REVENUE_TARGET,
      10000
    );
  }

  collectSupplementalState(injected = {}) {
    const supplemental = { ...injected };

    for (const [domain, environmentName] of Object.entries(OPTIONAL_STATE_FILES)) {
      if (supplemental[domain] !== undefined) continue;
      const file = resolveConfiguredFile(this.root, environmentName);
      if (!file) continue;
      const value = safeReadJson(file);
      if (value !== null) supplemental[domain] = value;
    }

    return supplemental;
  }

  collectQueueState() {
    let queue = [];
    try {
      queue =
        this.taskQueue && typeof this.taskQueue.list === "function"
          ? this.taskQueue.list()
          : [];
    } catch {
      queue = [];
    }

    return {
      total: queue.length,
      queued: queue.filter(item => /queued|pending|authorized/i.test(text(item?.status))).length,
      running: queue.filter(item => /running|in_progress/i.test(text(item?.status))).length,
      approvals: queue.filter(item => /approval|blocked/i.test(text(item?.status))).length,
      failed: queue.filter(item => /failed/i.test(text(item?.status))).length
    };
  }

  collect(options = {}) {
    const live = this.liveState.collect(options.liveOptions || {});
    const supplemental = this.collectSupplementalState(
      options.supplementalState || {}
    );
    const business = {
      ...(live.business || {})
    };

    for (const domain of Object.keys(OPTIONAL_STATE_FILES)) {
      business[domain] = rows(supplemental[domain]);
    }

    const queue = this.collectQueueState();

    return {
      ok: true,
      type: "BUSINESS_STATE_DISCOVERY",
      generatedAt: nowIso(),
      business,
      queue,
      counts: Object.fromEntries(
        Object.entries(business).map(([name, value]) => [
          name,
          Array.isArray(value) ? value.length : 0
        ])
      ),
      sources: {
        live: live.sources || {},
        supplemental: Object.keys(supplemental)
      },
      desiredState: {
        monthlyRevenueTarget: this.monthlyRevenueTarget,
        minimumActiveCampaigns: 2,
        maximumReplyResponseHours: 24,
        minimumProposalLeadDays: 3,
        maximumClientSilenceDays: 14
      }
    };
  }

  detectVisibilityGaps(state) {
    const findings = [];
    for (const [domain, execution] of Object.entries(VISIBILITY_PROFILES)) {
      const collection = state.business[domain];
      if (Array.isArray(collection) && collection.length) continue;
      findings.push(
        finding({
          domain,
          category: "BUSINESS_VISIBILITY",
          status: "PARTIAL",
          score: 55,
          message: `No current ${domain} state is available; refresh visibility before autonomous decisions are made.`,
          execution,
          cooldownMs: 12 * 60 * 60 * 1000
        })
      );
    }
    return findings;
  }

  detectRevenueGaps(state) {
    const business = state.business;
    const findings = [];
    const replies = business.replies || [];
    const campaigns = business.campaigns || [];
    const deals = business.deals || [];
    const proposals = business.proposals || [];
    const clients = business.clients || [];
    const approvals = business.approvals || [];
    const revenue = business.revenue || [];

    const unclassified = replies.filter(
      item => !text(item.classification || item.category || item.intent)
    );
    if (unclassified.length) {
      findings.push(finding({
        domain: "replies",
        category: "FOLLOW_UP",
        status: "CRITICAL",
        score: 25,
        subject: "unclassified",
        message: `${unclassified.length} reply record(s) require classification and next-action creation.`,
        evidence: { count: unclassified.length },
        execution: profile("MarketingProvider", "refresh", "revenue.replies.classify", "Revenue Operations", "InstantlyExecutiveAdvisor"),
        cooldownMs: 60 * 60 * 1000
      }));
    }

    const activeCampaigns = campaigns.filter(item =>
      /active|running|enabled|launched/.test(status(item.status))
    );
    if (campaigns.length && activeCampaigns.length < 2) {
      findings.push(finding({
        domain: "campaigns",
        category: "MARKETING_GAP",
        status: "WARNING",
        score: 55,
        subject: "active-coverage",
        message: `Only ${activeCampaigns.length} active campaign(s) are visible; safe outbound coverage requires review.`,
        evidence: { total: campaigns.length, active: activeCampaigns.length },
        execution: VISIBILITY_PROFILES.campaigns
      }));
    }

    const now = Date.now();
    const overdueDeals = deals.filter(item => {
      const next = timestamp(item);
      return next && next < now && !/closed|lost|won/.test(status(item.status));
    });
    if (overdueDeals.length) {
      findings.push(finding({
        domain: "deals",
        category: "PIPELINE",
        status: "CRITICAL",
        score: 30,
        subject: "overdue-next-actions",
        message: `${overdueDeals.length} active deal(s) have an overdue follow-up or next action.`,
        evidence: { count: overdueDeals.length },
        execution: profile("MILES", "PIPELINE_REVIEW", "revenue.pipeline.followup", "Sales", "SalesExecutiveAdvisor"),
        cooldownMs: 2 * 60 * 60 * 1000
      }));
    }

    const urgentProposals = proposals.filter(item => {
      const due = timestamp(item);
      const remaining = due === null ? null : due - now;
      return remaining !== null && remaining >= 0 && remaining <= 3 * DAY_MS;
    });
    if (urgentProposals.length) {
      findings.push(finding({
        domain: "proposals",
        category: "DEADLINE",
        status: "CRITICAL",
        score: 20,
        subject: "due-within-72-hours",
        message: `${urgentProposals.length} proposal(s) are due within 72 hours and require readiness review.`,
        evidence: { count: urgentProposals.length },
        execution: profile("MILES", "PROPOSAL_DEADLINE_REVIEW", "proposal.deadline.review", "Capture", "ProposalExecutiveAdvisor"),
        cooldownMs: 60 * 60 * 1000
      }));
    }

    const atRiskClients = clients.filter(item =>
      /risk|warning|critical|churn|overdue|unhappy/.test(
        status(item.health || item.status || item.risk)
      )
    );
    if (atRiskClients.length) {
      findings.push(finding({
        domain: "clients",
        category: "CLIENT_HEALTH",
        status: "CRITICAL",
        score: 25,
        subject: "at-risk",
        message: `${atRiskClients.length} client(s) are marked at risk and require a governed success action.`,
        evidence: { count: atRiskClients.length },
        execution: VISIBILITY_PROFILES.clients,
        cooldownMs: 4 * 60 * 60 * 1000
      }));
    }

    const pendingApprovals = approvals.filter(item =>
      /pending|waiting|requested|blocked/.test(status(item.status))
    );
    const approvalCount = Math.max(pendingApprovals.length, state.queue.approvals);
    if (approvalCount) {
      findings.push(finding({
        domain: "approvals",
        category: "GOVERNANCE",
        status: "WARNING",
        score: 50,
        subject: "pending",
        message: `${approvalCount} approval item(s) require routing or CEO decision.`,
        evidence: { count: approvalCount },
        execution: VISIBILITY_PROFILES.approvals,
        cooldownMs: 4 * 60 * 60 * 1000
      }));
    }

    const currentRevenue = revenue.reduce(
      (sum, item) =>
        sum + number(item.mtdRevenue ?? item.monthToDate ?? item.revenue ?? item.amount),
      0
    );
    if (revenue.length && currentRevenue < this.monthlyRevenueTarget) {
      findings.push(finding({
        domain: "revenue",
        category: "REVENUE_TARGET",
        status: "WARNING",
        score: 45,
        subject: "monthly-gap",
        message: `Month-to-date revenue is $${currentRevenue.toFixed(2)} against the $${this.monthlyRevenueTarget.toFixed(2)} target.`,
        evidence: {
          currentRevenue,
          target: this.monthlyRevenueTarget,
          gap: this.monthlyRevenueTarget - currentRevenue
        },
        execution: VISIBILITY_PROFILES.revenue,
        cooldownMs: 12 * 60 * 60 * 1000
      }));
    }

    return findings;
  }

  discover(options = {}) {
    const startedAt = Date.now();
    const state = this.collect(options);
    const raw = [
      ...this.detectRevenueGaps(state),
      ...this.detectVisibilityGaps(state)
    ];
    const seen = new Set();
    const findings = raw.filter(item => {
      if (seen.has(item.findingKey)) return false;
      seen.add(item.findingKey);
      return true;
    });

    return {
      ok: true,
      type: "BUSINESS_STATE_GAP_ANALYSIS",
      generatedAt: nowIso(),
      durationMs: Date.now() - startedAt,
      state,
      findings,
      summary: {
        domains: Object.keys(state.business).length,
        findings: findings.length,
        critical: findings.filter(item => item.status === "CRITICAL").length,
        visibilityGaps: findings.filter(item => item.category === "BUSINESS_VISIBILITY").length
      }
    };
  }
}

module.exports = BusinessStateDiscoveryEngine;
