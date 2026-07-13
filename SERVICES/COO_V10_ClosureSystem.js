"use strict";

const fs = require("fs");
const path = require("path");

const ExecutionLayer = require("./COO_V9_ExecutionLayer");

class COO_V10_ClosureSystem {

  constructor(config = {}) {

    this.execution = new ExecutionLayer(config);

    this.statePath = path.join(
      process.cwd(),
      "DATA",
      "revenue_state.json"
    );

    this.loadState();
  }

  // =========================
  // 🧠 MAIN LOOP
  // =========================
  async runOnce(pipeline) {

    const timestamp = new Date().toISOString();

    const stateBefore = this.state;

    // 1. DETECT
    const opportunities = this.detect(pipeline);

    // 2. DECIDE
    const actions = this.decide(opportunities);

    // 3. EXECUTE (REAL WORLD)
    const results = await this.execute(actions);

    // 4. UPDATE STATE
    this.updateState(results);

    // 5. LEARN
    const insights = this.learn(results);

    // 6. PERSIST
    this.saveState();

    return {
      ok: true,
      timestamp,
      opportunities,
      actions,
      results,
      insights,
      stateBefore,
      stateAfter: this.state
    };
  }

  // =========================
  // 🔍 DETECTION ENGINE
  // =========================
  detect(pipeline = []) {

    return pipeline.map(p => ({

      target: p.target,
      stage: p.stage,

      signal:
        p.stage === "EXPANSION" ? "upsell"
        : p.stage === "NURTURE" ? "engage"
        : "reactivate",

      confidence: p.probability || 0.5
    }));
  }

  // =========================
  // 🎯 DECISION ENGINE
  // =========================
  decide(opportunities) {

    return opportunities.map(o => ({

      target: o.target,

      action:
        o.signal === "upsell"
          ? "send_expansion_campaign"
          : o.signal === "engage"
            ? "send_nurture_sequence"
            : "send_recovery_sequence",

      confidence: o.confidence
    }));
  }

  // =========================
  // ⚡ EXECUTION ENGINE
  // =========================
  async execute(actions) {

    const results = [];

    for (const a of actions) {

      // 🔌 REAL WORLD EXECUTION LAYER
      if (a.action === "send_expansion_campaign") {

        results.push(await this.execution.createCampaign({
          name: `EXPAND_${a.target}`
        }));
      }

      if (a.action === "send_nurture_sequence") {

        results.push(await this.execution.addToCampaign({
          campaignId: "NURTURE_DEFAULT",
          lead: a.target
        }));
      }

      if (a.action === "send_recovery_sequence") {

        results.push(await this.execution.addToCampaign({
          campaignId: "RECOVERY_DEFAULT",
          lead: a.target
        }));
      }
    }

    return results;
  }

  // =========================
  // 📈 LEARNING ENGINE
  // =========================
  learn(results) {

    const success = results.filter(r => r.ok).length;
    const total = results.length;

    const rate = total ? success / total : 0;

    return {
      successRate: rate,
      interpretation:
        rate > 0.8 ? "high_performance"
        : rate > 0.5 ? "moderate_performance"
        : "low_performance"
    };
  }

  // =========================
  // 🧠 STATE ENGINE
  // =========================
  loadState() {

    try {

      this.state = JSON.parse(
        fs.readFileSync(this.statePath, "utf8")
      );

    } catch {

      this.state = {
        revenue: 0,
        campaigns: 0,
        conversions: 0
      };
    }
  }

  updateState(results = []) {

    for (const r of results) {
      if (r.ok) {
        this.state.conversions++;
      }
    }

    this.state.campaigns += results.length;
    this.state.lastUpdate = new Date().toISOString();
  }

  saveState() {

    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });

    fs.writeFileSync(
      this.statePath,
      JSON.stringify(this.state, null, 2)
    );
  }
}

module.exports = COO_V10_ClosureSystem;