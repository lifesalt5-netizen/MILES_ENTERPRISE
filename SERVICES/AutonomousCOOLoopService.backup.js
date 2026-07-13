"use strict";

const fs = require("fs");
const path = require("path");

const ExecutiveIntelligenceService =
  require("./ExecutiveIntelligenceService");

const WorkQueueService =
  require("./WorkQueueService");

const WorkflowService =
  require("./WorkflowService");

let taskQueue = null;

try {
  taskQueue = require("../CORE/TaskQueue");
} catch {}

const ROOT = process.env.MILES_ROOT || process.cwd();

function now() {
  return new Date().toISOString();
}

function clamp(v) {
  return Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
}

function score(status) {
  const s = String(status || "").toLowerCase();
  if (s === "healthy") return 100;
  if (s === "watch") return 70;
  if (s === "critical") return 25;
  return 60;
}

class AutonomousCOOLoopService {

  constructor(options = {}) {
    this.intervalMs = options.intervalMs || 60 * 1000;
    this.maxExecutionPasses = options.maxExecutionPasses || 5;

    this.enableExecution = true;
    this.enableRevenueClosure = true;
    this.enablePipelineExecution = true;
    this.enableLeadLifecycleManagement = true;
    this.enableConversionTracking = true;

    this.cyclesRun = 0;

    this.intelligence = new ExecutiveIntelligenceService();
    this.workQueue = new WorkQueueService();
    this.workflowService = WorkflowService;
  }

  async runOnce() {
    this.cyclesRun++;

    const startedAt = now();

    const cycleId =
      `COO-${startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${String(this.cyclesRun).padStart(3, "0")}`;

    await this.intelligence.refresh();
    const state = await this.intelligence.getExecutiveState();

    const health = this.buildHealth(state);
    const pipeline = this.buildRevenuePipeline(state);
    const lifecycle = this.buildLeadLifecycle(pipeline);
    const repairs = this.selfRepair(state, health);
    const mission = this.buildMission(health, pipeline, lifecycle, cycleId);
    const workCreated = this.createWork(mission);
    const executionResults = await this.execute();

    await this.intelligence.refresh();
    const finalState = await this.intelligence.getExecutiveState();
    const finalHealth = this.buildHealth(finalState);

    const closure = this.scoreClosure(
      pipeline,
      lifecycle,
      repairs,
      finalHealth
    );

    const result = {
      ok: true,
      version: "COO_V9_BUSINESS_STATE_REVENUE_CLOSURE",
      cycleId,
      startedAt,
      completedAt: now(),
      closure,
      health: finalHealth,
      pipeline,
      lifecycle,
      mission,
      repairs,
      workCreated,
      executionResults,
      executiveState: finalState
    };

    this.persist(result);

    return result;
  }

  buildHealth(state) {
    const providers = state.providers || [];

    const systems = providers.map(p => {
      const systemScore = score(p.status);

      return {
        area: p.provider || "Unknown",
        status: p.status || "Unknown",
        score: systemScore,
        risk:
          systemScore < 50
            ? "HIGH"
            : systemScore < 75
              ? "MEDIUM"
              : "LOW"
      };
    });

    const overallScore =
      systems.length
        ? clamp(
            systems.reduce((t, s) => t + s.score, 0) /
            systems.length
          )
        : 60;

    return {
      ok: true,
      overallScore,
      systems
    };
  }

  buildRevenuePipeline(state) {
    const pipeline = [];

    const business = state.business || {};

    const leads = business.leads || [];
    const opportunities = business.opportunities || [];
    const contractors = business.contractors || [];
    const deals = business.deals || [];

    for (const deal of deals.slice(0, 100)) {
      pipeline.push({
        stage: "DEAL",
        source: "CRM",
        target:
          deal.company ||
          deal.name ||
          deal.legal_name ||
          deal.target ||
          "Unknown Deal",
        company:
          deal.company ||
          deal.name ||
          deal.legal_name ||
          "Unknown Deal",
        contact: deal.contact || deal.contact_name || null,
        email: deal.email || deal.contact_email || null,
        action: "advance_deal",
        probability: Number(deal.probability || 0.75),
        value: Number(deal.value || 0),
        record: deal
      });
    }

    for (const lead of leads.slice(0, 100)) {
      pipeline.push({
        stage: "LEAD",
        source: "BUSINESS_STATE",
        target:
          lead.company ||
          lead.legal_name ||
          lead.name ||
          lead.target ||
          "Unknown Lead",
        company:
          lead.company ||
          lead.legal_name ||
          lead.name ||
          "Unknown Lead",
        contact:
          lead.contact ||
          lead.contact_name ||
          lead.poc ||
          null,
        email:
          lead.email ||
          lead.contact_email ||
          lead.primary_email ||
          null,
        action: "qualify_and_follow_up",
        probability: 0.65,
        value: Number(lead.estimated_value || lead.value || 0),
        record: lead
      });
    }

    for (const opp of opportunities.slice(0, 100)) {
      pipeline.push({
        stage: "OPPORTUNITY",
        source: "ORION",
        target:
          opp.title ||
          opp.opportunity_title ||
          opp.name ||
          opp.solicitation_number ||
          "Unknown Opportunity",
        company:
          opp.agency ||
          opp.buyer ||
          opp.department ||
          "Unknown Buyer",
        contact:
          opp.contact ||
          opp.contact_name ||
          null,
        email:
          opp.email ||
          opp.contact_email ||
          null,
        action: "evaluate_opportunity",
        probability: 0.7,
        value: Number(
          opp.estimated_value ||
          opp.value ||
          opp.contract_value ||
          0
        ),
        record: opp
      });
    }

    for (const contractor of contractors.slice(0, 100)) {
      pipeline.push({
        stage: "CONTRACTOR_TARGET",
        source: "ORION",
        target:
          contractor.legal_name ||
          contractor.company ||
          contractor.name ||
          contractor.uei ||
          "Unknown Contractor",
        company:
          contractor.legal_name ||
          contractor.company ||
          contractor.name ||
          "Unknown Contractor",
        contact:
          contractor.contact ||
          contractor.contact_name ||
          null,
        email:
          contractor.email ||
          contractor.contact_email ||
          contractor.primary_email ||
          null,
        action: "create_outreach_sequence",
        probability: 0.6,
        value: Number(
          contractor.estimated_value ||
          contractor.revenue ||
          contractor.federal_revenue ||
          0
        ),
        record: contractor
      });
    }

    return {
      ok: true,
      source: "BUSINESS_STATE",
      pipeline
    };
  }

