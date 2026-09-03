'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const OrionComponentFreshnessService = require('../SERVICES/orion/OrionComponentFreshnessService');
const OrionSidecarOverlayService = require('../SERVICES/orion/OrionSidecarOverlayService');

const EXPECTED_TABLES = Object.freeze([
  'orion_award_refresh_fy2026',
  'orion_contractor_fy2026_summary',
  'orion_buyer_fy2026_summary',
  'orion_recompete_fy2026'
]);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return null; }
}

function buildEvidence(sidecar, actualBytes) {
  if (!sidecar?.ok) throw new Error('ORION_SIDECAR_REPORT_NOT_GREEN');
  if (sidecar?.safety?.productionDatabaseModified !== false || sidecar?.safety?.sidecarOnly !== true) {
    throw new Error('ORION_SIDECAR_SAFETY_ASSERTION_FAILED');
  }
  if (sidecar?.validation?.ok !== true || sidecar?.validation?.integrity !== 'ok') {
    throw new Error('ORION_SIDECAR_BUILD_VALIDATION_NOT_GREEN');
  }
  const counts = {
    integrity: sidecar.validation.integrity,
    awards: Number(sidecar.validation.awardRows || 0),
    contractors: Number(sidecar.validation.summaryRows || 0),
    buyers: Number(sidecar.validation.buyerRows || 0),
    recompetes: Number(sidecar.validation.recompeteRows || 0)
  };
  if (counts.awards <= 0 || counts.contractors <= 0 || counts.buyers <= 0 || counts.recompetes <= 0) {
    throw new Error(`ORION_SIDECAR_BUILD_COUNTS_INVALID:${JSON.stringify(counts)}`);
  }
  const reportedBytes = Number(sidecar.sidecarBytes || 0);
  if (reportedBytes > 0 && Number(actualBytes) !== reportedBytes) {
    throw new Error(`ORION_SIDECAR_SIZE_MISMATCH:${reportedBytes}:${actualBytes}`);
  }
  return counts;
}

function fastReadAudit(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const names = new Set(rows.map(row => String(row?.name || '')));
  const missingTables = EXPECTED_TABLES.filter(name => !names.has(name));
  if (missingTables.length) throw new Error(`ORION_SIDECAR_EXPECTED_TABLES_MISSING:${missingTables.join(',')}`);

  const readable = {};
  for (const table of EXPECTED_TABLES) {
    const row = db.prepare(`SELECT 1 AS readable FROM ${table} LIMIT 1`).get();
    readable[table] = row?.readable === 1;
    if (!readable[table]) throw new Error(`ORION_SIDECAR_TABLE_NOT_READABLE:${table}`);
  }
  return { expectedTables: EXPECTED_TABLES.slice(), missingTables: [], readable };
}

function main() {
  const rootDir = path.resolve(process.argv[2] || process.env.MILES_ROOT || path.resolve(__dirname, '..'));
  process.env.MILES_ROOT = rootDir;
  const reportPath = path.join(rootDir, 'DATA', 'orion_refresh', 'latest_contract_sidecar_build.json');
  const sidecar = readJson(reportPath);
  if (!sidecar?.sidecarDb || !fs.existsSync(sidecar.sidecarDb)) throw new Error('ORION_SIDECAR_DB_MISSING');

  const stat = fs.statSync(sidecar.sidecarDb);
  const counts = buildEvidence(sidecar, stat.size);
  const db = new Database(sidecar.sidecarDb, { readonly: true, fileMustExist: true });
  let readAudit;
  try { readAudit = fastReadAudit(db); }
  finally { db.close(); }

  const freshness = new OrionComponentFreshnessService({ rootDir }).run(null);
  if (!freshness.sidecarUsable) throw new Error('ORION_COMPONENT_FRESHNESS_DID_NOT_ACCEPT_SIDECAR');
  const overlay = new OrionSidecarOverlayService({ rootDir });
  let overlayStatus;
  try { overlayStatus = overlay.status(); }
  finally { overlay.close(); }
  if (overlayStatus?.usable !== true) throw new Error('ORION_SIDECAR_OVERLAY_NOT_USABLE');

  const result = {
    ok: true,
    service: 'ORION_POST_REFRESH_VALIDATION',
    generatedAt: new Date().toISOString(),
    validationMode: 'BUILD_EVIDENCE_PLUS_READ_ONLY_SCHEMA_AND_SAMPLE',
    buildIntegrityEvidenceReused: true,
    fullIntegrityRescanPerformed: false,
    sidecarDb: sidecar.sidecarDb,
    sidecarBytes: stat.size,
    counts,
    readAudit,
    source: sidecar.source || null,
    validation: sidecar.validation || null,
    componentFreshness: freshness,
    overlayStatus,
    safety: {
      readOnly: true,
      productionDatabaseModified: false,
      sidecarModified: false,
      fullFreshnessClaimed: freshness.fullyFresh === true,
      immutableBuildEvidenceRequired: true,
      multiMillionRowRescanAvoided: true
    }
  };
  const out = path.join(rootDir, 'DATA', 'orion_refresh', 'latest_post_refresh_validation.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(JSON.stringify({ ok: false, service: 'ORION_POST_REFRESH_VALIDATION', error: error.message }, null, 2));
    process.exitCode = 2;
  }
}

module.exports = { main, buildEvidence, fastReadAudit, EXPECTED_TABLES };
