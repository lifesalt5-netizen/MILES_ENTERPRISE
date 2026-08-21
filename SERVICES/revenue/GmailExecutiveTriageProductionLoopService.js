"use strict";

const fs = require("fs");
const path = require("path");
const GmailExecutiveTriageService = require("./GmailExecutiveTriageService");

function truthy(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

class GmailExecutiveTriageProductionLoopService {
  constructor(options = {}) {
    this.root = options.root || process.env.MILES_ROOT || process.cwd();
    this.intervalMs = Number(options.intervalMs || process.env.P2GC_GMAIL_TRIAGE_INTERVAL_MS || 5 * 60 * 1000);
    this.enabled = options.enabled !== undefined ? options.enabled : truthy(process.env.MILES_GMAIL_EXECUTIVE_TRIAGE_ENABLED, false);
    this.execute = options.execute !== undefined ? options.execute : truthy(process.env.MILES_GMAIL_EXECUTIVE_TRIAGE_EXECUTE, false);
    this.service = options.service || new GmailExecutiveTriageService(options);
    this.timer = null;
    this.running = false;
    this.lastResult = null;
  }

  persist(result) {
    const dir = path.join(this.root, "DATA", "runtime", "revenue", "gmail_triage");
    fs.mkdirSync(dir, { recursive: true });
    const payload = { ...result, generatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, "gmail_executive_triage_latest.json"), JSON.stringify(payload, null, 2), "utf8");
    return path.join(dir, "gmail_executive_triage_latest.json");
  }

  async runOnce() {
    if (!this.enabled) {
      const result = { ok: false, status: "DISABLED", enabled: false, execute: this.execute, blocker: "GMAIL_EXECUTIVE_TRIAGE_DISABLED" };
      result.artifact = this.persist(result);
      this.lastResult = result;
      return result;
    }
    if (this.running) return this.lastResult || { ok: false, status: "ALREADY_RUNNING" };
    this.running = true;
    try {
      const triage = await this.service.run({ execute: this.execute });
      const result = {
        ok: triage.ok,
        status: triage.ok ? (this.execute ? "ACTIVE" : "PLAN_ONLY") : "BLOCKED",
        enabled: true,
        execute: this.execute,
        destination: triage.destination,
        blockers: triage.blockers,
        accounts: triage.accounts,
        safety: triage.safety
      };
      result.artifact = this.persist(result);
      this.lastResult = result;
      return result;
    } catch (error) {
      const result = { ok: false, status: "ERROR", enabled: true, execute: this.execute, error: error.message };
      result.artifact = this.persist(result);
      this.lastResult = result;
      return result;
    } finally {
      this.running = false;
    }
  }

  start() {
    if (!this.enabled) return { status: "DISABLED", enabled: false, executionEnabled: this.execute };
    if (this.timer) return { status: "ALREADY_RUNNING", enabled: true, executionEnabled: this.execute };
    this.runOnce().catch(() => {});
    this.timer = setInterval(() => this.runOnce().catch(() => {}), this.intervalMs);
    this.timer.unref?.();
    return { status: "STARTED", enabled: true, executionEnabled: this.execute, intervalMs: this.intervalMs };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = GmailExecutiveTriageProductionLoopService;
