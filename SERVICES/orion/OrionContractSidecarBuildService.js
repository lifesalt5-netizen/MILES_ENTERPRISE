'use strict';

const fs = require('fs');
const path = require('path');
const OrionContractStagingBuildService = require('./OrionContractStagingBuildService');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function now() { return new Date().toISOString(); }
function freeBytesFor(targetPath) {
  try {
    if (typeof fs.statfsSync !== 'function') return null;
    const root = path.parse(path.resolve(targetPath)).root || targetPath;
    const stat = fs.statfsSync(root);
    return Number(stat.bavail ?? stat.bfree ?? 0) * Number(stat.bsize ?? stat.frsize ?? 0);
  } catch { return null; }
}

class OrionContractSidecarBuildService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.base = new OrionContractStagingBuildService({ rootDir: this.rootDir, Database: options.Database || null, batchSize: options.batchSize, progressEvery: options.progressEvery });
    this.Database = options.Database || null;
    this.stagingDir = path.join(this.rootDir, 'DATA', 'orion_refresh', 'staging_db');
    this.reportPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_contract_sidecar_build.json');
    this.oldReportPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_contract_staging_build.json');
    this.minFreeBytes = Math.max(1024 * 1024 * 1024, Number(options.minFreeBytes || process.env.ORION_SIDECAR_MIN_FREE_BYTES || 8 * 1024 * 1024 * 1024));
  }

  loadDatabase() {
    if (!this.Database) this.Database = require('better-sqlite3');
    return this.Database;
  }

  cleanupFailedStagingCandidates() {
    fs.mkdirSync(this.stagingDir, { recursive: true });
    const keep = new Set();
    const reports = [readJson(this.reportPath), readJson(this.oldReportPath)].filter(Boolean);
    for (const report of reports) {
      if (report?.ok === true && report?.stagingDb) keep.add(path.resolve(report.stagingDb));
    }
    const removed = [];
    for (const name of fs.readdirSync(this.stagingDir)) {
      if (!/^ORION_CONTRACT_STAGING_.*\.db$/i.test(name) && !/^ORION_CONTRACT_SIDECAR_.*\.partial\.db$/i.test(name)) continue;
      const file = path.resolve(this.stagingDir, name);
      if (keep.has(file)) continue;
      const stat = fs.statSync(file);
      fs.unlinkSync(file);
      removed.push({ file, bytes: stat.size });
    }
    return { removed, recoveredBytes: removed.reduce((s, x) => s + x.bytes, 0) };
  }

  preparePaths(sourceDate) {
    fs.mkdirSync(this.stagingDir, { recursive: true });
    const stamp = now().replace(/[:.]/g, '-');
    const source = String(sourceDate || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '_');
    const finalPath = path.join(this.stagingDir, `ORION_CONTRACT_SIDECAR_${source}_${stamp}.db`);
    const partialPath = finalPath.replace(/\.db$/i, '.partial.db');
    return { finalPath, partialPath };
  }

  validateSidecar(db, productionDbPath) {
    const integrity = db.pragma('integrity_check', { simple: true });
    const awardRows = Number(db.prepare('SELECT COUNT(*) AS n FROM orion_award_refresh_fy2026').get().n || 0);
    const summaryRows = Number(db.prepare('SELECT COUNT(*) AS n FROM orion_contractor_fy2026_summary').get().n || 0);
    const buyerRows = Number(db.prepare('SELECT COUNT(*) AS n FROM orion_buyer_fy2026_summary').get().n || 0);
    const recompeteRows = Number(db.prepare('SELECT COUNT(*) AS n FROM orion_recompete_fy2026').get().n || 0);
    const Database = this.loadDatabase();
    const prod = new Database(productionDbPath, { readonly: true, fileMustExist: true });
    let matchedContractors = 0;
    try {
      const known = new Set(prod.prepare("SELECT UPPER(TRIM(uei)) AS uei FROM contractors WHERE uei IS NOT NULL AND TRIM(uei) <> ''").all().map(x => x.uei));
      const rows = db.prepare('SELECT uei FROM orion_contractor_fy2026_summary').all();
      for (const row of rows) if (known.has(String(row.uei || '').trim().toUpperCase())) matchedContractors++;
    } finally { prod.close(); }
    return {
      ok: integrity === 'ok' && awardRows > 0 && summaryRows > 0,
      integrity,
      awardRows,
      summaryRows,
      buyerRows,
      recompeteRows,
      matchedContractors,
      unmatchedContractors: Math.max(0, summaryRows - matchedContractors)
    };
  }

  async run() {
    const cleanup = this.cleanupFailedStagingCandidates();
    const inputs = this.base.validateInputs();
    const freeBefore = freeBytesFor(this.stagingDir);
    if (freeBefore != null && freeBefore < this.minFreeBytes) {
      throw new Error(`INSUFFICIENT_FREE_SPACE_AFTER_SAFE_CLEANUP:${freeBefore}:required=${this.minFreeBytes}`);
    }

    const { finalPath, partialPath } = this.preparePaths(inputs.full.updatedDate || inputs.acquisition.planGeneratedAt);
    const Database = this.loadDatabase();
    const db = new Database(partialPath);
    let imported, validation;
    try {
      db.pragma('journal_mode = DELETE');
      db.pragma('synchronous = NORMAL');
      this.base.ensureSchema(db);
      imported = await this.base.importFullArchive(db, inputs.full);
      this.base.derive(db, imported.refreshedAt);
      validation = this.validateSidecar(db, inputs.schemaAudit.currentDb);
      if (!validation.ok) throw new Error(`SIDECAR_VALIDATION_FAILED:${JSON.stringify(validation)}`);
      db.prepare(`INSERT OR REPLACE INTO orion_source_refresh_manifest
        (source_family,source_scope,source_updated_date,source_archive,source_sha256,transaction_rows,award_rows,contractor_summary_rows,imported_at,production_promoted,notes)
        VALUES (?,?,?,?,?,?,?,?,?,0,?)`).run(
          'USAspending contracts',
          'FY2026 full contract archive sidecar',
          inputs.full.updatedDate || null,
          inputs.full.fileName || null,
          inputs.full.sha256 || null,
          imported.transactionRows,
          validation.awardRows,
          validation.summaryRows,
          imported.refreshedAt,
          'Sidecar-only refresh. Production ORION core database and core tables remain untouched.'
        );
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (error) {
      try { db.close(); } catch {}
      try { fs.unlinkSync(partialPath); } catch {}
      throw error;
    }
    db.close();
    fs.renameSync(partialPath, finalPath);
    const finalStat = fs.statSync(finalPath);
    const freeAfter = freeBytesFor(this.stagingDir);
    const result = {
      ok: true,
      service: 'ORION_CONTRACT_SIDECAR_BUILD',
      generatedAt: now(),
      productionDb: inputs.schemaAudit.currentDb,
      sidecarDb: finalPath,
      sidecarBytes: finalStat.size,
      cleanup,
      storage: { freeBefore, freeAfter, minFreeBytes: this.minFreeBytes },
      source: { archive: inputs.full.fileName, sha256: inputs.full.sha256 || null, updatedDate: inputs.full.updatedDate || null },
      imported,
      validation,
      nextStep: 'VALIDATE_AND_WIRE_SIDECAR_READ_PATH_WITH_COMPONENT_FRESHNESS',
      safety: {
        productionDatabaseModified: false,
        productionDatabaseCopied: false,
        sidecarOnly: true,
        stagingDatabasePromoted: false,
        existingCoreTablesModified: false,
        failedPartialCandidatesSafelyRemoved: true,
        freshnessFabricated: false
      }
    };
    fs.mkdirSync(path.dirname(this.reportPath), { recursive: true });
    fs.writeFileSync(this.reportPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
}

module.exports = OrionContractSidecarBuildService;
module.exports.freeBytesFor = freeBytesFor;
