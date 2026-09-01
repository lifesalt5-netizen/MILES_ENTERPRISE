'use strict';

const fs = require('fs');
const path = require('path');

function text(value) { return String(value == null ? '' : value).trim(); }
function norm(value) {
  return text(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function domain(value) {
  const raw = text(value).toLowerCase();
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./, '');
  }
}
function significantTokens(value) {
  const stop = new Set(['LLC','INC','INCORPORATED','CORP','CORPORATION','CO','COMPANY','LTD','LIMITED','THE','AND','OF','SERVICES','SERVICE']);
  return norm(value).split(' ').filter(token => token.length >= 3 && !stop.has(token));
}
function candidateScore(term, row = {}) {
  const raw = text(term);
  const upper = raw.toUpperCase();
  const wanted = norm(raw);
  const legal = norm(row.legal_name);
  const dba = norm(row.dba);
  if (!wanted) return -1;
  if (text(row.uei).toUpperCase() === upper) return 1000;
  if (text(row.cage).toUpperCase() === upper) return 950;
  const wantedDomain = domain(raw);
  const rowDomain = domain(row.website);
  if (wantedDomain && rowDomain && wantedDomain === rowDomain) return 900;
  if (legal === wanted || dba === wanted) return 850;
  if (legal.includes(wanted) || wanted.includes(legal)) return 700;
  if (dba && (dba.includes(wanted) || wanted.includes(dba))) return 680;
  const tokens = significantTokens(wanted);
  if (!tokens.length) return -1;
  const legalTokens = new Set(significantTokens(legal));
  const dbaTokens = new Set(significantTokens(dba));
  const matches = tokens.filter(token => legalTokens.has(token) || dbaTokens.has(token)).length;
  const ratio = matches / tokens.length;
  if (matches === 0) return -1;
  return 300 + Math.round(ratio * 300) + matches * 10;
}

