"use strict";

const EventEmitter = require("events");

/**
 * LIVE AUTONOMOUS BUSINESS MODE v1
 * - event-driven (NOT loop-driven)
 * - reacts to real business signals
 * - connects COO + Revenue + Reply + Deal systems
 * - acts as system orchestration layer
 */

class LiveAutonomousBusinessMode extends EventEmitter {

  constructor({
    cooEngine,
    revenueLoop,
    replyEngine,
    dealEngine,
    connectors,
    orion
  }) {

    super();

    this.cooEngine = cooEngine;
    this.revenueLoop = revenueLoop;
    this.replyEngine = replyEngine;
    this.dealEngine = dealEngine;
    this.connectors = connectors;
    this.orion = orion;

    this.state = {
      running: false,
      lastCycle: null,
      eventsProcessed: 0
    };
  }

  // =========================
  // START SYSTEM
  // =========================
  start() {

    this.state.running = true;

    console.log("\n[MILES] ==================================");
    console.log("[MILES] LIVE AUTONOMOUS BUSINESS MODE ON");
    console.log("[MILES] EVENT-DRIVEN EXECUTION ACTIVE");
    console.log("[MILES] ==================================\n");

    // CORE EVENT LISTENERS

    this.on("INCOMING_LEADS", this.handleLeads.bind(this));
    this.on("INCOMING_REPLIES", this.handleReplies.bind(this));
    this.on("DEAL_UPDATE", this.handleDeals.bind(this));
    this.on("SYSTEM_TICK", this.runCooCycle.bind(this));

    // AUTO BOOTSTRAP EVENT LOOP (light heartbeat)
    setInterval(() => {
      this.emit("SYSTEM_TICK", {
        timestamp: new Date().toISOString()
      });
    }, 15000);
  }

  // =========================
  // COO SYSTEM CYCLE
  // =========================
  async runCooCycle() {

    try {

      const result = await this.cooEngine.runCycle();

      this.state.lastCycle = result;

      console.log("[MILES] COO Cycle Complete");
      console.log("[MILES] Health:", result?.health?.overallScore);

      // Trigger revenue loop automatically
      const revenue = await this.revenueLoop.run(result);

      console.log("[MILES] Revenue Cycle:", revenue.state.stages);

      this.state.eventsProcessed++;

    } catch (err) {
      console.error("[MILES] COO ERROR:", err.message);
    }
  }

  // =========================
  // INCOMING LEADS EVENT
  // =========================
  async handleLeads(leads) {

    console.log("[MILES] LEADS EVENT RECEIVED:", leads?.length || 0);

    try {

      const result = await this.revenueLoop.run({
        leads,
        source: "EVENT_STREAM"
      });

      this.emit("DEAL_UPDATE", result);

    } catch (err) {
      console.error("[MILES] LEADS ERROR:", err.message);
    }
  }

  // =========================
  // REPLY EVENT HANDLER
  // =========================
  async handleReplies(replies) {

    console.log("[MILES] REPLIES RECEIVED:", replies?.length || 0);

    try {

      const result = await this.replyEngine.processReplies(replies);

      // if HOT leads detected → trigger CRM + deal engine
      if (result?.summary?.interested > 0 || result?.summary?.meeting > 0) {

        this.emit("DEAL_UPDATE", {
          type: "HOT_SIGNAL",
          data: result
        });
      }

    } catch (err) {
      console.error("[MILES] REPLY ERROR:", err.message);
    }
  }

  // =========================
  // DEAL EVENT HANDLER
  // =========================
  async handleDeals(data) {

    console.log("[MILES] DEAL EVENT RECEIVED");

    try {

      await this.dealEngine.run(data?.deals || []);

    } catch (err) {
      console.error("[MILES] DEAL ERROR:", err.message);
    }
  }

  // =========================
  // EXTERNAL EVENT INJECTION
  // =========================
  injectEvent(type, payload) {
    this.emit(type, payload);
  }

  // =========================
  // SYSTEM STATUS
  // =========================
  getStatus() {

    return {
      running: this.state.running,
      lastCycle: this.state.lastCycle?.cycleId || null,
      eventsProcessed: this.state.eventsProcessed
    };
  }
}

module.exports = LiveAutonomousBusinessMode;