'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_NAME = 'ORION_DEMO_LIVE_READY.db';
const EXPECTED_TABLES = [
  'contractors', 'buyers', 'opportunities', 'recompetes',
  'contractor_recommendations_v2', 'persona_scores'
];

function safeStat(file) {
  try { return fs.statSync(file); } catch { return null; }
}

function sha256File(file, maxBytes = 8 * 1024 * 1024) {
  const stat = safeStat(file);
  if (!stat || !stat.isFile()) return null;
  const fd = fs.openSync(file, 'r');
  try {
    const size = Math.min(stat.size, maxBytes);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function classifySourceFile(file) {
  const name = path.basename(String(file || '')).toLowerCase();
  const ext = path.extname(name);
  if (name === DB_NAME.toLowerCase()) return 'ORION_DB';
  if (ext === '.zip' && /usaspending|award|contract|subaward|prime/.test(name)) return 'USASPENDING_ARCHIVE';
  if (ext === '.csv' && /usaspending|award|contract|subaward|prime|sam|gsa|recompete|buyer/.test(name)) return 'SOURCE_CSV';
  if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') return 'SQLITE_DB';
  return null;
}

function readCsvHeader(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(64 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const first = buf.subarray(0, n).toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
      return first.slice(0, 20000);
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

function scoreSourceCandidate(row, currentDbMtimeMs = 0) {
  let score = 0;
  if (row.type === 'USASPENDING_ARCHIVE') score += 40;
  if (row.type === 'SOURCE_CSV') score += 30;
  if (row.type === 'ORION_DB') score += 20;
  if (row.type === 'SQLITE_DB') score += 10;
  if (row.mtimeMs > currentDbMtimeMs) score += 25;
  if (row.size >= 1024 * 1024) score += 10;
  if (/2026|2025/.test(row.name || '')) score += 5;
  return score;
}

function walk(root, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 4;
  const maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : 25000;
  const out = [];
  const ignore = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information']);

  function visit(dir, depth) {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignore.has(entry.name.toLowerCase())) visit(full, depth + 1);
      } else if (entry.isFile()) {
        const type = classifySourceFile(full);
        if (type) out.push({ file: full, type });
      }
    }
  }

  if (root && fs.existsSync(root)) visit(root, 0);
  return out;
}

function normalizeIntegrityMode(value) {
  const mode = String(value || 'FULL').trim().toUpperCase();
  if (mode === 'SCHEMA_ONLY' || mode === 'QUICK' || mode === 'FULL') return mode;
  return 'FULL';
}

function inspectDb(file, options = {}) {
  const stat = safeStat(file);
  if (!stat || !stat.isFile()) return { ok: false, reason: 'FILE_NOT_FOUND', path: file };
  const integrityMode = normalizeIntegrityMode(options.integrityMode);
  const countRows = options.countRows !== false;
  let Database;
  try { Database = require('better-sqlite3'); }
  catch (error) { return { ok: false, reason: 'BETTER_SQLITE3_UNAVAILABLE', path: file, error: error.message }; }

  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    let integrity = 'NOT_RUN_SCHEMA_ONLY';
    if (integrityMode === 'FULL') integrity = db.pragma('integrity_check', { simple: true });
    else if (integrityMode === 'QUICK') integrity = db.pragma('quick_check', { simple: true });

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x => x.name);
    const schema = {};
    const counts = {};
    for (const table of tables) {
      const safe = String(table).replace(/[^A-Za-z0-9_]/g, '');
      if (!safe) continue;
      try {
        schema[safe] = db.prepare(`PRAGMA table_info(${safe})`).all().map(col => ({ name: col.name, type: col.type, notnull: Boolean(col.notnull), pk: Boolean(col.pk) }));
        if (countRows && EXPECTED_TABLES.includes(safe)) counts[safe] = db.prepare(`SELECT COUNT(*) AS count FROM ${safe}`).get().count;
      } catch {}
    }
    const integrityOk = integrityMode === 'SCHEMA_ONLY' || String(integrity).toLowerCase() === 'ok';
    return {
      ok: integrityOk,
      path: file,
      integrity,
      integrityMode,
      verificationLevel: integrityMode === 'SCHEMA_ONLY' ? 'READABLE_SCHEMA_ONLY' : `${integrityMode}_INTEGRITY_CHECK`,
      rowCountsCollected: countRows,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      mtimeMs: stat.mtimeMs,
      tables,
      expectedTablesPresent: EXPECTED_TABLES.filter(t => tables.includes(t)),
      expectedTablesMissing: EXPECTED_TABLES.filter(t => !tables.includes(t)),
      counts,
      schema
    };
  } catch (error) {
    return { ok: false, reason: 'SQLITE_OPEN_FAILED', path: file, error: error.message, integrityMode };
  } finally {
    try { if (db) db.close(); } catch {}
  }
}

function resolveCurrentDb(rootDir) {
  const parent = path.dirname(rootDir);
  const candidates = [
    process.env.ORION_DB,
    process.env.ORION_DB_PATH,
    path.join(parent, 'Orion Demo 6126', 'orion_live_demo_ready', DB_NAME),
    'C:\\P2GC_Intelligence\\Orion Demo 6126\\orion_live_demo_ready\\ORION_DEMO_LIVE_READY.db',
    'D:\\P2GC_Intelligence\\Orion Demo 6126\\orion_live_demo_ready\\ORION_DEMO_LIVE_READY.db'
  ].filter(Boolean);
  return candidates.find(f => safeStat(f)?.isFile()) || candidates[0];
}