  buildLeadLifecycle(pipeline) {
    const lifecycle = [];

    for (const p of pipeline.pipeline || []) {
      lifecycle.push({
        leadStage: p.stage,
        target: p.target,
        company: p.company,
        contact: p.contact,
        email: p.email,
        nextAction: p.action,
        conversionProbability: p.probability,
        source: p.source
      });
    }

    return {
      ok: true,
      lifecycle
    };
  }

  selfRepair(state, health) {
    const repairs = [];

    const failed = taskQueue?.getStatus?.()?.failed || 0;

    if (failed > 0) {
      repairs.push({
        type: "TASK_RECOVERY",
        action: "retry_failed_tasks"
      });
    }

    if (health.overallScore < 75) {
      repairs.push({
        type: "STABILITY_BOOST",
        action: "rebalance_system_load"
      });
    }

    return { ok: true, repairs };
  }

  buildMission(health, pipeline, lifecycle, cycleId) {
    const priorities = [];

    for (const p of pipeline.pipeline || []) {
      priorities.push({
        priority: 1,
        area: "REVENUE",
        title: p.stage,
        action: p.action,
        target: p.target,
        metadata: {
          company: p.company,
          contact: p.contact,
          email: p.email,
          probability: p.probability,
          value: p.value,
          source: p.source
        }
      });
    }

    for (const l of lifecycle.lifecycle || []) {
      priorities.push({
        priority: 1,
        area: "LIFECYCLE",
        title: l.leadStage,
        action: l.nextAction,
        target: l.target,
        metadata: {
          company: l.company,
          contact: l.contact,
          email: l.email,
          probability: l.conversionProbability,
          source: l.source
        }
      });
    }

    for (const s of health.systems || []) {
      if (s.risk === "HIGH") {
        priorities.push({
          priority: 2,
          area: s.area,
          title: `Repair ${s.area}`,
          action: "Fix system issue"
        });
      }
    }

    priorities.push({
      priority: 3,
      area: "SYSTEM",
      title: "Maintain revenue closure loop",
      action: "Continuous optimization"
    });

    return { ok: true, cycleId, priorities };
  }

  createWork(mission) {
    const created = [];

    for (const p of mission.priorities || []) {
      created.push(
        this.workQueue.createWorkItem({
          priority: p.priority,
          area: p.area,
          title: p.title,
          description: p.action,
          metadata: {
            target: p.target || null,
            ...(p.metadata || {})
          }
        })
      );
    }

    return { total: created.length };
  }

  async execute() {
    const results = [];

    for (let i = 0; i < this.maxExecutionPasses; i++) {
      const exec = require("./ExecutionService");
      const r = await exec.runNext();

      results.push(r);

      if (!r || r.message === "No queued tasks") break;
    }

    return {
      ok: true,
      executed: results.length,
      results
    };
  }

  scoreClosure(pipeline, lifecycle, repairs, health) {
    const base = health.overallScore;

    const revenueBoost =
      (pipeline?.pipeline?.length || 0) * 3;

    const lifecycleBoost =
      (lifecycle?.lifecycle?.length || 0) * 3;

    const repairBoost =
      (repairs?.repairs?.length || 0) * 2;

    const final =
      clamp(base + revenueBoost + lifecycleBoost + repairBoost);

    return {
      ok: true,
      level:
        final >= 90
          ? "AUTONOMOUS_REVENUE_CLOSURE_V9"
          : final >= 75
            ? "AUTONOMOUS_COO"
            : "ASSISTED_COO",
      overall: final,
      conversionEngine: {
        pipelineDepth: pipeline?.pipeline?.length || 0,
        lifecycleDepth: lifecycle?.lifecycle?.length || 0,
        repairSignals: repairs?.repairs?.length || 0
      }
    };
  }

  persist(result) {
    const dir = path.join(ROOT, "DATA", "runtime");

    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, "latest_coo_cycle.json"),
      JSON.stringify(result, null, 2)
    );
  }
}

module.exports = AutonomousCOOLoopService;