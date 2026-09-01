'use strict';

const fs = require('fs');
const path = require('path');
const AwardedUniverseCoverageService = require('./AwardedUniverseCoverageService');
const UsaspendingAwardHistoryStagingService = require('../UsaspendingAwardHistoryStagingService');
const UsaspendingAwardAggregationService = require('../orion/UsaspendingAwardAggregationService');

function isoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}
function clean(value) { return value == null ? '' : String(value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function sourceDateFromText(value) {
  const text = clean(value);
  const matches = [...text.matchAll(/(?:^|[^0-9])(20[0-9]{2})(0[1-9]|1[0-2])([0-2][0-9]|3[01])(?:[^0-9]|$)/g)];
  for (const match of matches) {
    const candidate = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = isoDate(candidate);
    if (parsed === candidate) return candidate;
  }
  return null;
}
function resolveSourceUpdatedDate(report, sourceRows) {
  const explicit = isoDate(report?.source?.updatedDate || (sourceRows || []).map(row => row.source_updated_date).find(Boolean));
  if (explicit) return { date: explicit, authority: 'EXPLICIT_SOURCE_UPDATED_DATE' };
  const archiveCandidates = [
    report?.source?.archive,
    ...(sourceRows || []).map(row => row.source_archive)
  ].filter(Boolean);
  for (const archive of archiveCandidates) {
    const parsed = sourceDateFromText(archive);
    if (parsed) return { date: parsed, authority: 'VALIDATED_SOURCE_ARCHIVE_FILENAME_DATE', archive: clean(archive) };
  }
  return { date: null, authority: 'UNRESOLVED' };
}

class SubawardOnlyStagingService extends UsaspendingAwardHistoryStagingService {
  requestPayload(resolved) {
    const payload = super.requestPayload(resolved);
    return { ...payload, spending_level: ['subawards'] };
  }

  async refresh(options = {}) {
    const result = await super.refresh(options);
    const manifestPath = result.manifestPath;
    const manifest = readJson(manifestPath);
    manifest.inputs = { ...(manifest.inputs || {}), spendingLevels: ['subawards'] };
    manifest.scope = {
      primeAwards: false,
      subawards: true,
      assistanceAwards: false
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { ...manifest, manifestPath };
  }
}

class Fy2026AwardedUniverseCoverageService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.sidecarReportPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_contract_sidecar_build.json');
    this.awardsRoot = path.join(this.rootDir, 'DATA', 'staging', 'government_data', 'usaspending_awards');
    this.outputDir = path.join(this.rootDir, 'DATA', 'revenue_universe');
    this.reportPath = path.join(this.outputDir, 'latest_fy2026_awarded_universe_coverage.json');
    this.Database = options.Database || null;
    this.coverageFactory = options.coverageFactory || (() => new AwardedUniverseCoverageService({ rootDir: this.rootDir }));
    this.stagingFactory = options.stagingFactory || (() => new SubawardOnlyStagingService({ root: this.rootDir }));
    this.aggregationFactory = options.aggregationFactory || (() => new UsaspendingAwardAggregationService({ rootDir: this.rootDir }));
  }

  loadDatabase() {
    if (!this.Database) this.Database = require('better-sqlite3');
    return this.Database;
  }

  loadPrimeSidecar() {
    if (!fs.existsSync(this.sidecarReportPath)) throw new Error('ORION_SIDECAR_REPORT_MISSING');
    const report = readJson(this.sidecarReportPath);
    const sidecarDb = report?.sidecarDb ? path.resolve(report.sidecarDb) : null;
    if (
      report?.ok !== true ||
      report?.validation?.ok !== true ||
      report?.safety?.productionDatabaseModified !== false ||
      report?.safety?.sidecarOnly !== true ||
      !sidecarDb ||
      !fs.existsSync(sidecarDb)
    ) throw new Error('ORION_SIDECAR_NOT_GREEN_OR_MISSING');

    const Database = this.loadDatabase();
    const db = new Database(sidecarDb, { readonly: true, fileMustExist: true });
    try {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='orion_contractor_fy2026_summary'").get();
      if (!table) throw new Error('ORION_FY2026_CONTRACTOR_SUMMARY_MISSING');
      const ueiRows = db.prepare("SELECT UPPER(TRIM(uei)) AS uei FROM orion_contractor_fy2026_summary WHERE uei IS NOT NULL AND TRIM(uei)<>''").all();
      const primeUeis = new Set(ueiRows.map(row => upper(row.uei)).filter(Boolean));
      if (!primeUeis.size) throw new Error('ORION_FY2026_PRIME_UEI_SET_EMPTY');
      const sourceRows = db.prepare("SELECT source_family, source_scope, source_updated_date, source_archive, transaction_rows, award_rows, contractor_summary_rows, imported_at FROM orion_source_refresh_manifest ORDER BY imported_at DESC").all();
      const resolvedSourceDate = resolveSourceUpdatedDate(report, sourceRows);
      const sourceUpdatedDate = resolvedSourceDate.date;
      if (!sourceUpdatedDate) throw new Error('ORION_FY2026_SOURCE_DATE_UNKNOWN');
      const expectedSummaryRows = Number(report?.validation?.summaryRows || 0);
      if (expectedSummaryRows > 0 && expectedSummaryRows !== primeUeis.size) {
        throw new Error(`ORION_FY2026_PRIME_UEI_COUNT_MISMATCH:${primeUeis.size}:${expectedSummaryRows}`);
      }
      return {
        report,
        sidecarDb,
        sourceUpdatedDate,
        sourceDateAuthority: resolvedSourceDate,
        primeUeis,
        sourceRows,
        expectedSummaryRows: expectedSummaryRows || primeUeis.size
      };
    } finally {
      db.close();
    }
  }

  findReusableSubawardManifest(startDate, endDate) {
    if (!fs.existsSync(this.awardsRoot)) return null;
    const candidates = [];
    for (const entry of fs.readdirSync(this.awardsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(this.awardsRoot, entry.name, 'manifest.json');
      if (!fs.existsSync(file)) continue;
      try {
        const manifest = readJson(file);
        const levels = Array.isArray(manifest?.inputs?.spendingLevels) ? manifest.inputs.spendingLevels.map(value => String(value).toLowerCase()) : [];
        if (
          manifest?.ok !== true ||
          manifest?.status !== 'COMPLETED' ||
          manifest?.inputs?.startDate !== startDate ||
          manifest?.inputs?.endDate !== endDate ||
          levels.length !== 1 || levels[0] !== 'subawards'
        ) continue;
        const zip = (manifest.artifacts || []).find(item => path.basename(item.filePath || '') === 'usaspending_prime_and_subawards.zip')?.filePath;
        if (!zip || !fs.existsSync(zip)) continue;
        candidates.push({ file, manifest, stamp: Date.parse(manifest.generatedAt || '') || fs.statSync(file).mtimeMs });
      } catch {}
    }
    candidates.sort((a, b) => b.stamp - a.stamp);
    return candidates[0] || null;
  }

  async ensureSubawardManifest(startDate, endDate) {
    const reusable = this.findReusableSubawardManifest(startDate, endDate);
    if (reusable) return { manifestPath: reusable.file, manifest: reusable.manifest, reused: true };
    const runId = `USASPENDING-SUBAWARDS-FY2026-${startDate}-TO-${endDate}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const manifest = await this.stagingFactory().refresh({ startDate, endDate, runId });
    return { manifestPath: manifest.manifestPath, manifest, reused: false };
  }

  async collectSubawardUeis(manifestPath, master) {
    const aggregation = await this.aggregationFactory().run({ usaspendingManifestPath: manifestPath });
    if (aggregation?.ok !== true || !aggregation?.reportPath) throw new Error(`USASPENDING_SUBAWARD_AGGREGATION_FAILED:${aggregation?.blocker || aggregation?.status || 'UNKNOWN'}`);
    const extractedRoot = path.join(path.dirname(aggregation.reportPath), 'extracted');
    const collector = this.coverageFactory();
    const collected = await collector.collectIdentitySets(extractedRoot, master);
    const subValues = [...collected.sub.values()];
    const subUeis = new Set(subValues.map(identity => upper(identity.uei)).filter(Boolean));
    const nameFallbackOnly = subValues.filter(identity => !identity.uei && identity.name).length;
    if (collected.counters.primeAwardRows !== 0) throw new Error(`SUBAWARD_ONLY_SOURCE_CONTAINED_PRIME_ROWS:${collected.counters.primeAwardRows}`);
    if (collected.counters.subawardRows >= 500000) throw new Error(`SUBAWARD_SOURCE_REACHED_500K_CAP:${collected.counters.subawardRows}`);
    return { aggregation, collected, subUeis, nameFallbackOnly };
  }

  async run() {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const generatedAt = new Date().toISOString();
    try {
      const prime = this.loadPrimeSidecar();
      const startDate = '2025-10-01';
      const endDate = prime.sourceUpdatedDate;
      const coverage = this.coverageFactory();
      const masterFile = coverage.resolveMasterFile();
      if (!masterFile) throw new Error('CURRENT_MASTER_NOT_AVAILABLE');
      const master = coverage.buildMasterIdentityIndex(masterFile);

      const staged = await this.ensureSubawardManifest(startDate, endDate);
      const sub = await this.collectSubawardUeis(staged.manifestPath, master);
      const primeUeis = prime.primeUeis;
      const subUeis = sub.subUeis;
      const overlap = [...primeUeis].filter(uei => subUeis.has(uei));
      const union = new Set([...primeUeis, ...subUeis]);
      const inMaster = [...union].filter(uei => master.uei.has(uei));
      const primeInMaster = [...primeUeis].filter(uei => master.uei.has(uei));
      const subInMaster = [...subUeis].filter(uei => master.uei.has(uei));
      const identityComplete = sub.nameFallbackOnly === 0 && sub.collected.counters.rowsWithoutCanonicalIdentity === 0;

      const report = {
        ok: identityComplete,
        status: identityComplete ? 'FY2026_TO_SOURCE_DATE_EXACT_UEI_DEDUPED' : 'FY2026_TO_SOURCE_DATE_IDENTITY_GAPS',
        generatedAt,
        scope: {
          fiscalYear: 2026,
          startDate,
          endDate,
          primeSourceDateAuthority: prime.sourceDateAuthority,
          primeAuthority: 'ORION_VALIDATED_USASPENDING_FY2026_SIDECAR',
          subawardAuthority: 'USAspending.gov',
          primeSidecarDb: prime.sidecarDb,
          subawardManifestPath: staged.manifestPath,
          subawardManifestReused: staged.reused
        },
        currentMaster: {
          file: masterFile,
          rows: master.rows.length,
          uniqueUeis: master.uei.size
        },
        awardedUniverse: {
          exactUniquePrimeAwardedUeis: primeUeis.size,
          exactUniqueSubcontractAwardedUeis: subUeis.size,
          exactPrimeAndSubUeiOverlap: overlap.length,
          exactUniqueAwardedUeisEitherRole: union.size,
          exactAwardedUeisInCurrentMaster: inMaster.length,
          exactAwardedUeisMissingFromCurrentMaster: union.size - inMaster.length,
          exactPrimeAwardedUeisInCurrentMaster: primeInMaster.length,
          exactPrimeAwardedUeisMissingFromCurrentMaster: primeUeis.size - primeInMaster.length,
          exactSubcontractAwardedUeisInCurrentMaster: subInMaster.length,
          exactSubcontractAwardedUeisMissingFromCurrentMaster: subUeis.size - subInMaster.length,
          exactAwardedUeiUniverseExceedsCurrentMasterRowCount: union.size > master.rows.length,
          exactNetAwardedUeiUniverseVsMasterRows: union.size - master.rows.length,
          currentMasterCoveragePercentOfAwardedUniverse: union.size ? Number(((inMaster.length / union.size) * 100).toFixed(2)) : 0,
          awardedUniverseMissingFromCurrentMasterPercent: union.size ? Number((((union.size - inMaster.length) / union.size) * 100).toFixed(2)) : 0
        },
        sourceIntegrity: {
          primeSummaryRows: prime.primeUeis.size,
          sidecarExpectedSummaryRows: prime.expectedSummaryRows,
          subawardRows: sub.collected.counters.subawardRows,
          subawardUniqueUeis: subUeis.size,
          subawardNameFallbackOnlyIdentities: sub.nameFallbackOnly,
          subawardRowsWithoutCanonicalIdentity: sub.collected.counters.rowsWithoutCanonicalIdentity,
          subawardBelow500kTransactionCeiling: sub.collected.counters.subawardRows < 500000,
          primeSourceManifest: prime.sourceRows
        },
        exactness: {
          exactMetricsUseUeiOnly: true,
          primeSetFromValidatedSidecar: true,
          subawardSetFromOfficialSource: true,
          sourceDatesAligned: true,
          duplicateRolesDeduped: true,
          everySubawardIdentityHasUei: identityComplete
        },
        safety: {
          sourceDatabasesReadOnly: true,
          productionOrionModified: false,
          currentMasterReadOnly: true,
          providerMutation: false,
          campaignMutation: false,
          emailSent: false,
          suppressionOverridden: false,
          outputStagingOnly: true
        },
        artifacts: {
          report: this.reportPath,
          subawardAggregationReport: sub.aggregation.reportPath,
          subawardAggregatePath: sub.aggregation.aggregatePath
        }
      };
      fs.writeFileSync(this.reportPath, JSON.stringify(report, null, 2), 'utf8');
      return report;
    } catch (error) {
      const report = {
        ok: false,
        status: 'FAILED_CLOSED',
        generatedAt,
        error: String(error?.message || error),
        safety: {
          sourceDatabasesReadOnly: true,
          productionOrionModified: false,
          providerMutation: false,
          campaignMutation: false,
          emailSent: false,
          suppressionOverridden: false,
          outputStagingOnly: true
        }
      };
      fs.writeFileSync(this.reportPath, JSON.stringify(report, null, 2), 'utf8');
      return report;
    }
  }
}

module.exports = Fy2026AwardedUniverseCoverageService;
module.exports.SubawardOnlyStagingService = SubawardOnlyStagingService;
