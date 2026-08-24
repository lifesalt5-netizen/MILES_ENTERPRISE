"use strict";

const fs = require("fs");
const path = require("path");
const GmailExecutiveTriageService = require("./GmailExecutiveTriageService");
const IonosExecutiveTriageService = require("./IonosExecutiveTriageService");

function truthy(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function gmailSkipSafe(gmail = {}) {
  const accounts = Array.isArray(gmail.accounts) ? gmail.accounts : [];
  if (!accounts.length) return false;
  const skipped = accounts.filter(item => item?.scope === "OUT_OF_BUSINESS_SCOPE");
  return skipped.length === accounts.length && skipped.every(item =>
    item?.skipped === true &&
    item?.ok === true &&
    Number(item?.messagesInspected || 0) === 0 &&
    Number(item?.forwarded || 0) === 0 &&
    Number(item?.archived || 0) === 0
  ) && (gmail.blockers || []).length === 0;
}

class GmailExecutiveTriageProductionLoopService {
  constructor(options = {}) {
    this.root = options.root || process.env.MILES_ROOT || process.cwd();
    this.intervalMs = Number(options.intervalMs || process.env.P2GC_GMAIL_TRIAGE_INTERVAL_MS || 5 * 60 * 1000);
    this.enabled = options.enabled !== undefined ? options.enabled : truthy(process.env.MILES_GMAIL_EXECUTIVE_TRIAGE_ENABLED, false);
    this.execute = options.execute !== undefined ? options.execute : truthy(process.env.MILES_GMAIL_EXECUTIVE_TRIAGE_EXECUTE, false);
    this.service = options.service || new GmailExecutiveTriageService(options);
    this.ionosService = options.ionosService || new IonosExecutiveTriageService({ root: this.root });
    this.timer = null;
    this.running = false;
    this.lastResult = null;
  }

  persist(result) {
    const dir = path.join(this.root, "DATA", "runtime", "revenue", "gmail_triage");
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      ...result,
      generatedAt: new Date().toISOString(),
      producer: {
        pid: process.pid,
        runtimeName: process.env.MILES_RUNTIME_NAME || null,
        runtimeGeneration: process.env.MILES_RUNTIME_GENERATION || null,
        runtimeGuardPid: process.env.MILES_RUNTIME_GUARD_PID || null,
        cwd: process.cwd()
      }
    };
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
      const [gmail, ionos] = await Promise.all([
        this.service.run({ execute: this.execute }),
        this.ionosService.run({ execute: this.execute })
      ]);

      const intentionallySkippedOutOfScope = gmailSkipSafe(gmail);
      const gmailHealthy = gmail.ok === true || intentionallySkippedOutOfScope;
      const ionosHealthy = ionos.ok === true;
      const ok = gmailHealthy && ionosHealthy;

      const blockers = [
        ...(gmail.blockers || []),
        ...(ionos.errors || []).map(item => ({ account: item.account, blocker: "IONOS_PRIMARY_INBOX_UNREADABLE", error: item.error }))
      ];

      if (!gmailHealthy && blockers.length === 0) {
        blockers.push({
          account: "GMAIL_BUSINESS_TRIAGE",
          blocker: "GMAIL_COMPONENT_NOT_HEALTHY",
          serviceOk: gmail.ok === true,
          eligibleBusinessAccounts: gmail.eligibleBusinessAccounts ?? null,
          skippedOutOfBusinessScope: gmail.skippedOutOfBusinessScope ?? null
        });
      }
      if (!ionosHealthy && !(ionos.errors || []).length) {
        blockers.push({ account: "IONOS_PRIMARY_INBOXES", blocker: "IONOS_COMPONENT_NOT_HEALTHY" });
      }

      const result = {
        ok,
        status: ok ? (this.execute ? "ACTIVE" : "PLAN_ONLY") : "BLOCKED",
        enabled: true,
        execute: this.execute,
        destination: gmail.destination,
        components: {
          gmail: {
            ok: gmailHealthy,
            serviceOk: gmail.ok === true,
            intentionallySkippedAllOutOfScope: intentionallySkippedOutOfScope,
            eligibleBusinessAccounts: gmail.eligibleBusinessAccounts ?? null,
            skippedOutOfBusinessScope: gmail.skippedOutOfBusinessScope ?? null
          },
          ionos: {
            ok: ionosHealthy,
            serviceOk: ionos.ok === true,
            mode: ionos.mode || null
          }
        },
        blockers,
        accounts: gmail.accounts,
        ionos,
        safety: {
          gmail: gmail.safety,
          ionos: ionos.safety,
          primaryInboxCoverageIncludesIonos: true,
          outOfScopeGmailSkipCountsAsHealthyOnlyWhenZeroReadsAndZeroMutations: true
        }
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
module.exports.gmailSkipSafe = gmailSkipSafe;
