'use strict';

const fs = require('fs');
const path = require('path');
const identity = require('./CompanyIdentityCanonicalizer');
const { clean, normalize, compact, canonical, canonicalCompact } = identity;

class SamQualifiedProspectNameResolver {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.reportPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_sam_qualified_universe_build.json');
    this.Database = options.Database || null;
    this.db = null;
    this.dbPath = null;
  }

  sourceStatus() {
    let report = null;
    try { report = JSON.parse(fs.readFileSync(this.reportPath, 'utf8').replace(/^\uFEFF/, '')); } catch {}
    const database = report?.output?.database ? path.resolve(report.output.database) : null;
    const usable = Boolean(report?.ok === true && report?.output?.sqliteIntegrity === 'ok' && report?.safety?.stagingOnly === true && report?.safety?.productionDatabaseModified === false && database && fs.existsSync(database));
    return { usable, database: usable ? database : null, reportPath:this.reportPath, generatedAt:report?.generatedAt || null, reason:usable ? null : 'SAM_QUALIFIED_UNIVERSE_NOT_USABLE' };
  }

  open() {
    const source = this.sourceStatus();
    if (!source.usable) return null;
    if (this.db && this.dbPath !== source.database) { try { this.db.close(); } catch {} this.db = null; this.dbPath = null; }
    if (!this.db) {
      if (!this.Database) this.Database = require('better-sqlite3');
      this.db = new this.Database(source.database, { readonly:true, fileMustExist:true });
      this.dbPath = source.database;
    }
    return this.db;
  }

  resolve(term) {
    const requestedTerm = clean(term);
    if (!requestedTerm) return { ok:false, status:'TERM_REQUIRED' };
    const db = this.open();
    const source = this.sourceStatus();
    if (!db) return { ok:false, status:source.reason, source };

    const targetCanonical = canonical(requestedTerm);
    const targetCompact = canonicalCompact(requestedTerm);
    if (!targetCompact) return { ok:false, status:'SAM_IDENTITY_NOT_FOUND', requestedTerm, source };

    const sqlCompact = column => `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(COALESCE(${column},'')),' ',''),'.',''),'-',''),',',''),'&','AND'),'''',''),'/',''),'(',''),')',''),'_','')`;
    const compactSql = sqlCompact('legal_name');
    const dbaCompactSql = sqlCompact('dba');
    const targetCandidates = [targetCompact, compact(requestedTerm)].filter(Boolean);
    const rows = db.prepare(`
      SELECT uei, cage, legal_name, dba, website, primary_naics, naics_codes,
             registration_expiration_date, last_update_date, source_file, source_date
      FROM sam_qualified_companies
      WHERE ${compactSql} LIKE ? OR ${dbaCompactSql} LIKE ? OR ${compactSql} LIKE ? OR ${dbaCompactSql} LIKE ?
      LIMIT 150
    `).all(
      `%${targetCandidates[0] || targetCompact}%`, `%${targetCandidates[0] || targetCompact}%`,
      `%${targetCandidates[1] || targetCompact}%`, `%${targetCandidates[1] || targetCompact}%`
    );

    const exact = rows.filter(row =>
      canonicalCompact(row.legal_name) === targetCompact ||
      canonicalCompact(row.dba) === targetCompact ||
      canonical(row.legal_name) === targetCanonical ||
      canonical(row.dba) === targetCanonical
    );
    const byUei = new Map();
    for (const row of exact) {
      const uei = clean(row.uei).toUpperCase();
      if (uei) byUei.set(uei, row);
    }
    const unique = [...byUei.values()];
    if (unique.length === 1) {
      const row = unique[0];
      return { ok:true, status:'SAM_IDENTITY_RESOLVED_BY_CANONICAL_NAME', requestedTerm, matchedBy:'SAM_CANONICAL_COMPACT_NAME', uei:clean(row.uei).toUpperCase(), cage:clean(row.cage).toUpperCase() || null, legalName:clean(row.legal_name) || null, row, source };
    }
    if (unique.length > 1) return { ok:false, status:'SAM_IDENTITY_AMBIGUOUS', requestedTerm, candidateCount:unique.length, candidates:unique.map(row=>({uei:row.uei,cage:row.cage,legalName:row.legal_name})), source };
    return { ok:false, status:'SAM_IDENTITY_NOT_FOUND', requestedTerm, candidateCount:rows.length, source };
  }

  close() { if (this.db) { try { this.db.close(); } catch {} this.db=null; this.dbPath=null; } }
}

module.exports = SamQualifiedProspectNameResolver;
module.exports.helpers = identity;