class SamQualifiedIdentityService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.reportPath = options.reportPath || path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_sam_qualified_universe_build.json');
    this.databasePath = options.databasePath || null;
    this.Database = options.Database || null;
  }

  report() {
    try {
      return JSON.parse(fs.readFileSync(this.reportPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      return null;
    }
  }

  resolveDatabase() {
    if (this.databasePath && fs.existsSync(this.databasePath)) return path.resolve(this.databasePath);
    const report = this.report();
    const fromReport = text(report?.output?.database);
    if (fromReport && fs.existsSync(fromReport)) return path.resolve(fromReport);
    const dir = path.join(this.rootDir, 'DATA', 'orion_refresh', 'sam_qualified_staging');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter(name => /^SAM_QUALIFIED_.*\.db$/i.test(name))
      .map(name => ({ file: path.join(dir, name), mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0]?.file || null;
  }

  loadDatabase() {
    const database = this.resolveDatabase();
    if (!database) return { ok: false, status: 'SAM_QUALIFIED_UNIVERSE_UNAVAILABLE', database: null, db: null, report: this.report() };
    const Database = this.Database || require('better-sqlite3');
    try {
      return { ok: true, status: 'SAM_QUALIFIED_UNIVERSE_READY', database, db: new Database(database, { readonly: true }), report: this.report() };
    } catch (error) {
      return { ok: false, status: 'SAM_QUALIFIED_UNIVERSE_OPEN_FAILED', database, db: null, report: this.report(), error: error.message };
    }
  }

  queryCandidates(db, term, limit = 100) {
    const raw = text(term);
    const upper = raw.toUpperCase();
    const wantedDomain = domain(raw);
    const exact = db.prepare(`
      SELECT * FROM sam_qualified_companies
      WHERE UPPER(uei) = ? OR UPPER(cage) = ?
      LIMIT 10
    `).all(upper, upper);
    if (exact.length) return exact;

    if (wantedDomain && /\./.test(wantedDomain)) {
      const websiteRows = db.prepare(`
        SELECT * FROM sam_qualified_companies
        WHERE LOWER(website) LIKE ?
        LIMIT ?
      `).all(`%${wantedDomain}%`, Math.max(1, Math.min(Number(limit) || 100, 250)));
      if (websiteRows.length) return websiteRows;
    }

    const tokens = significantTokens(raw);
    const anchors = [...tokens].sort((a, b) => b.length - a.length).slice(0, 3);
    if (!anchors.length) return [];
    const clauses = anchors.map(() => '(UPPER(legal_name) LIKE ? OR UPPER(COALESCE(dba,\'\')) LIKE ?)').join(' AND ');
    const params = [];
    for (const token of anchors) params.push(`%${token}%`, `%${token}%`);
    params.push(Math.max(1, Math.min(Number(limit) || 100, 250)));
    let rows = db.prepare(`SELECT * FROM sam_qualified_companies WHERE ${clauses} LIMIT ?`).all(...params);
    if (!rows.length && anchors.length > 1) {
      rows = db.prepare(`
        SELECT * FROM sam_qualified_companies
        WHERE UPPER(legal_name) LIKE ? OR UPPER(COALESCE(dba,'')) LIKE ?
        LIMIT ?
      `).all(`%${anchors[0]}%`, `%${anchors[0]}%`, Math.max(1, Math.min(Number(limit) || 100, 250)));
    }
    return rows;
  }

  lookup(term, options = {}) {
    const raw = text(term);
    if (!raw) return { ok: false, status: 'TERM_REQUIRED', record: null, candidates: [] };
    const loaded = this.loadDatabase();
    if (!loaded.ok) return { ok: false, status: loaded.status, record: null, candidates: [], evidence: this.evidence(loaded) };
    try {
      const rows = this.queryCandidates(loaded.db, raw, options.limit || 100)
        .map(row => ({ row, score: candidateScore(raw, row) }))
        .filter(item => item.score >= 500)
        .sort((a, b) => b.score - a.score || String(a.row.legal_name).localeCompare(String(b.row.legal_name)));
      const best = rows[0] || null;
      if (!best) {
        return {
          ok: false,
          status: 'SAM_QUALIFIED_IDENTITY_NOT_FOUND',
          record: null,
          candidates: [],
          evidence: this.evidence(loaded)
        };
      }
      const record = this.normalizeRecord(best.row, best.score);
      return {
        ok: true,
        status: 'SAM_QUALIFIED_IDENTITY_MATCHED',
        record,
        candidates: rows.slice(0, 5).map(item => this.normalizeRecord(item.row, item.score)),
        evidence: this.evidence(loaded)
      };
    } finally {
      try { loaded.db.close(); } catch {}
    }
  }

  normalizeRecord(row = {}, score = null) {
    return {
      source: 'SAM_QUALIFIED_UNIVERSE',
      sourceStatus: 'CURRENT_QUALIFIED_ACTIVE_REGISTRATION',
      matchScore: score,
      legalBusinessName: text(row.legal_name) || null,
      dbaName: text(row.dba) || null,
      uei: text(row.uei).toUpperCase() || null,
      cage: text(row.cage).toUpperCase() || null,
      registrationStatus: 'ACTIVE',
      registrationExpirationDate: text(row.registration_expiration_date) || null,
      lastUpdateDate: text(row.last_update_date) || null,
      activationDate: text(row.activation_date) || null,
      website: text(row.website) || null,
      entityStructure: text(row.entity_structure) || null,
      businessTypeCodes: text(row.business_type_codes) || null,
      primaryNaics: text(row.primary_naics) || null,
      naicsCodes: text(row.naics_codes) || null,
      sbaBusinessTypeCodes: text(row.sba_business_type_codes) || null,
      city: text(row.city) || null,
      state: text(row.state) || null,
      zip: text(row.zip) || null,
      country: text(row.country) || null
    };
  }

  evidence(loaded = {}) {
    const report = loaded.report || this.report();
    return {
      source: 'SAM_QUALIFIED_UNIVERSE',
      reportGeneratedAt: report?.generatedAt || null,
      sourceDate: report?.source?.date || null,
      storedQualifiedCompanies: report?.output?.storedQualifiedCompanies ?? null,
      databaseAvailable: Boolean(loaded.database),
      readOnly: true,
      operationalMutation: false
    };
  }
}

module.exports = SamQualifiedIdentityService;
module.exports.norm = norm;
module.exports.domain = domain;
module.exports.significantTokens = significantTokens;
module.exports.candidateScore = candidateScore;
