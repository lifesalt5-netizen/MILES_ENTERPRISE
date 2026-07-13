"use strict";

const store = require("../CORE/CANONICAL/EnterpriseStore");

class ApprovalQueueEngine {
  constructor() {
    this.store = store;
    this.db = store.db;
    this.ensureTables();
  }

  now() {
    return new Date().toISOString();
  }

  id(prefix) {
    return this.store.id(prefix);
  }

  ensureTables() {
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS approval_actions (
        id TEXT PRIMARY KEY,
        approvalId TEXT,
        action TEXT,
        actor TEXT,
        notes TEXT,
        payload TEXT,
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

  getApproval(id) {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id=?").get(id);
    if (!row) return null;
    return Object.assign({}, row, { payload: this.parse(row.payload) });
  }

  list(status = "PENDING", department = null) {
    const rows = department
      ? this.db.prepare(
          "SELECT * FROM approvals WHERE status=? AND department=? ORDER BY createdAt ASC"
        ).all(status, department)
      : this.db.prepare(
          "SELECT * FROM approvals WHERE status=? ORDER BY createdAt ASC"
        ).all(status);

    return rows.map(row => Object.assign({}, row, { payload: this.parse(row.payload) }));
  }

  logAction(approvalId, action, actor, notes = "", payload = {}) {
    const item = {
      id: this.id("APPROVALACTION"),
      approvalId,
      action,
      actor,
      notes,
      payload,
      createdAt: this.now()
    };

    this.db.prepare(`
      INSERT INTO approval_actions
      (id, approvalId, action, actor, notes, payload, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.approvalId,
      item.action,
      item.actor,
      item.notes,
      JSON.stringify(item.payload),
      item.createdAt
    );

    this.store.insertEvent("APPROVAL_ACTION_LOGGED", "Governance", item);
    return item;
  }

  updateApprovalStatus(approvalId, status, actor, notes = "", payloadPatch = {}) {
    const approval = this.getApproval(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);

    const payload = Object.assign({}, approval.payload || {}, payloadPatch || {}, {
      lastActionBy: actor,
      lastActionAt: this.now(),
      lastActionNotes: notes
    });

    this.db.prepare(`
      UPDATE approvals
      SET status=?, payload=?, updatedAt=?
      WHERE id=?
    `).run(status, JSON.stringify(payload), this.now(), approvalId);

    this.logAction(approvalId, status, actor, notes, payload);

    return this.getApproval(approvalId);
  }

  updateUploadQueueForApproval(approvalId, newStatus, approvedCount = null) {
    const queueItem = this.store.getUploadQueue().find(item => item.approvalId === approvalId);
    if (!queueItem) return null;

    const patch = {
      status: newStatus,
      payload: Object.assign({}, queueItem.payload || {}, {
        approvalUpdatedAt: this.now(),
        approvalStatus: newStatus
      })
    };

    if (approvedCount !== null) {
      patch.approvedUploadCount = approvedCount;
    }

    return this.store.createUploadQueueItem(Object.assign({}, queueItem, patch));
  }

  approve(approvalId, actor = "Kevin", notes = "") {
    const approval = this.getApproval(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);

    const requestedUploadCount = Number(
      approval.payload.requestedUploadCount ||
      approval.payload.requested_upload_count ||
      0
    );

    const updated = this.updateApprovalStatus(
      approvalId,
      "APPROVED",
      actor,
      notes,
      { approvedAt: this.now() }
    );

    this.updateUploadQueueForApproval(
      approvalId,
      "READY_FOR_UPLOAD",
      requestedUploadCount
    );

    this.store.insertEvent("APPROVAL_APPROVED", approval.department || "Governance", {
      approvalId,
      actor,
      notes
    });

    return updated;
  }

  reject(approvalId, actor = "Kevin", notes = "") {
    const updated = this.updateApprovalStatus(
      approvalId,
      "REJECTED",
      actor,
      notes,
      { rejectedAt: this.now() }
    );

    this.updateUploadQueueForApproval(approvalId, "REJECTED", 0);

    this.store.insertEvent("APPROVAL_REJECTED", updated.department || "Governance", {
      approvalId,
      actor,
      notes
    });

    return updated;
  }

  cancel(approvalId, actor = "System", notes = "") {
    const updated = this.updateApprovalStatus(
      approvalId,
      "CANCELLED",
      actor,
      notes,
      { cancelledAt: this.now() }
    );

    this.updateUploadQueueForApproval(approvalId, "CANCELLED", 0);

    return updated;
  }

  stats() {
    const rows = this.db.prepare(`
      SELECT department, status, COUNT(*) AS count
      FROM approvals
      GROUP BY department, status
      ORDER BY department ASC, status ASC
    `).all();

    return rows;
  }

  pendingSummary() {
    const pending = this.list("PENDING");
    const summary = {};

    for (const approval of pending) {
      const department = approval.department || "Unknown";
      summary[department] = (summary[department] || 0) + 1;
    }

    summary.TOTAL = pending.length;
    return summary;
  }
}

module.exports = ApprovalQueueEngine;
