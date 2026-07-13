"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const APPROVAL_DIR = path.join(ROOT, "DATA", "executive", "approval");
const APPROVAL_FILE = path.join(APPROVAL_DIR, "approval_queue.json");
const HISTORY_FILE = path.join(APPROVAL_DIR, "approval_history.json");

function ensureFiles() {
  fs.mkdirSync(APPROVAL_DIR, { recursive: true });

  if (!fs.existsSync(APPROVAL_FILE)) {
    fs.writeFileSync(APPROVAL_FILE, JSON.stringify([], null, 2));
  }

  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
  }
}

function loadJson(file) {
  ensureFiles();
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJson(file, data) {
  ensureFiles();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function createId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `CEO-${stamp}-${rand}`;
}

class CEOApprovalQueue {
  enqueue(request = {}) {
    ensureFiles();

    const queue = loadJson(APPROVAL_FILE);

    const item = {
      id: request.id || createId(),
      status: "AWAITING_CEO_APPROVAL",
      priority: request.priority || "HIGH",
      category: request.category || "Executive Decision",
      objective: request.objective || null,
      reason: request.reason || "CEO approval required.",
      recommendation: request.recommendation || "Review and decide.",
      risk: request.risk || "MEDIUM",
      requestedBy: request.requestedBy || "MILES",
      provider: request.provider || null,
      capability: request.capability || null,
      action: request.action || null,
      workPackageId: request.workPackageId || null,
      taskId: request.taskId || null,
      evidence: request.evidence || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    queue.push(item);
    saveJson(APPROVAL_FILE, queue);

    return {
      ok: true,
      item,
      pending: queue.length
    };
  }

  list() {
    return loadJson(APPROVAL_FILE);
  }

  pending() {
    return this.list().filter(x => x.status === "AWAITING_CEO_APPROVAL");
  }

  history() {
    return loadJson(HISTORY_FILE);
  }

  approve(id, note = "") {
    return this.resolve(id, "APPROVED", note);
  }

  reject(id, note = "") {
    return this.resolve(id, "REJECTED", note);
  }

  delegate(id, note = "") {
    return this.resolve(id, "DELEGATED", note);
  }

  resolve(id, status, note = "") {
    const queue = loadJson(APPROVAL_FILE);
    const history = loadJson(HISTORY_FILE);

    const index = queue.findIndex(x => x.id === id);

    if (index === -1) {
      return {
        ok: false,
        error: `Approval item not found: ${id}`
      };
    }

    const item = {
      ...queue[index],
      status,
      ceoNote: note,
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    queue.splice(index, 1);
    history.push(item);

    saveJson(APPROVAL_FILE, queue);
    saveJson(HISTORY_FILE, history);

    return {
      ok: true,
      item,
      pending: queue.length
    };
  }

  clearTestItems() {
    const queue = loadJson(APPROVAL_FILE);
    const filtered = queue.filter(x => !String(x.id || "").startsWith("TEST-"));
    saveJson(APPROVAL_FILE, filtered);

    return {
      ok: true,
      removed: queue.length - filtered.length,
      pending: filtered.length
    };
  }

  statistics() {
    const pending = this.pending();
    const history = this.history();

    return {
      ok: true,
      pending: pending.length,
      approved: history.filter(x => x.status === "APPROVED").length,
      rejected: history.filter(x => x.status === "REJECTED").length,
      delegated: history.filter(x => x.status === "DELEGATED").length,
      totalResolved: history.length
    };
  }
}

module.exports = new CEOApprovalQueue();