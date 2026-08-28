"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const AUTHORIZATION = "AUTHORIZE_ORION_AWARD_HISTORY_PERSISTENCE";

function clean(value) { return String(value || "").trim(); }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }

class AwardHistoryPersistenceService {
  constructor(options = {}) {
    this.dbPath = options.dbPath || process.env.ORION_DB || process.env.ORION_DB_PATH || "D:\\P2GC_Intelligence\\Orion Demo 6126\\orion_live_demo_ready\\ORION_DEMO_LIVE_READY.db";
    this.Database = options.Database || null;
    this.fs = options.fs || fs;
    this.now = options.now || (() => new Date());
    this.backupDir = options.backupDir || null;
  }

  loadDatabase() {
    if (this.Database) return this.Database;
    this.Database = require("better-sqlite3");
    return this.Database;
  }

  validateAudit(audit = {}) {
    const blockers = [];
    if (!audit || audit.ok !== true) blockers.push("AUDIT_NOT_OK");
    if (audit?.status !== "AUTHORITATIVE_AWARD_HISTORY_READ") blockers.push("AUDIT_NOT_AUTHORITATIVE");
    if (audit?.source?.authoritativeForPersistence !== true) blockers.push("IDENTITY_NOT_AUTHORITATIVE_FOR_PERSISTENCE");
    if (audit?.identity?.reconciliationRequired === true) blockers.push("IDENTITY_RECONCILIATION_REQUIRED");
    if (audit?.persistence?.allowed !== true) blockers.push("AUDIT_PERSISTENCE_NOT_ALLOWED");
    if (!clean(audit?.identity?.uei)) blockers.push("UEI_REQUIRED");

    const summary = audit?.summary || {};
    const expectedRevenue = number(summary.primeAwardedRevenue) + number(summary.subcontractedRevenue);
    const expectedCount = number(summary.primeAwardCount) + number(summary.subcontractAwardCount);
    if (Math.abs(number(summary.federalRevenue) - expectedRevenue) > 0.005) blockers.push("FEDERAL_REVENUE_FORMULA_MISMATCH");
    if (number(summary.awardCount) !== expectedCount) blockers.push("AWARD_COUNT_FORMULA_MISMATCH");

    return {
      ok: blockers.length === 0,
      blockers,
      uei: clean(audit?.identity?.uei).toUpperCase(),
      summary: {
        federalRevenue: number(summary.federalRevenue),
        awardCount: number(summary.awardCount),
        primeAwardedRevenue: number(summary.primeAwardedRevenue),
        primeAwardCount: number(summary.primeAwardCount),
        subcontractedRevenue: number(summary.subcontractedRevenue),
        subcontractAwardCount: number(summary.subcontractAwardCount)
      }
    };
  }

  plan(audit = {}) {
    const validation = this.validateAudit(audit);
    return {
      ok: validation.ok,
      service: "ORION_AWARD_HISTORY_PERSISTENCE",
      mode: "PLAN_ONLY",
      status: validation.ok ? "READY_FOR_AUTHORIZED_PERSISTENCE" : "BLOCKED",
      authorizationRequired: AUTHORIZATION,
      databasePath: this.dbPath,
      uei: validation.uei || null,
      summary: validation.summary,
      primeAwards: Array.isArray(audit?.primeAwards) ? audit.primeAwards.length : 0,
      subcontracts: Array.isArray(audit?.subcontracts) ? audit.subcontracts.length : 0,
      blockers: validation.blockers,
      writesPerformed: false
    };
  }

