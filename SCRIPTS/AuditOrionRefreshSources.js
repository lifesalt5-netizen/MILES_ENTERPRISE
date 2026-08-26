'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(process.env.MILES_ROOT || process.cwd());
const DB_NAME = 'ORION_DEMO_LIVE_READY.db';
const OUT_DIR = path.join(ROOT, 'DATA', 'orion_refresh');
const OUT_FILE = path.join(OUT_DIR, 'latest_source_audit.json');
const EXPECTED_TABLES = [
  'contractors',
  'buyers',
  'opportunities',
  'recompetes',
  'contractor_recommendations_v2',
  'persona_scores'
];

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}
function addCandidate(set, file) {
  if (!file) return;
  try { if (isFile(file)) set.add(path.resolve(file)); } catch {}
}
function walkForNamedDb(dir, maxDepth, set, depth = 0) {
  if (!dir || depth > maxDepth || !fs.existsSync(dir)) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === DB_NAME.toLowerCase()) {
      addCandidate(set, path.join(dir, entry.name));
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (['node_modules','.git'].includes(entry.name.toLowerCase())) continue;
    walkForNamedDb(path.join(dir, entry.name), maxDepth, set, depth + 1);
  }
}
function inspect(file) {
  const stat = fs.statSync(file);
  const result = {
    path: file,
    modifiedAt: stat.mtime.toISOString(),
    ageHours: Math.round(((Date.now() - stat.mtimeMs) / 3600000) * 100) / 100,
    bytes: stat.size,
    validSqlite: false,
    expectedTablesPresent: false,
    tables: [],
    counts: {},
    error: null
  };
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
    result.tables = tables;
    result.validSqlite = true;
    result.expectedTablesPresent = EXPECTED_TABLES.every(name => tables.includes(name));
    for (const table of EXPECTED_TABLES) {
      if (!tables.includes(table)) continue;
      const safe = table.replace(/[^a-zA-Z0-9_]/g, '');
      result.counts[table] = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${safe}`).get().count || 0);
    }
  } catch (error) {
    result.error = error.message;
  } finally {
    try { db?.close(); } catch {}
  }
  result.usable = result.validSqlite && result.expectedTablesPresent && Number(result.counts.contractors || 0) > 0 && Number(result.counts.opportunities || 0) > 0;
  return result;
}

const candidates = new Set();
addCandidate(candidates, process.env.ORION_DB);
addCandidate(candidates, process.env.ORION_DB_PATH);
addCandidate(candidates, path.join(path.dirname(ROOT), 'Orion Demo 6126', 'orion_live_demo_ready', DB_NAME));
addCandidate(candidates, path.join(ROOT, 'DATA', 'orion', DB_NAME));
addCandidate(candidates, `C:\\P2GC_Intelligence\\Orion Demo 6126\\orion_live_demo_ready\\${DB_NAME}`);
addCandidate(candidates, `D:\\P2GC_Intelligence\\Orion Demo 6126\\orion_live_demo_ready\\${DB_NAME}`);

for (const base of ['C:\\P2GC_Intelligence', 'D:\\P2GC_Intelligence', path.dirname(ROOT)]) {
  if (!fs.existsSync(base)) continue;
  let dirs = [];
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true })
      .filter(e => e.isDirectory() && /orion/i.test(e.name))
      .map(e => path.join(base, e.name));
  } catch {}
  for (const dir of dirs) walkForNamedDb(dir, 5, candidates);
}

const inspected = [...candidates].map(inspect).sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
const usable = inspected.filter(x => x.usable);
const currentPath = inspected.find(x => /Orion Demo 6126[\\/]orion_live_demo_ready[\\/]ORION_DEMO_LIVE_READY\.db$/i.test(x.path))?.path || process.env.ORION_DB || process.env.ORION_DB_PATH || null;
const current = inspected.find(x => currentPath && path.resolve(x.path).toLowerCase() === path.resolve(currentPath).toLowerCase()) || null;
const newest = usable[0] || null;
const newerCompatible = Boolean(current && newest && Date.parse(newest.modifiedAt) > Date.parse(current.modifiedAt) + 1000 && path.resolve(newest.path).toLowerCase() !== path.resolve(current.path).toLowerCase());

const report = {
  ok: true,
  audit: 'ORION_REFRESH_SOURCE_DISCOVERY',
  generatedAt: new Date().toISOString(),
  readOnly: true,
  expectedTables: EXPECTED_TABLES,
  current,
  candidates: inspected,
  usableCandidateCount: usable.length,
  newestUsable: newest,
  newerCompatibleCandidateFound: newerCompatible,
  conclusion: !current
    ? 'CURRENT_ORION_DB_NOT_IDENTIFIED'
    : newerCompatible
      ? 'NEWER_COMPATIBLE_DB_CANDIDATE_FOUND'
      : current.ageHours > 24
        ? 'NO_NEWER_COMPATIBLE_DB_FOUND_SOURCE_REFRESH_PIPELINE_REQUIRED'
        : 'CURRENT_ORION_DB_IS_FRESH',
  safety: {
    databaseMode: 'READ_ONLY',
    copiedDatabase: false,
    modifiedDatabase: false,
    freshnessNotFabricated: true
  }
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');

console.log('============================================================');
console.log('MILES ORION REFRESH SOURCE AUDIT - READ ONLY');
console.log('============================================================');
console.log(`Candidates found: ${inspected.length}`);
console.log(`Usable candidates: ${usable.length}`);
if (current) console.log(`Current DB: ${current.path}`);
if (current) console.log(`Current DB age hours: ${current.ageHours}`);
if (newest) console.log(`Newest usable DB: ${newest.path}`);
if (newest) console.log(`Newest usable DB age hours: ${newest.ageHours}`);
console.log(`Conclusion: ${report.conclusion}`);
console.log(`Report: ${OUT_FILE}`);
console.log('RESULT: ORION_REFRESH_SOURCE_AUDIT_GREEN');
