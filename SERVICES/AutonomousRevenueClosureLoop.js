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
    // ===== Canonical Business State =====
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

const proposals =
    business.proposals ?? [];

const campaigns =
    business.campaigns ?? [];

const segments =
    business.segments ?? [];
console.log("[REVENUE] Business Collections");
console.log("Deals:", pipeline.length);
console.log("Opportunities:", lifecycle.length);
console.log("Proposals:", proposals.length);
console.log("Campaigns:", campaigns.length);
console.log("Segments:", segments.length);

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