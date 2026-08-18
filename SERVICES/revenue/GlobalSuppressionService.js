"use strict";

const fs = require("fs");
const path = require("path");

function clean(value) {
  return String(value ?? "").trim();
}

function emailKey(value) {
  return clean(value).toLowerCase();
}

class GlobalSuppressionService {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..")
    );
    this.filePath = options.filePath || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "revenue",
      "replies",
      "global_suppression_master.json"
    );
    this.now = options.now || (() => new Date().toISOString());
  }

  ensureDir() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { version: 1, entries: [], generatedAt: this.now() };
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return {
        version: Number(parsed?.version || 1),
        entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
        generatedAt: parsed?.generatedAt || null
      };
    } catch {
      return { version: 1, entries: [], generatedAt: this.now() };
    }
  }

  persist(state) {
    this.ensureDir();
    const payload = {
      version: 1,
      entries: Array.isArray(state?.entries) ? state.entries : [],
      generatedAt: this.now()
    };
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(temp, this.filePath);
    return payload;
  }

  get(email) {
    const key = emailKey(email);
    if (!key) return null;
    return this.load().entries.find(entry => emailKey(entry?.email) === key && entry?.active !== false) || null;
  }

  isSuppressed(email) {
    return Boolean(this.get(email));
  }

  upsert(input = {}) {
    const email = emailKey(input.email);
    if (!email) return { ok: false, status: "EMAIL_REQUIRED" };

    const state = this.load();
    const index = state.entries.findIndex(entry => emailKey(entry?.email) === email);
    const now = this.now();
    const next = {
      email,
      reason: clean(input.reason || "DO_NOT_CONTACT"),
      category: clean(input.category || input.reason || "DO_NOT_CONTACT"),
      source: clean(input.source || "REPLY_INTELLIGENCE"),
      sourceId: clean(input.sourceId),
      campaignId: clean(input.campaignId),
      evidence: clean(input.evidence).slice(0, 1000),
      hard: input.hard !== false,
      active: input.active !== false,
      firstSeenAt: index >= 0 ? state.entries[index].firstSeenAt || now : now,
      lastSeenAt: now
    };

    if (index >= 0) state.entries[index] = { ...state.entries[index], ...next };
    else state.entries.push(next);

    const persisted = this.persist(state);
    return {
      ok: true,
      status: index >= 0 ? "SUPPRESSION_UPDATED" : "SUPPRESSION_ADDED",
      entry: next,
      total: persisted.entries.length,
      filePath: this.filePath
    };
  }
}

module.exports = GlobalSuppressionService;
module.exports.GlobalSuppressionService = GlobalSuppressionService;
module.exports.helpers = { clean, emailKey };
