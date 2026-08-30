'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return null; }
}
function upper(v) { return String(v || '').trim().toUpperCase(); }

class OrionSidecarOverlayService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.reportPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_contract_sidecar_build.json');
    this.Database = options.Database || null;
    this.db = null;
    this.report = null;
  }

  loadDatabase() {
    if (!this.Database) this.Database = require('better-sqlite3');
    return this.Database;
  }

  status() {
    this.report = readJson(this.reportPath);
    const usable = Boolean(
      this.report?.ok === true &&
      this.report?.validation?.ok === true &&
      this.report?.safety?.sidecarOnly === true &&
      this.report?.safety?.productionDatabaseModified === false &&
      this.report?.sidecarDb && fs.existsSync(this.report.sidecarDb)
    );
    return {
      usable,
      reportPath: this.reportPath,
      sidecarDb: usable ? this.report.sidecarDb : null,
      source: usable ? this.report.source : null,
      validation: usable ? this.report.validation : null,
      scope: usable ? 'FY2026 USAspending contract award-derived overlay' : null
    };
  }

  open() {
    const status = this.status();
    if (!status.usable) return null;
    if (!this.db) {
      const Database = this.loadDatabase();
      this.db = new Database(status.sidecarDb, { readonly: true, fileMustExist: true });
    }
    return this.db;
  }

  contractorSummary(ueis = []) {
    const db = this.open();
    if (!db) return new Map();
    const keys = [...new Set(ueis.map(upper).filter(Boolean))];
    const out = new Map();
    const get = db.prepare('SELECT uei, federal_obligations, award_count, latest_action_date, refreshed_at FROM orion_contractor_fy2026_summary WHERE UPPER(uei)=?');
    for (const key of keys) {
      const row = get.get(key);
      if (row) out.set(key, row);
    }
    return out;
  }

  enrichContractors(rows = []) {
    const status = this.status();
    if (!status.usable || !Array.isArray(rows) || rows.length === 0) return rows;
    const summary = this.contractorSummary(rows.map(x => x?.uei));
    return rows.map(row => {
      const fresh = summary.get(upper(row?.uei));
      if (!fresh) return { ...row, award_data_freshness: 'CURRENT_SOURCE_NO_FY2026_MATCH', award_data_scope: status.scope, award_data_source_updated_date: status.source?.updatedDate || null };
      return {
        ...row,
        fy2026_federal_obligations: Number(fresh.federal_obligations || 0),
        fy2026_award_count: Number(fresh.award_count || 0),
        fy2026_latest_action_date: fresh.latest_action_date || null,
        award_data_freshness: 'CURRENT_OFFICIAL_SOURCE',
        award_data_scope: status.scope,
        award_data_source_updated_date: status.source?.updatedDate || null,
        award_data_refreshed_at: fresh.refreshed_at || null
      };
    });
  }

  getBuyerRows(limit = 100, offset = 0) {
    const db = this.open();
    if (!db) return [];
    const n = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const o = Math.max(0, Number(offset) || 0);
    return db.prepare(`SELECT uei, buyer_name, agency, award_count, spend, refreshed_at
      FROM orion_buyer_fy2026_summary ORDER BY spend DESC LIMIT ? OFFSET ?`).all(n, o);
  }

  getRecompeteRows(limit = 100, offset = 0) {
    const db = this.open();
    if (!db) return [];
    const n = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const o = Math.max(0, Number(offset) || 0);
    return db.prepare(`SELECT uei, award_key, title, agency, recompete_date, value, refreshed_at
      FROM orion_recompete_fy2026 ORDER BY recompete_date ASC LIMIT ? OFFSET ?`).all(n, o);
  }

  close() {
    if (this.db) { try { this.db.close(); } catch {} this.db = null; }
  }
}

module.exports = OrionSidecarOverlayService;
