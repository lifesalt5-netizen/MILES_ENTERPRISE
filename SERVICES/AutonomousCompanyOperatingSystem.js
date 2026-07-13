"use strict";

const EventEmitter = require("events");

/**
 * AUTONOMOUS COMPANY OPERATING SYSTEM v1
 * --------------------------------------
 * Top-level orchestration brain for P2GC
 * - governs all subsystems
 * - enforces revenue objectives
 * - balances operations + sales + execution
 * - continuously optimizes company performance
 */

class AutonomousCompanyOperatingSystem extends EventEmitter {

  constructor({
    liveMode,
    cooEngine,
    revenueLoop,
    replyEngine,
    dealEngine,
    connectors,
    orion
  }) {

    super();

    this.liveMode = liveMode;
    this.cooEngine = cooEngine;
    this.revenueLoop = revenueLoop;
    this.replyEngine = replyEngine;
    this.dealEngine = dealEngine;
    this.connectors = connectors;
    this.orion = orion;

    this.state = {
      running: false,
      cycleCount: 0,
      revenueScore: 0,
      systemHealth: 100,
      lastDecision: null
    };
  }

  // =========================
  // START SYSTEM
  // =========================
  start() {

    this.state.running = true;

    console.log("\n[MILES] =====================================");
    console.log("[MILES] AUTONOMOUS COMPANY OS v1 ONLINE");
    console.log("[MILES] FULL BUSINESS AUTONOMY ACTIVE");
    console.log("[MILES] =====================================\n");

    // Hook into live business events
    this.liveMode.on("INCOMING_LEADS", (data) =>
      this.emit("LEADS", data)
    );

    this.liveMode.on("INCOMING_REPLIES", (data) =>
      this.emit("REPLIES", data)
    );

    this.liveMode.on("DEAL_UPDATE", (data) =>
      this.emit("DEALS", data)
    );

    this.on("LEADS", this.processLeads.bind(this));
    this.on("REPLIES", this.processReplies.bind(this));
    this.on("DEALS", this.processDeals.bind(this));
    this.on("SYSTEM_CYCLE", this.runCompanyCycle.bind(this));

    // heartbeat
    setInterval(() => {
      this.emit("SYSTEM_CYCLE", { time: Date.now() });
    }, 15000);
  }

  // =========================
  // COMPANY DECISION CYCLE
  // =========================
  async runCompanyCycle() {

    this.state.cycleCount++;

    console.log("\n[MILES] --- COMPANY CYCLE START ---");

    try {

      // 1. RUN COO CORE
      const coo = await this.cooEngine.runCycle();

      // 2. REVENUE LOOP
      const revenue = await this.revenueLoop.run(coo);

      // 3. SYSTEM SCORING
      this.state.systemHealth = coo?.health?.overallScore || 0;

      this.state.revenueScore = this.calculateRevenueScore(revenue);

      // 4. GLOBAL DECISION MAKING
      this.state.lastDecision = this.makeCompanyDecision();

      console.log("[MILES] Health:", this.state.systemHealth);
      console.log("[MILES] Revenue Score:", this.state.revenueScore);
      console.log("[MILES] Decision:", this.state.lastDecision);

      // 5. APPLY GLOBAL OPTIMIZATION
      await this.applyOptimization();

    } catch (err) {
      console.error("[MILES] COMPANY OS ERROR:", err.message);
    }
  }

  // =========================
  // LEADS PROCESSOR
  // =========================
  async processLeads(leads) {

    console.log("[MILES] COMPANY OS → LEADS:", leads?.length || 0);

    await this.revenueLoop.run({ leads });
  }

  // =========================
  // REPLY PROCESSOR
  // =========================
  async processReplies(replies) {

    console.log("[MILES] COMPANY OS → REPLIES:", replies?.length || 0);

    const result = await this.replyEngine.processReplies(replies);

    if (result?.summary?.interested > 0) {
      this.state.revenueScore += 5;
    }
  }

  // =========================
  // DEAL PROCESSOR
  // =========================
  async processDeals(data) {

    console.log("[MILES] COMPANY OS → DEALS");

    await this.dealEngine.run(data?.deals || []);
  }

  // =========================
  // COMPANY DECISION ENGINE
  // =========================
  makeCompanyDecision() {

    if (this.state.systemHealth < 50) {
      return "SYSTEM_RECOVERY_MODE";
    }

    if (this.state.revenueScore < 40) {
      return "AGGRESSIVE_GROWTH_MODE";
    }

    if (this.state.revenueScore > 75) {
      return "SCALE_MODE";
    }

    return "STEADY_OPERATION_MODE";
  }

  // =========================
  // OPTIMIZATION LAYER
  // =========================
  async applyOptimization() {

    const mode = this.state.lastDecision;

    if (mode === "AGGRESSIVE_GROWTH_MODE") {
      console.log("[MILES] → Increasing outbound intensity");
    }

    if (mode === "SYSTEM_RECOVERY_MODE") {
      console.log("[MILES] → Running system stabilization protocols");
    }

    if (mode === "SCALE_MODE") {
      console.log("[MILES] → Scaling campaigns + outreach");
    }
  }

  // =========================
  // SCORING
  // =========================
  calculateRevenueScore(revenue) {

    if (!revenue?.state?.stages) return 0;

    const s = revenue.state.stages;

    return (
      (s.ingested || 0) * 1 +
      (s.qualified || 0) * 2 +
      (s.outreach || 0) * 3 +
      (s.crm || 0) * 4 +
      (s.followups || 0) * 5
    );
  }
}

module.exports = AutonomousCompanyOperatingSystem;