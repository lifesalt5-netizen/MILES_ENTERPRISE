"use strict";

class AutonomousRevenueClosureLoop {
  constructor() {
    this.cycle = 0;
    this.version = "E003.0";
    this.goal = {
      weeklyMinimum: 10000,
      annualTarget: 1000000
    };
  }

  async run(cooState = {}) {
    this.cycle += 1;
    console.log(`[REVENUE] Cycle ${this.cycle} started`);

    const signals = this.extractSignals(cooState);
    const evaluation = this.qualifyLeads(signals);
    const actions = this.buildRevenueActions(evaluation.qualified);

    console.log(`[REVENUE] Cycle ${this.cycle} completed`);

    return {
      ok: true,
      version: this.version,
      cycle: this.cycle,
      goal: { ...this.goal },
      metrics: {
        pipelineRecords: signals.totalPipeline,
        lifecycleOpportunities: signals.totalLifecycle,
        qualifiedDeals: evaluation.qualified.length,
        rejectedDeals: evaluation.rejected.length,
        proposedActions: actions.length
      },
      signals,
      results: {
        qualified: evaluation.qualified,
        rejected: evaluation.rejected,
        actions
      }
    };
  }

  extractSignals(state) {
    const business =
      state?.executiveState?.business ??
      state?.liveBusinessState?.business ??
      {};

    const pipeline =
      business.deals ??
      state?.pipeline?.pipeline ??
      [];

    const lifecycle =
      business.opportunities ??
      state?.lifecycle?.lifecycle ??
      [];

    const proposals = business.proposals ?? [];
    const campaigns = business.campaigns ?? [];
    const segments = business.segments ?? [];

    console.log("[REVENUE] Business Collections");
    console.log("Deals:", pipeline.length);
    console.log("Opportunities:", lifecycle.length);
    console.log("Proposals:", proposals.length);
    console.log("Campaigns:", campaigns.length);
    console.log("Segments:", segments.length);

    return {
      pipeline,
      lifecycle,
      proposals,
      campaigns,
      segments,
      totalPipeline: pipeline.length,
      totalLifecycle: lifecycle.length
    };
  }

  normalizeLead(p = {}) {
    const target = String(p.target || p.company || p.name || "").trim();
    const company = String(p.company || p.target || p.name || "").trim();
    const probability = Number(p.probability || 0);
    const explicitScore = Number(p.score);
    const score = Number.isFinite(explicitScore) && explicitScore > 0
      ? Math.round(explicitScore)
      : Math.round(probability * 100);
    const value = Number(p.value || 0);
    const source = String(p.source || "COO_PIPELINE").trim();
    const email = String(p.email || "").trim();

    return {
      id: p.id || null,
      name: p.name || company || target || null,
      company: company || target || null,
      target: target || company || null,
      contactName: p.contactName || null,
      email: email || null,
      type: p.stage || "UNKNOWN",
      source,
      value,
      probability,
      score,
      urgency: score >= 80 ? "high" : score >= 65 ? "medium" : "low",
      engagement: Number(p.engagement || 0)
    };
  }

  rejectionReason(lead) {
    const identity = [lead.id, lead.target, lead.company, lead.email, lead.source]
      .filter(Boolean)
      .join(" ");

    if (!lead.target || /^unknown(?:\s+target)?$/i.test(lead.target)) {
      return "MISSING_REAL_TARGET";
    }
    if (!(lead.value > 0)) {
      return "NON_POSITIVE_REVENUE_VALUE";
    }
    if (/\b(build|fixture|synthetic|test)\b/i.test(identity)) {
      return "SYNTHETIC_OR_TEST_RECORD";
    }
    return null;
  }

  qualifyLeads(signals) {
    const qualified = [];
    const rejected = [];

    for (const raw of signals.pipeline || []) {
      const lead = this.normalizeLead(raw);
      const reason = this.rejectionReason(lead);
      if (reason) {
        rejected.push({ ...lead, rejectionReason: reason });
        continue;
      }
      qualified.push(lead);
    }

    console.log(`[REVENUE] Qualified deals = ${qualified.length}`);
    return { qualified, rejected };
  }

  buildRevenueActions(qualified) {
    const actions = [];

    for (const q of qualified || []) {
      let action = "NURTURE_SEQUENCE";
      let priority = 2;
      if (q.score >= 85) {
        action = "TRIGGER_PROPOSAL";
        priority = 0;
      } else if (q.score >= 70) {
        action = "SEND_FOLLOWUP";
        priority = 1;
      }

      actions.push({
        action,
        target: q.target,
        company: q.company,
        email: q.email,
        source: q.source,
        value: q.value,
        score: q.score,
        priority,
        status: "PROPOSED",
        externalMutationExecuted: false
      });
    }

    console.log(`[REVENUE] Actions generated: ${actions.length}`);
    return actions;
  }
}

module.exports = AutonomousRevenueClosureLoop;