class OrionRebuildReadinessService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.outputDir = path.resolve(options.outputDir || path.join(this.rootDir, 'DATA', 'orion_refresh'));
    this.currentDb = path.resolve(options.currentDb || resolveCurrentDb(this.rootDir));
    this.searchRoots = options.searchRoots || [
      path.dirname(this.rootDir),
      process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads') : null,
      'C:\\P2GC_Intelligence',
      'D:\\P2GC_Intelligence'
    ].filter(Boolean);
    this.dbIntegrityMode = normalizeIntegrityMode(options.dbIntegrityMode || 'FULL');
    this.countRows = options.countRows !== false;
    this.hashCandidates = options.hashCandidates !== false;
  }

  run() {
    const dbInspection = { integrityMode: this.dbIntegrityMode, countRows: this.countRows };
    const current = inspectDb(this.currentDb, dbInspection);
    const seen = new Set();
    const candidates = [];

    for (const root of this.searchRoots) {
      for (const item of walk(root, { maxDepth: 5, maxFiles: 30000 })) {
        const key = path.resolve(item.file).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const stat = safeStat(item.file);
        if (!stat) continue;
        const row = {
          path: path.resolve(item.file),
          name: path.basename(item.file),
          type: item.type,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          mtimeMs: stat.mtimeMs,
          newerThanCurrent: Boolean(current?.mtimeMs && stat.mtimeMs > current.mtimeMs),
          sampleSha256: this.hashCandidates ? sha256File(item.file) : null
        };
        if (item.type === 'SOURCE_CSV') row.header = readCsvHeader(item.file);
        if (item.type === 'ORION_DB' || item.type === 'SQLITE_DB') row.database = inspectDb(item.file, dbInspection);
        row.score = scoreSourceCandidate(row, current?.mtimeMs || 0);
        candidates.push(row);
      }
    }

    candidates.sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs);
    const sourceFiles = candidates.filter(x => ['USASPENDING_ARCHIVE', 'SOURCE_CSV'].includes(x.type));
    const compatibleDbs = candidates.filter(x => x.database?.ok && x.database.expectedTablesMissing?.length === 0);
    const newerInputs = sourceFiles.filter(x => x.newerThanCurrent);

    const blockers = [];
    if (!current.ok) blockers.push('CURRENT_ORION_DB_NOT_READABLE');
    if (current.ok && current.expectedTablesMissing?.length) blockers.push('CURRENT_ORION_EXPECTED_TABLES_MISSING');
    if (!sourceFiles.length) blockers.push('NO_LOCAL_REFRESH_SOURCE_FILES_FOUND');
    if (sourceFiles.length && !newerInputs.length) blockers.push('NO_SOURCE_FILES_NEWER_THAN_CURRENT_DB');

    const result = {
      ok: true,
      service: 'ORION_REBUILD_READINESS',
      generatedAt: new Date().toISOString(),
      safety: {
        readOnly: true,
        activeDatabaseModified: false,
        downloadsStarted: false,
        promotionAttempted: false
      },
      inspection: {
        dbIntegrityMode: this.dbIntegrityMode,
        rowCountsCollected: this.countRows,
        candidateHashesCollected: this.hashCandidates,
        note: this.dbIntegrityMode === 'SCHEMA_ONLY'
          ? 'Readiness discovery verifies DB readability and schema only; staging promotion still requires full integrity validation.'
          : null
      },
      current,
      searchRoots: this.searchRoots,
      summary: {
        candidates: candidates.length,
        sourceFiles: sourceFiles.length,
        newerSourceFiles: newerInputs.length,
        compatibleDatabases: compatibleDbs.length,
        blockers
      },
      candidates: candidates.slice(0, 250),
      reconstructionContract: {
        nextStep: newerInputs.length ? 'BUILD_STAGING_DB_FROM_DISCOVERED_SOURCES' : 'ACQUIRE_CURRENT_OFFICIAL_SOURCE_DATA_FIRST',
        requiredBeforePromotion: [
          'STAGING_DB_ONLY',
          'SQLITE_INTEGRITY_OK',
          'EXPECTED_TABLES_PRESENT',
          'ROW_COUNT_SANITY_CHECKS',
          'SOURCE_PROVENANCE_RECORDED',
          'BACKUP_CURRENT_DB',
          'ATOMIC_PROMOTION_WITH_ROLLBACK'
        ]
      }
    };

    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(path.join(this.outputDir, 'latest_rebuild_readiness.json'), JSON.stringify(result, null, 2), 'utf8');
    return result;
  }
}

module.exports = OrionRebuildReadinessService;
module.exports.classifySourceFile = classifySourceFile;
module.exports.scoreSourceCandidate = scoreSourceCandidate;
module.exports.readCsvHeader = readCsvHeader;
module.exports.inspectDb = inspectDb;
module.exports.normalizeIntegrityMode = normalizeIntegrityMode;
module.exports.EXPECTED_TABLES = EXPECTED_TABLES;
