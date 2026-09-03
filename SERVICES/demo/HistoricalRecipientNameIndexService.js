'use strict';

const fs = require('fs');
const path = require('path');
const identity = require('./CompanyIdentityCanonicalizer');
const { clean, canonicalCompact } = identity;

class HistoricalRecipientNameIndexService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.reportPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_contract_sidecar_build.json');
    this.indexPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'historical_recipient_name_index.json');
    this.Database = options.Database || null;
    this.memory = null;
  }

  sourceStatus() {
    let report = null;
    try { report = JSON.parse(fs.readFileSync(this.reportPath, 'utf8').replace(/^\uFEFF/, '')); } catch {}
    const database = report?.sidecarDb ? path.resolve(report.sidecarDb) : null;
    const usable = Boolean(report?.ok === true && report?.validation?.ok === true && report?.validation?.integrity === 'ok' && report?.safety?.sidecarOnly === true && report?.safety?.productionDatabaseModified === false && database && fs.existsSync(database));
    const stat = usable ? fs.statSync(database) : null;
    return { usable, database:usable ? database : null, databaseMtimeMs:stat?.mtimeMs || null, databaseSize:stat?.size || null, reportPath:this.reportPath, reason:usable ? null : 'ORION_VALIDATED_SIDECAR_NOT_USABLE' };
  }

  readIndex(source) {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf8').replace(/^\uFEFF/, ''));
      if (parsed?.version !== 2) return null;
      if (path.resolve(parsed.database || '') !== path.resolve(source.database || '')) return null;
      if (Number(parsed.databaseMtimeMs || 0) !== Number(source.databaseMtimeMs || 0)) return null;
      if (Number(parsed.databaseSize || 0) !== Number(source.databaseSize || 0)) return null;
      if (!parsed.byCanonicalCompact || typeof parsed.byCanonicalCompact !== 'object') return null;
      return parsed;
    } catch { return null; }
  }

  buildIndex(source) {
    if (!this.Database) this.Database = require('better-sqlite3');
    const db = new this.Database(source.database, { readonly:true, fileMustExist:true });
    try {
      const rows = db.prepare(`
        SELECT uei, recipient_name, COUNT(*) AS award_count,
               SUM(obligation) AS federal_obligations,
               MAX(action_date_last) AS latest_action_date
        FROM orion_award_refresh_fy2026
        WHERE COALESCE(uei,'')<>'' AND COALESCE(recipient_name,'')<>''
        GROUP BY uei, recipient_name
      `).all();
      const byCanonicalCompact = {};
      for (const row of rows) {
        const key = canonicalCompact(row.recipient_name);
        if (!key) continue;
        if (!byCanonicalCompact[key]) byCanonicalCompact[key] = [];
        byCanonicalCompact[key].push({
          uei:clean(row.uei).toUpperCase(),
          recipient_name:clean(row.recipient_name),
          award_count:Number(row.award_count || 0),
          federal_obligations:Number(row.federal_obligations || 0),
          latest_action_date:row.latest_action_date || null
        });
      }
      const result = {
        version:2,
        normalizationPolicy:'COMPANY_IDENTITY_CANONICALIZER_V1',
        generatedAt:new Date().toISOString(),
        database:source.database,
        databaseMtimeMs:source.databaseMtimeMs,
        databaseSize:source.databaseSize,
        canonicalNameCount:Object.keys(byCanonicalCompact).length,
        byCanonicalCompact
      };
      fs.mkdirSync(path.dirname(this.indexPath), { recursive:true });
      const tmp = `${this.indexPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(result), 'utf8');
      fs.renameSync(tmp, this.indexPath);
      this.memory = result;
      return result;
    } finally { try { db.close(); } catch {} }
  }

  ensureIndex() {
    const source = this.sourceStatus();
    if (!source.usable) return { ok:false, status:source.reason, source };
    if (this.memory && this.memory.version === 2 && path.resolve(this.memory.database || '') === path.resolve(source.database) && Number(this.memory.databaseMtimeMs) === Number(source.databaseMtimeMs) && Number(this.memory.databaseSize) === Number(source.databaseSize)) return { ok:true, status:'HISTORICAL_RECIPIENT_INDEX_MEMORY', index:this.memory, source };
    const existing = this.readIndex(source);
    if (existing) { this.memory = existing; return { ok:true, status:'HISTORICAL_RECIPIENT_INDEX_CURRENT', index:existing, source }; }
    const built = this.buildIndex(source);
    return { ok:true, status:'HISTORICAL_RECIPIENT_INDEX_REBUILT', index:built, source };
  }

  resolve(term) {
    const requestedTerm = clean(term);
    if (!requestedTerm) return { ok:false, status:'TERM_REQUIRED' };
    const prepared = this.ensureIndex();
    if (!prepared.ok) return prepared;
    const key = canonicalCompact(requestedTerm);
    const rows = prepared.index.byCanonicalCompact[key] || [];
    const byUei = new Map();
    for (const row of rows) if (row.uei) byUei.set(row.uei, row);
    const unique = [...byUei.values()];
    if (unique.length === 1) return { ok:true, status:'HISTORICAL_IDENTITY_RESOLVED_BY_INDEX', matchedBy:'USA_SPENDING_RECIPIENT_CANONICAL_COMPACT_INDEX', requestedTerm, canonicalCompact:key, row:unique[0], uei:unique[0].uei, legalName:unique[0].recipient_name, indexStatus:prepared.status, indexGeneratedAt:prepared.index.generatedAt };
    if (unique.length > 1) return { ok:false, status:'HISTORICAL_IDENTITY_AMBIGUOUS', requestedTerm, canonicalCompact:key, candidateCount:unique.length, candidates:unique, indexStatus:prepared.status };
    return { ok:false, status:'HISTORICAL_IDENTITY_NOT_FOUND', requestedTerm, canonicalCompact:key, candidateCount:0, indexStatus:prepared.status };
  }
}

module.exports = HistoricalRecipientNameIndexService;
module.exports.helpers = identity;
