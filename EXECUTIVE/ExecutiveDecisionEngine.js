"use strict";

const store = require("../CORE/CANONICAL/EnterpriseStore");

class ExecutiveDecisionEngine {
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
      CREATE TABLE IF NOT EXISTS executive_decisions (
        id TEXT PRIMARY KEY,
        priority TEXT,
        department TEXT,
        action TEXT,
        reason TEXT,
        requiresKevin INTEGER,
        executeAutomatically INTEGER,
        status TEXT,
        payload TEXT,
        createdAt TEXT
      )
    `).run();
  }

  countBy(rows, field) {
    const out = {};
    for (const row of rows) {
      const key = String(row[field] ?? "UNKNOWN");
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }

  addDecision(decisions, item) {
    decisions.push({
      id: this.store.id("DECISION"),
      priority: item.priority,
      department: item.department || "Executive",
      action: item.action,
      reason: item.reason,
      requiresKevin: item.requiresKevin ? 1 : 0,
      executeAutomatically: item.executeAutomatically ? 1 : 0,
      status: "OPEN",
      payload: item.payload || {},
      createdAt: this.now()
    });
  }

  buildState() {
    const campaigns = this.store.getCampaigns();
    const segments = this.store.getSegments();
    const queue = this.store.getUploadQueue();
    const domains = this.store.getDomains();
    const inboxes = this.store.getInboxes();
    const approvals = this.db.prepare("SELECT * FROM approvals").all();

    return {
      campaigns,
      segments,
      queue,
      domains,
      inboxes,
      approvals,
      usableInboxes: this.store.getUsableInboxes(),
      readySegments: segments.filter(s =>
        s.readyForUpload === 1 ||
        String(s.uploadStatus || "").toUpperCase() === "READY_FOR_REVIEW"
      ),
      needsVerification: segments.filter(s =>
        String(s.uploadStatus || "").toUpperCase().includes("NEEDS_VERIFICATION")
      ),
      needsCleanup: segments.filter(s =>
        String(s.uploadStatus || "").toUpperCase().includes("DEDUPE") ||
        String(s.uploadStatus || "").toUpperCase().includes("CLEANUP")
      ),
      pendingApprovals: approvals.filter(a => a.status === "PENDING"),
      readyUploads: queue.filter(q => q.status === "READY_FOR_UPLOAD"),
      failedUploads: queue.filter(q => String(q.status || "").includes("FAILED")),
      totalDailyCapacity: this.store.getUsableInboxes().reduce((sum, i) => sum + Number(i.dailyLimit || 0), 0)
    };
  }

  evaluate() {
    const state = this.buildState();
    const decisions = [];

    if (state.usableInboxes.length === 0 || state.totalDailyCapacity <= 0) {
      this.addDecision(decisions, {
        priority: "CRITICAL",
        department: "Marketing",
        action: "RESTORE_SENDING_CAPACITY",
        reason: "No usable outbound inbox capacity is available.",
        requiresKevin: true,
        executeAutomatically: false,
        payload: { usableInboxes: state.usableInboxes.length, totalDailyCapacity: state.totalDailyCapacity }
      });
    }

    if (state.readyUploads.length > 0) {
      this.addDecision(decisions, {
        priority: "HIGH",
        department: "Marketing",
        action: "EXECUTE_READY_UPLOADS",
        reason: `${state.readyUploads.length} approved upload queue items are ready for execution.`,
        requiresKevin: false,
        executeAutomatically: true,
        payload: { readyUploads: state.readyUploads.length }
      });
    }

    if (state.pendingApprovals.length > 0) {
      this.addDecision(decisions, {
        priority: "HIGH",
        department: "Marketing",
        action: "REQUEST_KEVIN_APPROVAL",
        reason: `${state.pendingApprovals.length} approvals are waiting for Kevin.`,
        requiresKevin: true,
        executeAutomatically: false,
        payload: { pendingApprovals: state.pendingApprovals.length }
      });
    }

    const handledPairs = new Set(
      state.queue
        .filter(q => ["PENDING_APPROVAL","READY_FOR_UPLOAD","UPLOADED","DRY_RUN_COMPLETED","COMPLETED"].includes(String(q.status || "").toUpperCase()))
        .map(q => String(q.segmentId) + "::" + String(q.campaignId))
    );

    const unhandledReadySegments = state.readySegments.filter(segment => {
      return state.campaigns.some(campaign => !handledPairs.has(String(segment.id) + "::" + String(campaign.id)));
    });

    if (unhandledReadySegments.length > 0 && state.totalDailyCapacity > 0 && state.pendingApprovals.length === 0 && state.readyUploads.length === 0) {
      this.addDecision(decisions, {
        priority: "HIGH",
        department: "Marketing",
        action: "BUILD_NEXT_UPLOAD_QUEUE",
        reason: `${unhandledReadySegments.length} unhandled ready segments are available and ${state.totalDailyCapacity}/day capacity is available.`,
        requiresKevin: false,
        executeAutomatically: true,
        payload: { readySegments: state.readySegments.length, unhandledReadySegments: unhandledReadySegments.length, totalDailyCapacity: state.totalDailyCapacity }
      });
    }

    if (state.failedUploads.length > 0) {
      this.addDecision(decisions, {
        priority: "HIGH",
        department: "Marketing",
        action: "REVIEW_FAILED_UPLOADS",
        reason: `${state.failedUploads.length} upload items failed and need retry or review.`,
        requiresKevin: false,
        executeAutomatically: false,
        payload: { failedUploads: state.failedUploads.length }
      });
    }

    if (state.needsVerification.length > 0) {
      this.addDecision(decisions, {
        priority: "MEDIUM",
        department: "Marketing",
        action: "VERIFY_SEGMENT_EMAILS",
        reason: `${state.needsVerification.length} segments need email verification.`,
        requiresKevin: false,
        executeAutomatically: false,
        payload: { needsVerification: state.needsVerification.length }
      });
    }

    if (state.needsCleanup.length > 0) {
      this.addDecision(decisions, {
        priority: "MEDIUM",
        department: "Marketing",
        action: "CLEANUP_SEGMENTS",
        reason: `${state.needsCleanup.length} segments need dedupe or cleanup.`,
        requiresKevin: false,
        executeAutomatically: false,
        payload: { needsCleanup: state.needsCleanup.length }
      });
    }

    if (decisions.length === 0) {
      this.addDecision(decisions, {
        priority: "LOW",
        department: "Executive",
        action: "SYSTEM_HEALTHY_NO_ACTION",
        reason: "No urgent action required. Enterprise is healthy.",
        requiresKevin: false,
        executeAutomatically: false,
        payload: {}
      });
    }

    for (const decision of decisions) {
      this.db.prepare(`
        INSERT INTO executive_decisions
        (id,priority,department,action,reason,requiresKevin,executeAutomatically,status,payload,createdAt)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(
        decision.id,
        decision.priority,
        decision.department,
        decision.action,
        decision.reason,
        decision.requiresKevin,
        decision.executeAutomatically,
        decision.status,
        JSON.stringify(decision.payload),
        decision.createdAt
      );
    }

    this.store.insertEvent("EXECUTIVE_DECISIONS_CREATED", "Executive", {
      decisions: decisions.length,
      priorities: this.countBy(decisions, "priority")
    });

    return {
      generatedAt: this.now(),
      state: {
        campaigns: state.campaigns.length,
        segments: state.segments.length,
        readySegments: state.readySegments.length,
        pendingApprovals: state.pendingApprovals.length,
        readyUploads: state.readyUploads.length,
        failedUploads: state.failedUploads.length,
        usableInboxes: state.usableInboxes.length,
        totalDailyCapacity: state.totalDailyCapacity
      },
      decisions
    };
  }
}

module.exports = ExecutiveDecisionEngine;
