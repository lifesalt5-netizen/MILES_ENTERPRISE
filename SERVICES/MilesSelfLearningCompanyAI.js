"use strict";

/**
 * MILES SELF-LEARNING COMPANY AI v1 (FINAL FORM)
 * ----------------------------------------------
 * - observes system output
 * - learns from outcomes
 * - adjusts decision weights
 * - improves revenue performance over time
 * - acts as global intelligence layer
 */

class MilesSelfLearningCompanyAI {

  constructor({
    cooEngine,
    revenueSystem,
    replyEngine,
    dealEngine,
    memory = {},
    connectors
  }) {

    this.coo = cooEngine;
    this.revenue = revenueSystem;
    this.reply = replyEngine;
    this.deal = dealEngine;
    this.connectors = connectors;

    // 🧠 GLOBAL MEMORY LAYER
    this.memory = {
      winRate: 0.5,
      leadQualityThreshold: 75,
      outreachAggressiveness: 1.0,
      dealScoringBias: 1.0,
      failureRate: 0,
      learningHistory: [],
      ...memory
    };
  }

  // =========================
  // MAIN CYCLE
  // =========================
  async runCycle(context = {}) {

    const result = {
      timestamp: new Date().toISOString(),
      insights: null,
      adjustments: null,
      outcome: null
    };

    // 1. EXECUTE FULL BUSINESS CYCLE
    const coo = await this.coo.runCycle();
    const revenue = await this.revenue.run(coo);
    const replies = await this.reply.processReplies(context.replies || []);
    const deals = await this.deal.run(context.deals || []);

    result.outcome = {
      coo,
      revenue,
      replies,
      deals
    };

    // 2. LEARN FROM OUTCOME
    const insights = this.analyzeOutcome(result.outcome);
    result.insights = insights;

    // 3. UPDATE GLOBAL MEMORY
    const adjustments = this.updateMemory(insights);
    result.adjustments = adjustments;

    // 4. PERSIST LEARNING
    this.persistLearning(result);

    return result;
  }

  // =========================
  // ANALYSIS ENGINE
  // =========================
  analyzeOutcome(outcome) {

    const revenueScore =
      outcome?.revenue?.state?.stages?.qualified || 0;

    const hotDeals =
      outcome?.deals?.summary?.hot || 0;

    const replies = outcome?.replies?.summary || {};

    const successSignal =
      hotDeals > 0 ? 1 : 0;

    const failureSignal =
      revenueScore < 2 ? 1 : 0;

    return {
      revenueScore,
      hotDeals,
      replies,
      successSignal,
      failureSignal
    };
  }

  // =========================
  // SELF-LEARNING ENGINE
  // =========================
  updateMemory(insights) {

    const adjustments = {};

    // 🔥 WIN RATE LEARNING
    if (insights.successSignal) {
      this.memory.winRate = Math.min(1, this.memory.winRate + 0.02);
    }

    if (insights.failureSignal) {
      this.memory.winRate = Math.max(0.1, this.memory.winRate - 0.03);
    }

    // 🎯 LEAD QUALITY THRESHOLD ADJUSTMENT
    if (insights.revenueScore < 5) {
      this.memory.leadQualityThreshold += 2;
      adjustments.leadQualityThreshold = "INCREASED";
    }

    if (insights.revenueScore > 10) {
      this.memory.leadQualityThreshold -= 1;
      adjustments.leadQualityThreshold = "DECREASED";
    }

    // ⚡ OUTREACH AGGRESSION TUNING
    if (insights.hotDeals > 2) {
      this.memory.outreachAggressiveness += 0.1;
      adjustments.outreachAggressiveness = "INCREASED";
    }

    if (insights.hotDeals === 0) {
      this.memory.outreachAggressiveness -= 0.1;
      adjustments.outreachAggressiveness = "DECREASED";
    }

    // 🧠 DEAL SCORING BIAS
    this.memory.dealScoringBias =
      this.memory.winRate > 0.6 ? 1.2 : 1.0;

    // STORE HISTORY
    this.memory.learningHistory.push({
      time: new Date().toISOString(),
      insights,
      adjustments
    });

    return adjustments;
  }

  // =========================
  // PERSISTENCE LAYER
  // =========================
  persistLearning(result) {

    if (!this.connectors?.orion?.write) return;

    this.connectors.orion.write({
      type: "SELF_LEARNING_UPDATE",
      data: {
        memory: this.memory,
        lastResult: result
      }
    });
  }

  // =========================
  // MEMORY VIEW
  // =========================
  getMemory() {
    return this.memory;
  }
}

module.exports = MilesSelfLearningCompanyAI;