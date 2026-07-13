"use strict";

class AutonomousRevenueClosureLoop {
  constructor() {
    this.cycle = 0;
  }

  async run(cooState) {
    this.cycle++;

    console.log(`[REVENUE] Cycle ${this.cycle} started`);

    const signals = this.extractSignals(cooState);
    const qualified = this.qualifyLeads(signals);
    const actions = this.buildRevenueActions(qualified);

    console.log(`[REVENUE] Cycle ${this.cycle} completed`);

    return {
      ok: true,
      cycle: this.cycle,
      signals,
      results: {
        qualified,
        actions
      }
    };
  }

  extractSignals(state) {
    const pipeline = state?.pipeline?.pipeline || [];
    const lifecycle = state?.lifecycle?.lifecycle || [];

    return {
      pipeline,
      lifecycle,
      totalPipeline: pipeline.length,
      totalLifecycle: lifecycle.length
    };
  }

  qualifyLeads(signals) {
    const qualified = [];

    for (const p of signals.pipeline || []) {
      const probability = Number(p.probability || 0);
      const score = Math.round(probability * 100);

      qualified.push({
        name: p.target || "Unknown Target",
        company: p.target || "Unknown Target",
        target: p.target || null,
        type: p.stage || "UNKNOWN",
        action: p.action || null,
        score,
        urgency:
          score >= 80 ? "high" :
          score >= 65 ? "medium" :
          "low",
        engagement: 0,
        source: "COO_PIPELINE"
      });
    }

    console.log(`[REVENUE] Qualified deals = ${qualified.length}`);

    return qualified;
  }

  buildRevenueActions(qualified) {
    const actions = [];

    for (const q of qualified) {
      if (q.score >= 85) {
        actions.push({
          action: "TRIGGER_PROPOSAL",
          target: q.target,
          priority: 0
        });
      } else if (q.score >= 70) {
        actions.push({
          action: "SEND_FOLLOWUP",
          target: q.target,
          priority: 1
        });
      } else {
        actions.push({
          action: "NURTURE_SEQUENCE",
          target: q.target,
          priority: 2
        });
      }
    }

    console.log(`[REVENUE] Actions generated: ${actions.length}`);

    return actions;
  }
}

module.exports = AutonomousRevenueClosureLoop;