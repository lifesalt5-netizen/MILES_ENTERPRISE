"use strict";

const store = require("../CORE/CANONICAL/EnterpriseStore");
const MarketingUploadQueueEngine = require("../DIGITAL_COO/Marketing/MarketingUploadQueueEngine");
const MarketingExecutionEngine = require("../EXECUTION/MarketingExecutionEngine");

class ExecutiveDecisionExecutor {
  constructor() {
    this.store = store;
    this.db = store.db;
    this.ensureTables();
  }

  now() {
    return new Date().toISOString();
  }

  ensureTables() {
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS executive_decision_actions (
        id TEXT PRIMARY KEY,
        decisionId TEXT,
        action TEXT,
        status TEXT,
        result TEXT,
        error TEXT,
        createdAt TEXT
      )
    `).run();
  }

  parse(value, fallback = {}) {
    try {
      if (!value) return fallback;
      if (typeof value === "object") return value;
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  getOpenAutomaticDecisions() {
    return this.db.prepare(`
      SELECT *
      FROM executive_decisions
      WHERE status='OPEN'
        AND executeAutomatically=1
      ORDER BY
        CASE priority
          WHEN 'CRITICAL' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          ELSE 4
        END,
        createdAt ASC
    `).all().map(row => ({
      ...row,
      payload: this.parse(row.payload)
    }));
  }

  markDecision(decisionId, status) {
    this.db.prepare(`
      UPDATE executive_decisions
      SET status=?
      WHERE id=?
    `).run(status, decisionId);
  }

  logAction(decisionId, action, status, result = {}, error = null) {
    const item = {
      id: this.store.id("DECACTION"),
      decisionId,
      action,
      status,
      result,
      error,
      createdAt: this.now()
    };

    this.db.prepare(`
      INSERT INTO executive_decision_actions
      (id,decisionId,action,status,result,error,createdAt)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      item.id,
      item.decisionId,
      item.action,
      item.status,
      JSON.stringify(item.result || {}),
      item.error,
      item.createdAt
    );

    this.store.insertEvent("EXECUTIVE_DECISION_ACTION_LOGGED", "Executive", item);
    return item;
  }

  async executeDecision(decision) {
    if (decision.requiresKevin === 1) {
      this.markDecision(decision.id, "WAITING_FOR_KEVIN");
      return this.logAction(
        decision.id,
        decision.action,
        "SKIPPED_REQUIRES_KEVIN",
        { reason: "Decision requires Kevin approval." }
      );
    }

    try {
      let result;

      if (decision.action === "BUILD_NEXT_UPLOAD_QUEUE") {
        const engine = new MarketingUploadQueueEngine();
        result = engine.run();
      } else if (decision.action === "EXECUTE_READY_UPLOADS") {
        const engine = new MarketingExecutionEngine();
        result = await engine.run();
      } else {
        result = {
          skipped: true,
          reason: `No executor mapped for action ${decision.action}.`
        };
      }

      this.markDecision(decision.id, "EXECUTED");
      return this.logAction(decision.id, decision.action, "SUCCESS", result);
    } catch (error) {
      this.markDecision(decision.id, "FAILED");
      return this.logAction(decision.id, decision.action, "FAILED", {}, error.message);
    }
  }

  async run() {
    const decisions = this.getOpenAutomaticDecisions();
    const results = [];

    for (const decision of decisions) {
      results.push(await this.executeDecision(decision));
    }

    this.store.insertEvent("EXECUTIVE_DECISION_EXECUTOR_COMPLETED", "Executive", {
      decisionsSeen: decisions.length,
      actionsTaken: results.length
    });

    return {
      decisionsSeen: decisions.length,
      actionsTaken: results.length,
      results
    };
  }
}

module.exports = ExecutiveDecisionExecutor;
