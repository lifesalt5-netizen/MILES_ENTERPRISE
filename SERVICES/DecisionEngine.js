"use strict";

const fs = require("fs");
const path = require("path");
const taskManager = require("./TaskManager");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";

function now() {
  return new Date().toISOString();
}

function readJson(rel, fallback = null) {
  try {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function countCsv(rel) {
  try {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) return 0;
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return 0;
    return Math.max(text.split(/\r?\n/).length - 1, 0);
  } catch {
    return 0;
  }
}

function scoreRisk(providerResult = {}) {
  const exceptions = providerResult.exceptions || [];
  const criticalCount = exceptions.filter(e => String(e.severity || "").toLowerCase() === "critical").length;
  const warningCount = exceptions.filter(e => String(e.severity || "").toLowerCase() === "warning").length;

  if (criticalCount > 0) {
    return {
      ok: false,
      risk: "HIGH",
      criticalCount,
      warningCount,
      reason: `${criticalCount} critical exception(s) detected.`
    };
  }

  if (warningCount > 0) {
    return {
      ok: true,
      risk: "MEDIUM",
      criticalCount,
      warningCount,
      reason: `${warningCount} warning exception(s) detected.`
    };
  }

  return {
    ok: true,
    risk: "LOW",
    criticalCount,
    warningCount,
    reason: "No material provider risk detected."
  };
}

function resolveAuthority(provider, action, capability) {
  const text = [provider, action, capability].filter(Boolean).join(" ").toLowerCase();

  if (/delete|destroy|purge|drop|remove database/.test(text)) {
    return {
      ok: false,
      authority: "CEO_APPROVAL_REQUIRED",
      approvalRequired: true,
      reason: "Destructive data action requires CEO approval."
    };
  }

  if (/pricing|price|contract|agreement|signature|legal|hire|payment|invoice/.test(text)) {
    return {
      ok: false,
      authority: "CEO_APPROVAL_REQUIRED",
      approvalRequired: true,
      reason: "Financial, legal, pricing, contract, hiring, or payment action requires CEO approval."
    };
  }

  if (/launch|send proposal|send contract|publish|dns|domain/.test(text)) {
    return {
      ok: false,
      authority: "CEO_APPROVAL_REQUIRED",
      approvalRequired: true,
      reason: "External publishing, sending, domain, or launch action requires CEO approval."
    };
  }

  return {
    ok: true,
    authority: "MILES_OPERATIONAL",
    approvalRequired: false,
    provider: provider || "",
    reason: "Action is within MILES operational authority."
  };
}

class DecisionEngine {
  observe() {
    const latestCycle = readJson("DATA/runtime/latest_coo_cycle.json", {});
    const latestHealth = readJson("DATA/executive/latest_universal_health.json", {});
    const latestBacklog = readJson("DATA/capability_backlog/latest_capability_backlog.json", {});
    const latestRepair = readJson("DATA/autonomous_repair/latest_repair_plan.json", {});
    const latestAutonomy = readJson("DATA/executive/latest_autonomy_scorecard.json", {});

    return {
      generatedAt: now(),
      queue: {
        queued: taskManager.list("QUEUED").length,
        running: taskManager.list("RUNNING").length,
        failed: taskManager.list("FAILED").length
      },
      business: {
        segments: countCsv("masters/SEGMENT_INVENTORY.csv"),
        campaigns: countCsv("masters/CAMPAIGN_MASTER.csv"),
        domains: countCsv("masters/DOMAIN_MASTER.csv")
      },
      runtime: {
        latestCycleId: latestCycle.cycleId || null,
        businessHealth: latestCycle.businessHealth || null,
        healthScore: latestCycle.healthScore || latestHealth.overallScore || null,
        autonomyScore: latestCycle.autonomy?.overall || latestAutonomy.overall || null,
        autonomyLevel: latestCycle.autonomy?.level || latestAutonomy.level || null,
        failedTasks: latestCycle.queue?.failed || latestHealth.systems?.find(s => s.area === "Runtime")?.metrics?.failed || 0,
        pendingTasks: latestCycle.queue?.pending || 0,
        completedTasks: latestCycle.queue?.completed || 0
      },
      health: latestHealth,
      repair: latestRepair,
      backlog: latestBacklog
    };
  }

  analyze() {
    const state = this.observe();
    const decisions = [];

    // BUILD123A - Prefer live queue state over stale runtime snapshots
    const failedTaskCount = Number(
      state.queue?.failed ??
      state.runtime?.failedTasks ??
      0
    );

    if (failedTaskCount > 0) {
      decisions.push({
        priority: 95,
        type: "ENGINEERING_REPAIR",
        system: "Engineering",
        connector: "Engineering",
        capability: "engineering.runtime.repair",
        reason: `${failedTaskCount} failed task(s) detected. Engineering COO should classify, repair, archive, or escalate.`,
        businessImpact: "Very High"
      });
    }

    if ((state.business.campaigns > 0 || state.health.systems?.some(s => s.area === "Marketing")) && state.queue.queued < 5) {
      decisions.push({
        priority: 85,
        type: "OUTBOUND_REVIEW",
        system: "Marketing",
        connector: "Instantly",
        capability: "marketing.execution.route",
        reason: "Outbound operations exist and should be monitored for campaign health, deliverability, and safe revenue generation.",
        businessImpact: "Very High"
      });
    }

    if (state.backlog.openGaps > 0) {
      const topGap = (state.backlog.gaps || []).sort((a, b) => a.priority - b.priority)[0];

      decisions.push({
        priority: topGap?.priority === 1 ? 82 : 70,
        type: "CAPABILITY_GAP_REVIEW",
        system: "Engineering",
        connector: "Engineering",
        capability: "engineering.capability.backlog",
        reason: topGap ? `Top capability gap: ${topGap.title}` : "Capability gaps exist and should be reviewed.",
        businessImpact: topGap?.businessImpact || "High",
        gap: topGap || null
      });
    }

    if (state.business.segments > 0 && state.business.campaigns > 0) {
      decisions.push({
        priority: 80,
        type: "SEGMENT_CAMPAIGN_ALIGNMENT",
        system: "Marketing",
        connector: "Instantly",
        capability: "marketing.segment.routing",
        reason: "Segments and campaigns both exist. MILES should ensure lead segments are mapped to the right outreach campaigns.",
        businessImpact: "High"
      });
    }

    if (state.runtime.autonomyScore !== null && state.runtime.autonomyScore < 80) {
      decisions.push({
        priority: 78,
        type: "AUTONOMY_IMPROVEMENT",
        system: "Executive",
        connector: "Engineering",
        capability: "executive.autonomy.improve",
        reason: `Autonomy score is ${state.runtime.autonomyScore}. Improve verification, learning, repair, and department coverage.`,
        businessImpact: "Very High"
      });
    }

    if (decisions.length === 0) {
      decisions.push({
        priority: 60,
        type: "OPERATING_CHECK",
        system: "Executive",
        connector: "MILES",
        capability: "executive.operating.check",
        reason: "No urgent issue detected. Continue monitoring executive state, campaigns, ORION, and runtime health.",
        businessImpact: "Medium"
      });
    }

    return {
      state,
      decisions: decisions.sort((a, b) => b.priority - a.priority)
    };
  }

  evaluate(input = {}) {
    const providerResult = input.providerResult || {};
    const provider = input.provider || providerResult.provider || "";
    const action = input.action || providerResult.action || "";
    const capability = input.capability || providerResult.capability || "";

    const authority = resolveAuthority(provider, action, capability);
    const risk = scoreRisk(providerResult);

    const confidenceScore =
      providerResult.ok === false ? 35 :
      risk.risk === "HIGH" ? 40 :
      risk.risk === "MEDIUM" ? 70 :
      100;

    const confidence =
      confidenceScore >= 85 ? "HIGH" :
      confidenceScore >= 60 ? "MEDIUM" :
      "LOW";

    const approvalRequired = authority.approvalRequired || risk.risk === "HIGH";
    const decision = approvalRequired ? "ESCALATE" : providerResult.ok === false ? "REVIEW" : "PROCEED";

    return {
      ok: decision === "PROCEED",
      type: "MILES_DECISION",
      decision,
      authority,
      risk,
      policy: {
        ok: true,
        policies: this.resolvePolicies(provider, action, capability),
        policyCount: this.resolvePolicies(provider, action, capability).length
      },
      confidence: {
        ok: confidenceScore >= 60,
        confidenceScore,
        confidence
      },
      approval: {
        ok: !approvalRequired,
        approvalRequired,
        status: approvalRequired ? "CEO_APPROVAL_REQUIRED" : "APPROVED_FOR_AUTONOMOUS_EXECUTION",
        reason: approvalRequired ? authority.reason || risk.reason : "Decision is approved for autonomous execution."
      },
      createdAt: now()
    };
  }

  resolvePolicies(provider, action, capability) {
    const text = [provider, action, capability].filter(Boolean).join(" ").toLowerCase();
    const policies = [];

    if (/marketing|instantly|campaign|email|outbound/.test(text)) {
      policies.push({
        policy: "Marketing Safety",
        status: "ACTIVE",
        rule: "MILES may review campaign health and recommend action, but unsafe sending changes require approval."
      });
    }

    if (/engineering|repair|runtime|self/.test(text)) {
      policies.push({
        policy: "Engineering Self-Repair",
        status: "ACTIVE",
        rule: "MILES may classify, retry safe failures, and move obsolete failures to backlog; core architecture changes require approval."
      });
    }

    if (/orion|database|contractor|buyer/.test(text)) {
      policies.push({
        policy: "ORION Data Safety",
        status: "ACTIVE",
        rule: "MILES may read, audit, and report ORION data; destructive database changes require approval."
      });
    }

    if (policies.length === 0) {
      policies.push({
        policy: "General COO Authority",
        status: "ACTIVE",
        rule: "MILES may execute operational actions that do not change pricing, contracts, legal commitments, payments, domains, or destructive data."
      });
    }

    return policies;
  }

  queueDecisions() {
    const { decisions } = this.analyze();

    return decisions.map(d =>
      taskManager.create(d.type, d, d.priority)
    );
  }
}

module.exports = new DecisionEngine();
