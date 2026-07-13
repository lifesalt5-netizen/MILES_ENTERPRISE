"use strict";

const fs = require("fs");
const path = require("path");

class COO_V12_AutonomousCompany {

  constructor(config = {}) {

    // 🔐 SAFETY GATES (MANDATORY)
    this.allowExecution = config.allowExecution || false;

    this.executors = config.executors || {
      email: null,
      instantly: null,
      crm: null
    };

    this.stateFile = path.join(
      process.cwd(),
      "DATA",
      "company_state.json"
    );

    this.state = this.loadState();
  }

  // =========================
  // 🧠 MAIN COMPANY LOOP
  // =========================
  async runOnce(intelligenceInput) {

    const timestamp = new Date().toISOString();

    // 1. ANALYZE BUSINESS
    const signals = this.analyze(intelligenceInput);

    // 2. STRATEGY DECISION
    const strategy = this.decide(signals);

    // 3. BUILD OPERATIONS PLAN
    const ops = this.buildOperations(strategy);

    // 4. EXECUTE ACROSS SYSTEMS
    const execution = await this.execute(ops);

    // 5. LEARN FROM RESULTS
    const learning = this.learn(execution);

    // 6. UPDATE STATE
    this.updateState({ signals, strategy, execution, learning });

    // 7. SAVE STATE
    this.saveState();

    return {
      ok: true,
      version: "COO_V12_AUTONOMOUS_COMPANY",
      timestamp,
      signals,
      strategy,
      ops,
      execution,
      learning,
      state: this.state
    };
  }

  // =========================
  // 🔍 ANALYSIS ENGINE
  // =========================
  analyze(input) {

    const providers = input.providers || [];

    return providers.map(p => {

      return {
        entity: p.provider,
        health: p.status,
        revenueSignal:
          p.status === "Healthy" ? "EXPAND"
          : p.status === "Watch" ? "NURTURE"
          : "RECOVER"
      };
    });
  }

  // =========================
  // 🎯 DECISION ENGINE
  // =========================
  decide(signals) {

    return signals.map(s => ({

      target: s.entity,

      action:
        s.revenueSignal === "EXPAND"
          ? "scale_campaign"
          : s.revenueSignal === "NURTURE"
            ? "nurture_sequence"
            : "recovery_sequence"
    }));
  }

  // =========================
  // ⚙️ OPERATIONS BUILDER
  // =========================
  buildOperations(strategy) {

    return strategy.map(s => ({

      type:
        s.action.includes("scale")
          ? "INSTANTLY"
          : s.action.includes("nurture")
            ? "EMAIL"
            : "CRM",

      payload: {
        target: s.target,
        action: s.action
      }
    }));
  }

  // =========================
  // ⚡ EXECUTION ENGINE
  // =========================
  async execute(ops) {

    if (!this.allowExecution) {
      return {
        ok: false,
        reason: "Execution disabled (safety gate)"
      };
    }

    const results = [];

    for (const op of ops) {

      if (op.type === "EMAIL" && this.executors.email) {
        results.push(await this.executors.email(op.payload));
      }

      if (op.type === "INSTANTLY" && this.executors.instantly) {
        results.push(await this.executors.instantly(op.payload));
      }

      if (op.type === "CRM" && this.executors.crm) {
        results.push(await this.executors.crm(op.payload));
      }
    }

    return { ok: true, results };
  }

  // =========================
  // 🧠 LEARNING ENGINE
  // =========================
  learn(execution) {

    const results = execution.results || [];

    const success = results.filter(r => r?.ok).length;

    const rate = results.length ? success / results.length : 0;

    return {
      successRate: rate,
      status:
        rate > 0.8 ? "OPTIMAL"
        : rate > 0.5 ? "STABLE"
        : "DEGRADED"
    };
  }

  // =========================
  // 📦 STATE MANAGEMENT
  // =========================
  loadState() {

    try {
      return JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
    } catch {
      return {
        revenue: 0,
        campaigns: 0,
        conversions: 0,
        lastUpdate: null
      };
    }
  }

  updateState(data) {

    this.state.lastUpdate = new Date().toISOString();

    this.state.campaigns += (data.execution?.results?.length || 0);

    this.state.conversions +=
      (data.learning?.successRate > 0.5 ? 1 : 0);
  }

  saveState() {

    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });

    fs.writeFileSync(
      this.stateFile,
      JSON.stringify(this.state, null, 2)
    );
  }
}

module.exports = COO_V12_AutonomousCompany;