"use strict";

const fs = require("fs");
const path = require("path");

const ExecutiveIntelligenceService = require("./ExecutiveIntelligenceService");
const ExecutiveBriefService = require("./ExecutiveBriefService");
const WorkQueueService = require("./WorkQueueService");
const WorkflowService = require("./WorkflowService");
const BusinessOperationsBridgeService = require("./BusinessOperationsBridgeService");

let learningEngine = null;
let taskQueue = null;

try {
  learningEngine = require("./Learning/LearningEngine");
} catch {
  learningEngine = null;
}

try {
  taskQueue = require("../CORE/TaskQueue");
} catch {
  taskQueue = null;
}

const ROOT = process.env.MILES_ROOT || process.cwd();

function now() {
  return new Date().toISOString();
}

function scoreStatus(status) {
  const value = String(status || "Unknown").toLowerCase();

  if (value === "healthy" || value === "operational" || value === "running") return 100;
  if (value === "watch" || value === "warning" || value === "partial") return 75;
  if (value === "critical" || value === "failed" || value === "down") return 25;
  if (value === "unknown") return 50;

  return 65;
}

function normalizePriority(value) {
  const text = String(value || "").toUpperCase();

  if (text === "CRITICAL" || value === 1) return 1;
  if (text === "HIGH" || value === 2) return 2;
  if (text === "MEDIUM" || value === 3) return 3;
  if (text === "LOW" || value === 4) return 4;

  return Number(value) || 3;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

class AutonomousCOOLoopService {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs || 5 * 60 * 1000;
    this.maxCycles = options.maxCycles || null;
    this.maxExecutionPasses = options.maxExecutionPasses || 5;
    this.enableExecution = options.enableExecution !== false;
    this.enableWorkflowQueueing = options.enableWorkflowQueueing !== false;
    this.cyclesRun = 0;
    this.running = false;

    this.outputDir =
      options.outputDir ||
      path.join(ROOT, "DATA", "executive");

    this.runtimeDir = path.join(ROOT, "DATA", "runtime");
    this.repairDir = path.join(ROOT, "DATA", "autonomous_repair");
    this.backlogDir = path.join(ROOT, "DATA", "capability_backlog");

    this.intelligence = options.intelligence || new ExecutiveIntelligenceService();
    this.workQueue = options.workQueue || new WorkQueueService();
    this.workflowService = options.workflowService || WorkflowService;
    this.executionService = options.executionService || null;

    this.businessBridge =
      options.businessBridge ||
      new BusinessOperationsBridgeService({
        taskQueue
      });
  }

  async runOnce() {
    this.cyclesRun += 1;

    const startedAt = now();
    const cycleId = `COO-${startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${String(this.cyclesRun).padStart(3, "0")}`;

    await this.intelligence.refresh();

    const bridgeResults = await this.processBusinessOperationsBridge();

    const executiveState = await this.intelligence.getExecutiveState();
    const health = this.buildUniversalHealth(executiveState);
    const mission = this.buildMissionPlan(executiveState, health, cycleId);
    const repairPlan = this.buildRepairPlan(executiveState, health, mission, cycleId);
    const backlog = this.buildCapabilityBacklog(executiveState, health, cycleId);

    const workCreated = this.createMissionWork(mission, repairPlan, backlog);
    const workflowResults = this.enableWorkflowQueueing ? this.queueAuthorizedWorkflows() : [];
    const executionResults = this.enableExecution ? await this.runExecutionPasses() : [];

    await this.intelligence.refresh();

    const refreshedExecutiveState = await this.intelligence.getExecutiveState();
    const refreshedHealth = this.buildUniversalHealth(refreshedExecutiveState);
    const executiveBrief = new ExecutiveBriefService(refreshedExecutiveState);
    const learning = this.buildLearningSnapshot();
    const autonomy = this.scoreAutonomy(refreshedHealth, mission, repairPlan, backlog, learning);

    const result = {
      ok: true,
      type: "MILES_AUTONOMOUS_COO_CYCLE",
      cycleId,
      cycle: this.cyclesRun,
      startedAt,
      completedAt: now(),
      mode: {
        workflowQueueing: this.enableWorkflowQueueing,
        execution: this.enableExecution,
        maxExecutionPasses: this.maxExecutionPasses
      },
      businessOperationsBridge: bridgeResults,
      businessHealth: refreshedExecutiveState.businessHealth,
      autonomy,
      health: refreshedHealth,
      mission,
      repairPlan,
      capabilityBacklog: backlog,
      workCreated,
      workflowResults,
      executionResults,
      queue: this.safeQueueStats(),
      learning,
      executiveState: refreshedExecutiveState,
      executiveBrief: executiveBrief.generate()
    };

    this.writeOutputs(result, executiveBrief);

    return result;
  }

  async processBusinessOperationsBridge() {
    try {
      if (
        this.businessBridge &&
        typeof this.businessBridge.runOnce === "function"
      ) {
        const result = await this.businessBridge.runOnce();

        return {
          ok: true,
          status: "BUSINESS_OPERATIONS_BRIDGE_RAN",
          operationsFound:
            result.operationsFound ??
            result.found ??
            result.total ??
            0,
          operationsQueued:
            result.operationsQueued ??
            result.bridged ??
            result.queued ??
            0,
          operationsFailed:
            result.operationsFailed ??
            result.failed ??
            0,
          raw: result
        };
      }

      return {
        ok: false,
        status: "BUSINESS_OPERATIONS_BRIDGE_UNAVAILABLE",
        operationsFound: 0,
        operationsQueued: 0,
        operationsFailed: 0
      };
    } catch (error) {
      return {
        ok: false,
        status: "BUSINESS_OPERATIONS_BRIDGE_FAILED",
        operationsFound: 0,
        operationsQueued: 0,
        operationsFailed: 1,
        error: error.message
      };
    }
  }

  buildUniversalHealth(executiveState = {}) {
    const providerStates = executiveState.providers || [];

    const providerHealth = providerStates.map(provider => {
      const exceptions = provider.exceptions || [];
      const critical = exceptions.filter(e => e.severity === "Critical").length;
      const warning = exceptions.filter(e => e.severity === "Warning").length;
      let score = scoreStatus(provider.status);

      score -= critical * 35;
      score -= warning * 12;
      score = Math.max(0, Math.min(100, score));

      return {
        area: provider.provider || "Unknown Provider",
        status: provider.status || "Unknown",
        score,
        risk: score < 40 ? "HIGH" : score < 75 ? "MEDIUM" : "LOW",
        confidence: provider.dataFreshness === "Live" ? "HIGH" : "MEDIUM",
        lastSuccess: provider.lastRefresh || null,
        lastFailure: critical > 0 ? now() : null,
        exceptions,
        recommendations: provider.recommendations || [],
        metrics: provider.metrics || {},
        sourceSystems: provider.sourceSystems || [],
        dependencies: provider.dependencies || []
      };
    });

    const taskStatus =
      taskQueue && typeof taskQueue.getStatus === "function"
        ? taskQueue.getStatus()
        : { total: 0, pending: 0, running: 0, completed: 0, failed: 0 };

    const queueStats = this.safeQueueStats();
    const runtimeScore = taskStatus.failed > 0 ? 82 : 96;

    const runtimeHealth = {
      area: "Runtime",
      status: runtimeScore >= 90 ? "Healthy" : "Watch",
      score: runtimeScore,
      risk: runtimeScore >= 90 ? "LOW" : "MEDIUM",
      confidence: "HIGH",
      lastSuccess: now(),
      lastFailure: taskStatus.failed > 0 ? now() : null,
      exceptions:
        taskStatus.failed > 0
          ? [
              {
                type: "TaskFailures",
                severity: "Warning",
                message: `${taskStatus.failed} failed runtime task(s) detected.`
              }
            ]
          : [],
      recommendations:
        taskStatus.failed > 0
          ? ["Review failed task details and queue safe repair work."]
          : ["Runtime is operational."],
      metrics: taskStatus
    };

    const workQueueHealth = {
      area: "WorkQueue",
      status: queueStats.escalations > 0 ? "Watch" : "Healthy",
      score: queueStats.escalations > 0 ? 78 : 96,
      risk: queueStats.escalations > 0 ? "MEDIUM" : "LOW",
      confidence: "HIGH",
      lastSuccess: now(),
      lastFailure: null,
      exceptions:
        queueStats.escalations > 0
          ? [
              {
                type: "Escalations",
                severity: "Warning",
                message: `${queueStats.escalations} Kevin-level escalation(s) open.`
              }
            ]
          : [],
      recommendations:
        queueStats.escalations > 0
          ? ["Review CEO approval queue and resolve blocked decisions."]
          : ["Work queue has no Kevin-level blocker."],
      metrics: queueStats
    };

    const systems = [runtimeHealth, workQueueHealth, ...providerHealth];

    const averageScore = systems.length
      ? Math.round(
          systems.reduce((sum, item) => sum + item.score, 0) / systems.length
        )
      : 0;

    return {
      ok: true,
      generatedAt: now(),
      overallScore: averageScore,
      overallStatus:
        averageScore >= 90
          ? "Healthy"
          : averageScore >= 70
          ? "Watch"
          : "Critical",
      highRiskCount: systems.filter(s => s.risk === "HIGH").length,
      mediumRiskCount: systems.filter(s => s.risk === "MEDIUM").length,
      lowRiskCount: systems.filter(s => s.risk === "LOW").length,
      systems
    };
  }

  buildMissionPlan(executiveState = {}, health = {}, cycleId = null) {
    const priorities = [];
    const recommendations = executiveState.recommendations || [];
    const exceptions = executiveState.exceptions || [];
    const business = executiveState.business || {};
    const campaigns = Array.isArray(business.campaigns) ? business.campaigns : [];
    const replies = Array.isArray(business.replies) ? business.replies : [];
    const proposals = Array.isArray(business.proposals) ? business.proposals : [];
    const deals = Array.isArray(business.deals) ? business.deals : [];
    const opportunities = Array.isArray(business.opportunities) ? business.opportunities : [];
    const contractors = Array.isArray(business.contractors) ? business.contractors : [];
    const marketing = executiveState.marketing || {
      totalCampaigns: campaigns.length,
      activeCampaigns: campaigns.filter(c => /active|running|enabled/i.test(String(c.status || ""))).length
    };
    const orion = executiveState.orion || {
      contractors: contractors.length,
      opportunities: opportunities.length
    };

    if (replies.length > 0) {
      priorities.push(
        this.missionItem({
          priority: 1,
          area: "Sales",
          title: `Process ${replies.length} inbound prospect or client repl${replies.length === 1 ? "y" : "ies"}`,
          objective: `Review and classify ${replies.length} inbound replies and create required follow-up work`,
          reason: `${replies.length} inbound reply record(s) are available in current business state.`,
          recommendedAction: "Classify replies, identify positive responses, create follow-ups, and escalate protected client commitments.",
          expectedImpact: "Protects revenue opportunities and response speed.",
          requiresKevin: false,
          relatedProvider: "Marketing",
          metadata: { replyCount: replies.length, cycleId }
        })
      );
    }

    const urgentProposals = proposals.filter(p => {
      const due = p.dueDate || p.deadline || p.closeDate;
      if (!due) return false;
      const ms = new Date(due).getTime() - Date.now();
      return Number.isFinite(ms) && ms >= 0 && ms <= 72 * 60 * 60 * 1000;
    });

    if (urgentProposals.length > 0) {
      priorities.push(
        this.missionItem({
          priority: 1,
          area: "Sales",
          title: `Prepare ${urgentProposals.length} proposal deadline action(s)`,
          objective: `Review urgent proposal deadlines and prepare compliance and submission readiness actions`,
          reason: `${urgentProposals.length} proposal(s) are due within 72 hours.`,
          recommendedAction: "Prepare compliance review, missing-input list, and CEO approval items for any protected submission action.",
          expectedImpact: "Protects active client pursuits and proposal deadlines.",
          requiresKevin: false,
          relatedProvider: null,
          metadata: { urgentProposals, cycleId }
        })
      );
    }

    if (deals.length > 0) {
      priorities.push(
        this.missionItem({
          priority: 2,
          area: "Sales",
          title: "Review active revenue pipeline",
          objective: "Review active deals and generate overdue follow-up and next-action work",
          reason: `${deals.length} active deal record(s) are present.`,
          recommendedAction: "Prioritize deals by value, probability, recency, and missing next action.",
          expectedImpact: "Improves close rate and revenue visibility.",
          requiresKevin: false,
          relatedProvider: null,
          metadata: { dealCount: deals.length, cycleId }
        })
      );
    }

    for (const system of health.systems || []) {
      if (system.risk === "HIGH") {
        priorities.push(
          this.missionItem({
            priority: 1,
            area: system.area,
            title: `Repair high-risk ${system.area} condition`,
            reason: `${system.area} health score is ${system.score}.`,
            recommendedAction:
              (system.recommendations || [])[0] ||
              `Investigate ${system.area} immediately.`,
            expectedImpact:
              "Protects operating continuity and removes an autonomy blocker.",
            requiresKevin: false,
            relatedProvider: system.area,
            metadata: { health: system, cycleId }
          })
        );
      }

      if (system.risk === "MEDIUM") {
        priorities.push(
          this.missionItem({
            priority: 2,
            area: system.area,
            title: `Investigate ${system.area} watch condition`,
            reason: `${system.area} is in Watch status with score ${system.score}.`,
            recommendedAction:
              (system.recommendations || [])[0] ||
              `Audit ${system.area} and recommend next action.`,
            expectedImpact:
              "Prevents small operational issues from becoming business blockers.",
            requiresKevin: false,
            relatedProvider: system.area,
            metadata: { health: system, cycleId }
          })
        );
      }
    }

    if ((marketing.totalCampaigns || 0) > 0 && (marketing.activeCampaigns || 0) < 2) {
      priorities.push(
        this.missionItem({
          priority: 1,
          area: "Marketing",
          title: "Increase safe outbound operating coverage",
          reason: `Only ${marketing.activeCampaigns || 0} active campaign(s) detected out of ${marketing.totalCampaigns || 0}.`,
          recommendedAction:
            "Audit paused Instantly campaigns, deliverability risk, inbox capacity, and safe resume options.",
          expectedImpact: "Improves lead generation and revenue pipeline.",
          requiresKevin: false,
          relatedProvider: "Marketing",
          metadata: { marketing, cycleId }
        })
      );
    }

    if ((orion.contractors || 0) > 0 && (orion.opportunities || 0) > 0) {
      priorities.push(
        this.missionItem({
          priority: 2,
          area: "ORION",
          title: "Keep ORION intelligence fresh for revenue decisions",
          reason:
            "ORION has usable contractor and opportunity data and should remain current.",
          recommendedAction:
            "Audit ORION health, counts, recommendations, personas, and missing intelligence layers.",
          expectedImpact:
            "Protects demo readiness, opportunity intelligence, and contractor recommendations.",
          requiresKevin: false,
          relatedProvider: "ORION",
          metadata: { orion, cycleId }
        })
      );
    }

    for (const exception of exceptions) {
      const severity = exception.severity || "Info";

      priorities.push(
        this.missionItem({
          priority:
            severity === "Critical" ? 1 : severity === "Warning" ? 2 : 3,
          area: exception.type || exception.provider || "Operations",
          title: `${severity} exception: ${
            exception.type || exception.provider || "Unknown"
          }`,
          reason: exception.message || "Provider reported an exception.",
          recommendedAction:
            severity === "Critical"
              ? "Investigate immediately and repair if within governance."
              : "Investigate and monitor.",
          expectedImpact:
            severity === "Critical"
              ? "Prevents interruption to autonomous operations."
              : "Reduces operational risk.",
          requiresKevin:
            severity === "Critical" &&
            /delete|price|contract|legal|publish|dns/i.test(
              exception.message || ""
            ),
          relatedProvider: exception.provider || null,
          metadata: { exception, cycleId }
        })
      );
    }

    for (const recommendation of recommendations.slice(0, 10)) {
      priorities.push(
        this.missionItem({
          priority: 3,
          area: "Executive",
          title: `Act on recommendation: ${String(recommendation).slice(
            0,
            80
          )}`,
          reason:
            "Provider recommendation generated during executive intelligence refresh.",
          recommendedAction: String(recommendation),
          expectedImpact:
            "Improves operations based on live provider findings.",
          requiresKevin: false,
          relatedProvider: null,
          metadata: { recommendation, cycleId }
        })
      );
    }

    if (priorities.length === 0) {
      priorities.push(
        this.missionItem({
          priority: 3,
          area: "Executive",
          title: "Run autonomous operating check",
          reason:
            "No urgent issues detected; MILES should continue monitoring and verification.",
          recommendedAction:
            "Refresh executive state, verify providers, and prepare next operating brief.",
          expectedImpact: "Maintains operational visibility.",
          requiresKevin: false,
          relatedProvider: null,
          metadata: { cycleId }
        })
      );
    }

    const deduped = this.deduplicateMissionItems(priorities)
      .sort(
        (a, b) =>
          a.priority - b.priority ||
          b.businessImpactScore - a.businessImpactScore
      )
      .slice(0, 12);

    return {
      ok: true,
      cycleId,
      generatedAt: now(),
      objective:
        "Move MILES closer to autonomous Digital COO operation for P2GC today.",
      priorities: deduped,
      topPriority: deduped[0] || null,
      autonomousCount: deduped.filter(p => !p.requiresKevin).length,
      escalationCount: deduped.filter(p => p.requiresKevin).length
    };
  }

  missionItem(input = {}) {
    const priority = normalizePriority(input.priority);

    const businessImpactScore =
      priority === 1 ? 95 : priority === 2 ? 80 : priority === 3 ? 60 : 40;

    return {
      id: `MISSION-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      priority,
      area: input.area || "Operations",
      title: input.title || "Untitled mission item",
      objective: input.objective || this.operationalObjectiveFor(input),
      reason: input.reason || "No reason provided.",
      recommendedAction:
        input.recommendedAction || "Investigate and recommend next action.",
      expectedImpact: input.expectedImpact || "Improves P2GC operations.",
      owner: input.owner || "Miles",
      requiresKevin: Boolean(input.requiresKevin),
      relatedProvider: input.relatedProvider || null,
      businessImpactScore,
      automationConfidence:
        input.automationConfidence || (input.requiresKevin ? "MEDIUM" : "HIGH"),
      metadata: input.metadata || {}
    };
  }


  operationalObjectiveFor(input = {}) {
    const area = String(input.area || "").toLowerCase();
    const title = String(input.title || "");
    const action = String(input.recommendedAction || "");
    const text = `${title} ${action}`;

    if (/website|b12|homepage|cta|form|calendly|ssl/i.test(`${area} ${text}`)) {
      return /repair|failed|failure|critical|down/i.test(text)
        ? `Repair Website: ${title}`
        : "Verify website health, CTA, form, Calendly, SSL, and availability";
    }

    if (/instantly|campaign|outbound|deliverability|bounce|warmup|inbox/i.test(`${area} ${text}`)) {
      return "Audit Instantly campaign health, deliverability, bounce risk, and inbox capacity";
    }

    if (/orion|contractor|opportunity|recompete|government data/i.test(`${area} ${text}`)) {
      return "Refresh ORION data and verify contractor and opportunity intelligence";
    }

    if (/sales|reply|deal|proposal|pipeline|follow-up|client/i.test(`${area} ${text}`)) {
      return input.objective || `Evaluate revenue operation: ${title}`;
    }

    if (/runtime|workqueue|engineering|service|connector/i.test(`${area} ${text}`)) {
      return `Evaluate operating issue and create an authorized repair plan: ${title}`;
    }

    return input.objective || `Evaluate objective: ${title}`;
  }

  deduplicateMissionItems(items = []) {
    const seen = new Set();
    const output = [];

    for (const item of items) {
      const key = `${item.area}::${item.title}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }

    return output;
  }

  buildRepairPlan(executiveState = {}, health = {}, mission = {}, cycleId = null) {
    const repairs = [];

    for (const system of health.systems || []) {
      for (const exception of system.exceptions || []) {
        const safeRepair = this.classifyRepair(system, exception);

        repairs.push({
          id: `REPAIR-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          cycleId,
          area: system.area,
          severity: exception.severity || "Info",
          title: `Repair ${system.area}: ${
            exception.type || "Operational issue"
          }`,
          objective: this.operationalObjectiveFor({
            area: system.area,
            title: `Repair ${system.area}: ${exception.type || "Operational issue"}`,
            recommendedAction: safeRepair.recommendedRepair
          }),
          problem: exception.message || "No message provided.",
          safeAutonomous: safeRepair.safeAutonomous,
          requiresKevin: safeRepair.requiresKevin,
          recommendedRepair: safeRepair.recommendedRepair,
          verification: safeRepair.verification,
          rollback: safeRepair.rollback,
          status: safeRepair.requiresKevin ? "AWAITING_APPROVAL" : "READY",
          source: "AutonomousCOOLoopService",
          createdAt: now(),
          metadata: { system, exception }
        });
      }
    }

    return {
      ok: true,
      cycleId,
      generatedAt: now(),
      total: repairs.length,
      ready: repairs.filter(r => r.status === "READY").length,
      awaitingApproval: repairs.filter(r => r.status === "AWAITING_APPROVAL")
        .length,
      repairs
    };
  }

  classifyRepair(system = {}, exception = {}) {
    const text = `${system.area || ""} ${exception.type || ""} ${
      exception.message || ""
    }`.toLowerCase();

    if (/delete|pricing|price|contract|legal|publish|dns|domain|payment|hire/.test(text)) {
      return {
        safeAutonomous: false,
        requiresKevin: true,
        recommendedRepair:
          "Prepare diagnosis and request CEO approval before action.",
        verification:
          "Verify CEO approval is recorded before any protected action.",
        rollback: "No autonomous change performed."
      };
    }

    if (/api|connect|key|login|session|browser/.test(text)) {
      return {
        safeAutonomous: true,
        requiresKevin: false,
        recommendedRepair:
          "Refresh provider state, retry connector/browser session, and record diagnostics.",
        verification:
          "Provider refresh succeeds or a clear escalation is recorded.",
        rollback:
          "Revert to previous cached state and preserve failure diagnostics."
      };
    }

    if (/campaign|paused|active|outbound|instantly|lead/.test(text)) {
      return {
        safeAutonomous: true,
        requiresKevin: false,
        recommendedRepair:
          "Audit campaign health, deliverability, inbox assignment, lead count, and safe next action.",
        verification:
          "Executive campaign report contains status, risk, and next action for each campaign.",
        rollback: "No sending change is made without governance approval."
      };
    }

    return {
      safeAutonomous: true,
      requiresKevin: false,
      recommendedRepair:
        "Investigate issue, generate repair recommendation, and verify result.",
      verification:
        "Issue is resolved, downgraded, or escalated with evidence.",
      rollback: "Restore prior state if a safe repair changes system state."
    };
  }

  buildCapabilityBacklog(executiveState = {}, health = {}, cycleId = null) {
    const existingCapabilities = new Set(
      (executiveState.providers || []).map(p =>
        String(p.provider || "").toLowerCase()
      )
    );

    const targetCapabilities = [
      {
        area: "Website COO",
        providerKey: "website",
        title: "Build Website COO live audit and repair operator",
        businessImpact: "Very High",
        removesManualWork: [
          "homepage audit",
          "CTA review",
          "form checks",
          "SEO checks",
          "conversion recommendations"
        ],
        recommendedAction:
          "Add website provider and browser worker that audits homepage, services, forms, SEO, and conversion queue."
      },
      {
        area: "LinkedIn COO",
        providerKey: "linkedin",
        title: "Build LinkedIn COO content and engagement operator",
        businessImpact: "High",
        removesManualWork: [
          "profile audit",
          "company page audit",
          "post generation",
          "comment drafting",
          "engagement review"
        ],
        recommendedAction:
          "Add LinkedIn provider and browser worker for audit, content queue, and governed posting."
      },
      {
        area: "Sales COO",
        providerKey: "sales",
        title: "Build Sales COO pipeline and follow-up operator",
        businessImpact: "Very High",
        removesManualWork: [
          "pipeline review",
          "follow-up reminders",
          "proposal status checks",
          "call prep",
          "revenue forecast"
        ],
        recommendedAction:
          "Add sales pipeline provider and recurring follow-up queue."
      },
      {
        area: "Government Data COO",
        providerKey: "government",
        title: "Build Government Data COO refresh monitor",
        businessImpact: "High",
        removesManualWork: [
          "SAM checks",
          "GSA checks",
          "VA checks",
          "RFI monitoring",
          "source stale checks"
        ],
        recommendedAction:
          "Add source monitors for SAM, GSA, VA, forecasts, RFIs, and Sources Sought."
      },
      {
        area: "Engineering COO",
        providerKey: "engineering",
        title: "Build Engineering COO regression and self-repair loop",
        businessImpact: "Very High",
        removesManualWork: [
          "runtime log review",
          "failed task diagnosis",
          "regression tests",
          "safe rollback",
          "capability backlog"
        ],
        recommendedAction:
          "Add regression runner, repair evidence files, and guarded engineering backlog execution."
      }
    ];

    const gaps = targetCapabilities
      .filter(capability => !existingCapabilities.has(capability.providerKey))
      .map((capability, index) => ({
        id: `CAP-${Date.now()}-${index}-${Math.floor(Math.random() * 100000)}`,
        cycleId,
        status: "OPEN",
        priority: capability.businessImpact === "Very High" ? 1 : 2,
        createdAt: now(),
        ...capability
      }));

    return {
      ok: true,
      cycleId,
      generatedAt: now(),
      openGaps: gaps.length,
      gaps
    };
  }

  createMissionWork(mission = {}, repairPlan = {}, backlog = {}) {
    const created = [];

    for (const item of mission.priorities || []) {
      created.push(
        this.workQueue.createWorkItem({
          priority: item.priority,
          area: item.area,
          title: item.title,
          description: item.reason,
          reason: item.reason,
          source: "ExecutiveMissionPlanner",
          owner: item.owner || "Miles",
          requiresKevin: item.requiresKevin,
          recommendedAction: item.recommendedAction,
          expectedImpact: item.expectedImpact,
          relatedProvider: item.relatedProvider,
          executionType: item.requiresKevin ? "APPROVAL_REQUIRED" : "WORKFLOW",
          metadata: {
            missionItem: item,
            operationalObjective: item.objective,
            automationConfidence: item.automationConfidence,
            businessImpactScore: item.businessImpactScore
          }
        })
      );
    }

    for (const repair of repairPlan.repairs || []) {
      created.push(
        this.workQueue.createWorkItem({
          priority: repair.severity === "Critical" ? 1 : 2,
          area: repair.area,
          title: repair.title,
          description: repair.problem,
          reason:
            "Autonomous repair candidate detected during COO health check.",
          source: "AutonomousRepairQueue",
          owner: "Miles",
          requiresKevin: repair.requiresKevin,
          recommendedAction: repair.recommendedRepair,
          expectedImpact:
            "Restores or protects autonomous operating capability.",
          relatedProvider: repair.area,
          executionType: repair.requiresKevin ? "APPROVAL_REQUIRED" : "WORKFLOW",
          metadata: { repair }
        })
      );
    }

    for (const gap of (backlog.gaps || []).slice(0, 3)) {
      created.push(
        this.workQueue.createWorkItem({
          priority: gap.priority,
          area: "Engineering",
          title: gap.title,
          description: `Missing capability: ${
            gap.area
          }. Removes manual work: ${gap.removesManualWork.join(", ")}.`,
          reason: "Capability gap blocks higher autonomy.",
          source: "CapabilityBacklog",
          owner: "Miles",
          requiresKevin: false,
          recommendedAction: gap.recommendedAction,
          expectedImpact: gap.businessImpact,
          relatedProvider: "Engineering",
          executionType: "WORKFLOW",
          metadata: { capabilityGap: gap }
        })
      );
    }

    return {
      ok: true,
      total: created.length,
      autonomous: created.filter(item => !item.requiresKevin).length,
      escalations: created.filter(item => item.requiresKevin).length,
      items: created
    };
  }

  queueAuthorizedWorkflows() {
    console.log("[D014] ==================================");
    console.log("[D014] queueAuthorizedWorkflows() entered");

    /*
      ROOT CAUSE FIX:
      createMissionWork() writes work items to WorkQueueService.
      queueAuthorizedWorkflows() must reload before checking authorized pending.
      Without this reload, it can read a stale in-memory queue and report:
        Authorized Pending: 0
    */
    if (this.workQueue && typeof this.workQueue.load === "function") {
      try {
        this.workQueue.load();
        console.log("[D014] WorkQueue reloaded before authorization check.");
      } catch (reloadErr) {
        console.error("[D014] WorkQueue reload failed:", reloadErr.message);
      }
    }

    const stats =
      this.workQueue && typeof this.workQueue.getStats === "function"
        ? this.workQueue.getStats()
        : {};

    console.log("[D014] Queue Stats:", JSON.stringify(stats, null, 2));

    const allItems =
      this.workQueue && typeof this.workQueue.getAll === "function"
        ? this.workQueue.getAll()
        : this.workQueue && typeof this.workQueue.list === "function"
        ? this.workQueue.list()
        : [];

    const pendingItems = (allItems || []).filter(item => item.status === "Pending");
    const pendingRequiresKevin = pendingItems.filter(item =>
      item.requiresKevin === true ||
      String(item.requiresKevin).toLowerCase() === "true" ||
      item.executionType === "APPROVAL_REQUIRED"
    );

    console.log(`[D014] Total Work Items: ${(allItems || []).length}`);
    console.log(`[D014] Pending Items: ${pendingItems.length}`);
    console.log(`[D014] Pending Requiring Approval: ${pendingRequiresKevin.length}`);

    const authorized = this.workQueue.getAuthorizedPending() || [];

    console.log(`[D014] Authorized Pending: ${authorized.length}`);

    if (authorized.length === 0 && pendingItems.length > 0) {
      console.log("[D014] Pending items exist but none are authorized. Sample pending items:");
      console.log(
        JSON.stringify(
          pendingItems.slice(0, 5).map(item => ({
            id: item.id,
            status: item.status,
            requiresKevin: item.requiresKevin,
            executionType: item.executionType,
            title: item.title,
            area: item.area
          })),
          null,
          2
        )
      );
    }

    const results = [];

    for (const item of authorized) {
      try {
        console.log(
          `[D014] Work Item: ${item.id} | Status=${item.status} | RequiresKevin=${item.requiresKevin} | ExecutionType=${item.executionType} | Title=${item.title}`
        );

        if (item.status !== "Pending") {
          console.log(`[D014] SKIPPED ${item.id} because status='${item.status}'`);
          continue;
        }

        const objective =
          item.metadata?.operationalObjective ||
          item.metadata?.missionItem?.objective ||
          item.metadata?.repair?.objective ||
          item.title;

        const context = {
          sourceWorkItemId: item.id,
          area: item.area,
          priority: item.priority,
          description: item.description,
          reason: item.reason,
          recommendedAction: item.recommendedAction,
          expectedImpact: item.expectedImpact,
          relatedProvider: item.relatedProvider,
          provider: item.metadata?.missionItem?.provider || null,
          capability: item.metadata?.missionItem?.capability || null,
          action: item.metadata?.missionItem?.action || null,
          metadata: item.metadata || {},
          runtimeCycleId:
            item.metadata?.missionItem?.metadata?.cycleId || null
        };

        console.log(`[D014] Calling WorkflowService.createWorkflow("${objective}")`);

        const workflowResult = this.workflowService.createWorkflow(objective, context);

        console.log(
          "[D014] Workflow Result:",
          JSON.stringify(
            {
              status: workflowResult?.status,
              queuedTasks: workflowResult?.queuedTasks?.length || 0,
              workPackageId: workflowResult?.workPackage?.id || null
            },
            null,
            2
          )
        );

        this.workQueue.markQueued(item.id, {
          queuedBy: "AutonomousCOOLoopService",
          queuedAt: now(),
          workflowStatus: workflowResult?.status || "UNKNOWN",
          workflowResult
        });

        results.push({
          ok: true,
          workItemId: item.id,
          title: item.title,
          workflowStatus: workflowResult?.status || "UNKNOWN",
          queuedTasks: workflowResult?.queuedTasks?.length || 0,
          workPackageId: workflowResult?.workPackage?.id || null
        });
      } catch (err) {
        console.error(`[D014] FAILED Work Item ${item?.id || "UNKNOWN"}`);
        console.error(err);

        if (item && item.id && this.workQueue && typeof this.workQueue.markFailed === "function") {
          this.workQueue.markFailed(item.id, {
            failedBy: "AutonomousCOOLoopService",
            error: err.message
          });
        }

        results.push({
          ok: false,
          workItemId: item?.id || null,
          title: item?.title || null,
          error: err.message
        });
      }
    }

    console.log(`[D014] queueAuthorizedWorkflows() complete. Results=${results.length}`);
    console.log("[D014] ==================================");

    return results;
  }
  async runExecutionPasses() {
    const results = [];

    for (let i = 0; i < this.maxExecutionPasses; i++) {
      const executionService =
        this.executionService || require("./ExecutionService");

      const result = await executionService.runNext();

      results.push({
        pass: i + 1,
        result
      });

      if (result && result.message === "No queued tasks") {
        break;
      }
    }

    return results;
  }

  buildLearningSnapshot() {
    if (!learningEngine || typeof learningEngine.analyze !== "function") {
      return {
        ok: false,
        status: "NOT_AVAILABLE",
        message: "LearningEngine is not available."
      };
    }

    try {
      return learningEngine.analyze();
    } catch (err) {
      return {
        ok: false,
        status: "FAILED",
        error: err.message
      };
    }
  }

  scoreAutonomy(health = {}, mission = {}, repairPlan = {}, backlog = {}, learning = {}) {
    const observe = health.systems?.length > 0 ? 85 : 30;
    const understand = mission.priorities?.length > 0 ? 80 : 35;
    const decide = mission.topPriority ? 82 : 40;
    const execute = this.enableExecution ? 75 : 50;
    const verify = 70;
    const learn = learning.ok ? 70 : 40;
    const improve = backlog.openGaps >= 0 ? 65 : 35;
    const govern =
      mission.escalationCount >= 0 && repairPlan.awaitingApproval >= 0
        ? 78
        : 45;

    const scores = {
      observe,
      understand,
      decide,
      execute,
      verify,
      learn,
      improve,
      govern
    };

    const overall = Math.round(
      Object.values(scores).reduce((sum, value) => sum + value, 0) /
        Object.values(scores).length
    );

    return {
      ok: true,
      level:
        overall >= 80
          ? "BASIC_AUTONOMOUS_COO"
          : overall >= 65
          ? "ASSISTED_AUTONOMOUS_COO"
          : "OPERATOR_MODE",
      overall,
      scores,
      interpretation:
        overall >= 80
          ? "MILES can perform a basic autonomous COO cycle with monitoring, prioritization, work creation, execution, verification, learning, and governance."
          : "MILES has the core loop but still requires capability expansion or stronger verification to reach basic autonomous COO level."
    };
  }

  safeQueueStats() {
    try {
      return this.workQueue.getStats();
    } catch {
      return {
        total: 0,
        open: 0,
        pending: 0,
        queued: 0,
        inProgress: 0,
        blocked: 0,
        awaitingApproval: 0,
        completed: 0,
        failed: 0,
        escalations: 0
      };
    }
  }

  async start() {
    if (this.running) {
      return {
        ok: false,
        message: "Autonomous COO loop already running."
      };
    }

    this.running = true;

    while (this.running) {
      await this.runOnce();

      if (this.maxCycles && this.cyclesRun >= this.maxCycles) {
        this.running = false;
        break;
      }

      await this.sleep(this.intervalMs);
    }

    return {
      ok: true,
      status: "STOPPED",
      cyclesRun: this.cyclesRun
    };
  }

  stop() {
    this.running = false;

    return {
      ok: true,
      status: "STOPPING"
    };
  }

  writeOutputs(result, brief) {
    ensureDir(this.outputDir);
    ensureDir(this.runtimeDir);
    ensureDir(this.repairDir);
    ensureDir(this.backlogDir);

    fs.writeFileSync(
      path.join(this.outputDir, "latest_executive_state.json"),
      JSON.stringify(result.executiveState, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      path.join(this.outputDir, "latest_executive_brief.json"),
      JSON.stringify(result.executiveBrief, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      path.join(this.outputDir, "latest_executive_brief.md"),
      brief.toMarkdown(),
      "utf8"
    );

    fs.writeFileSync(
      path.join(this.outputDir, "latest_mission_plan.json"),
      JSON.stringify(result.mission, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      path.join(this.outputDir, "latest_universal_health.json"),
      JSON.stringify(result.health, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      path.join(this.repairDir, "latest_repair_plan.json"),
      JSON.stringify(result.repairPlan, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      path.join(this.backlogDir, "latest_capability_backlog.json"),
      JSON.stringify(result.capabilityBacklog, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      path.join(this.runtimeDir, "latest_coo_cycle.json"),
      JSON.stringify(result, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      path.join(this.outputDir, "latest_autonomy_scorecard.json"),
      JSON.stringify(result.autonomy, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      path.join(this.outputDir, "latest_coo_cycle.md"),
      this.toMarkdown(result),
      "utf8"
    );
  }

  toMarkdown(result = {}) {
    const lines = [];

    lines.push("# MILES Autonomous COO Cycle");
    lines.push("");
    lines.push(`Cycle: ${result.cycleId}`);
    lines.push(`Completed: ${result.completedAt}`);
    lines.push("");

    lines.push("## Business Operations Bridge");
    lines.push("");
    lines.push(`- Status: ${result.businessOperationsBridge?.status || "UNKNOWN"}`);
    lines.push(`- Operations Found: ${result.businessOperationsBridge?.operationsFound || 0}`);
    lines.push(`- Operations Queued: ${result.businessOperationsBridge?.operationsQueued || 0}`);
    lines.push(`- Operations Failed: ${result.businessOperationsBridge?.operationsFailed || 0}`);
    lines.push("");

    lines.push("## Autonomy");
    lines.push("");
    lines.push(`- Level: ${result.autonomy?.level}`);
    lines.push(`- Overall Score: ${result.autonomy?.overall}`);
    lines.push(`- Health Score: ${result.health?.overallScore}`);
    lines.push("");

    lines.push("## Top Mission Priorities");
    lines.push("");

    for (const item of result.mission?.priorities || []) {
      lines.push(`- P${item.priority} Ã¢â‚¬â€ ${item.area}: ${item.title}`);
      lines.push(`  - Action: ${item.recommendedAction}`);
      lines.push(`  - Kevin Required: ${item.requiresKevin ? "Yes" : "No"}`);
    }

    lines.push("");
    lines.push("## Health");
    lines.push("");

    for (const system of result.health?.systems || []) {
      lines.push(`- ${system.area}: ${system.status} / ${system.score} / Risk ${system.risk}`);
    }

    lines.push("");
    lines.push("## Work Created");
    lines.push("");
    lines.push(`- Total: ${result.workCreated?.total || 0}`);
    lines.push(`- Autonomous: ${result.workCreated?.autonomous || 0}`);
    lines.push(`- Escalations: ${result.workCreated?.escalations || 0}`);
    lines.push("");

    lines.push("## Capability Gaps");
    lines.push("");

    for (const gap of result.capabilityBacklog?.gaps || []) {
      lines.push(`- P${gap.priority} Ã¢â‚¬â€ ${gap.area}: ${gap.title}`);
    }

    return lines.join("\n");
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AutonomousCOOLoopService;