  ensureSchema(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS award_history_prime (
        contractor_id INTEGER NOT NULL, uei TEXT NOT NULL, award_id TEXT NOT NULL,
        recipient_name TEXT, start_date TEXT, end_date TEXT, amount REAL NOT NULL DEFAULT 0,
        description TEXT, awarding_agency TEXT, awarding_sub_agency TEXT, funding_agency TEXT,
        funding_sub_agency TEXT, award_type TEXT, source TEXT NOT NULL, refreshed_at TEXT NOT NULL,
        PRIMARY KEY (contractor_id, award_id)
      );
      CREATE TABLE IF NOT EXISTS award_history_subcontracts (
        contractor_id INTEGER NOT NULL, uei TEXT NOT NULL, subaward_id TEXT NOT NULL,
        prime_award_id TEXT, recipient_name TEXT, recipient_uei TEXT, action_date TEXT,
        amount REAL NOT NULL DEFAULT 0, description TEXT, awarding_agency TEXT,
        source TEXT NOT NULL, refreshed_at TEXT NOT NULL,
        PRIMARY KEY (contractor_id, subaward_id)
      );
      CREATE TABLE IF NOT EXISTS award_history_refresh_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, contractor_id INTEGER NOT NULL, uei TEXT NOT NULL,
        generated_at TEXT NOT NULL, persisted_at TEXT NOT NULL, identity_authority TEXT,
        identity_method TEXT, federal_revenue REAL NOT NULL DEFAULT 0, award_count INTEGER NOT NULL DEFAULT 0,
        prime_awarded_revenue REAL NOT NULL DEFAULT 0, prime_award_count INTEGER NOT NULL DEFAULT 0,
        subcontracted_revenue REAL NOT NULL DEFAULT 0, subcontract_award_count INTEGER NOT NULL DEFAULT 0,
        audit_fingerprint TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_award_history_prime_uei ON award_history_prime(uei);
      CREATE INDEX IF NOT EXISTS idx_award_history_subcontracts_uei ON award_history_subcontracts(uei);
      CREATE INDEX IF NOT EXISTS idx_award_history_refresh_runs_uei ON award_history_refresh_runs(uei);
    `);
  }

  resolveContractor(db, uei) {
    const rows = db.prepare("SELECT id, company, uei, federal_revenue, award_count FROM contractors WHERE UPPER(uei) = UPPER(?)").all(uei);
    if (rows.length !== 1) throw new Error(rows.length === 0 ? `ORION contractor not found for UEI ${uei}` : `ORION UEI is not unique: ${uei}`);
    return rows[0];
  }

  createBackup() {
    if (!this.fs.existsSync(this.dbPath)) throw new Error(`ORION DB not found: ${this.dbPath}`);
    const stamp = this.now().toISOString().replace(/[:.]/g, "-");
    const dir = this.backupDir || path.join(path.dirname(this.dbPath), "award_history_backups");
    this.fs.mkdirSync(dir, { recursive: true });
    const backupPath = path.join(dir, `ORION_BEFORE_AWARD_HISTORY_${stamp}.db`);
    this.fs.copyFileSync(this.dbPath, backupPath);
    return backupPath;
  }

  persist(audit = {}, options = {}) {
    const validation = this.validateAudit(audit);
    if (!validation.ok) return { ok:false, service:"ORION_AWARD_HISTORY_PERSISTENCE", status:"BLOCKED", blockers:validation.blockers, writesPerformed:false };
    if (options.authorization !== AUTHORIZATION) return { ok:false, service:"ORION_AWARD_HISTORY_PERSISTENCE", status:"AUTHORIZATION_REQUIRED", authorizationRequired:AUTHORIZATION, writesPerformed:false };
    if (options.live !== true) return { ok:false, service:"ORION_AWARD_HISTORY_PERSISTENCE", status:"LIVE_FLAG_REQUIRED", writesPerformed:false };

    const Database = this.loadDatabase();
    const backupPath = this.createBackup();
    const db = new Database(this.dbPath);
    const persistedAt = this.now().toISOString();
    const auditFingerprint = sha256(JSON.stringify(audit));

    try {
      this.ensureSchema(db);
      const contractor = this.resolveContractor(db, validation.uei);
      const insertPrime = db.prepare(`INSERT INTO award_history_prime (contractor_id, uei, award_id, recipient_name, start_date, end_date, amount, description, awarding_agency, awarding_sub_agency, funding_agency, funding_sub_agency, award_type, source, refreshed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertSub = db.prepare(`INSERT INTO award_history_subcontracts (contractor_id, uei, subaward_id, prime_award_id, recipient_name, recipient_uei, action_date, amount, description, awarding_agency, source, refreshed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

      const transaction = db.transaction(() => {
        db.prepare("DELETE FROM award_history_prime WHERE contractor_id = ?").run(contractor.id);
        db.prepare("DELETE FROM award_history_subcontracts WHERE contractor_id = ?").run(contractor.id);
        for (const row of (audit.primeAwards || [])) insertPrime.run(contractor.id, validation.uei, clean(row.awardId), row.recipientName || null, row.startDate || null, row.endDate || null, number(row.amount), row.description || null, row.awardingAgency || null, row.awardingSubAgency || null, row.fundingAgency || null, row.fundingSubAgency || null, row.awardType || null, row.source || "USAspending.gov", persistedAt);
        for (const row of (audit.subcontracts || [])) {
          const stableSubawardId = clean(row.subawardId) || sha256([row.primeAwardId, row.recipientName, row.actionDate, number(row.amount)].map(clean).join("|"));
          insertSub.run(contractor.id, validation.uei, stableSubawardId, row.primeAwardId || null, row.recipientName || null, row.recipientUei || null, row.actionDate || null, number(row.amount), row.description || null, row.awardingAgency || null, row.source || "USAspending.gov", persistedAt);
        }
        db.prepare("UPDATE contractors SET federal_revenue = ?, award_count = ? WHERE id = ?").run(validation.summary.federalRevenue, validation.summary.awardCount, contractor.id);
        db.prepare(`INSERT INTO award_history_refresh_runs (contractor_id, uei, generated_at, persisted_at, identity_authority, identity_method, federal_revenue, award_count, prime_awarded_revenue, prime_award_count, subcontracted_revenue, subcontract_award_count, audit_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(contractor.id, validation.uei, audit.generatedAt || persistedAt, persistedAt, audit?.source?.identityAuthority || null, audit?.source?.recipientMatchedBy || null, validation.summary.federalRevenue, validation.summary.awardCount, validation.summary.primeAwardedRevenue, validation.summary.primeAwardCount, validation.summary.subcontractedRevenue, validation.summary.subcontractAwardCount, auditFingerprint);
      });
      transaction();

      const after = db.prepare("SELECT id, company, uei, federal_revenue, award_count FROM contractors WHERE id = ?").get(contractor.id);
      const primeRows = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS revenue FROM award_history_prime WHERE contractor_id = ?").get(contractor.id);
      const subRows = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS revenue FROM award_history_subcontracts WHERE contractor_id = ?").get(contractor.id);
      const verified = number(after.federal_revenue) === validation.summary.federalRevenue && number(after.award_count) === validation.summary.awardCount && number(primeRows.count) === validation.summary.primeAwardCount && number(subRows.count) === validation.summary.subcontractAwardCount && Math.abs(number(primeRows.revenue) - validation.summary.primeAwardedRevenue) <= 0.005 && Math.abs(number(subRows.revenue) - validation.summary.subcontractedRevenue) <= 0.005;
      if (!verified) throw new Error("Post-persistence verification failed");
      return { ok:true, service:"ORION_AWARD_HISTORY_PERSISTENCE", status:"PERSISTED_AND_VERIFIED", contractor:after, summary:validation.summary, ledger:{ primeRows:number(primeRows.count), primeRevenue:number(primeRows.revenue), subcontractRows:number(subRows.count), subcontractRevenue:number(subRows.revenue) }, backupPath, auditFingerprint, writesPerformed:true, verified:true };
    } finally { db.close(); }
  }
}

AwardHistoryPersistenceService.AUTHORIZATION = AUTHORIZATION;
module.exports = AwardHistoryPersistenceService;
