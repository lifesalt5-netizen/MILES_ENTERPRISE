'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const UsaspendingAwardAggregationService = require('../orion/UsaspendingAwardAggregationService');

function clean(value) { return value == null ? '' : String(value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function normalizedKey(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normalizeName(value) {
  return clean(value).toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function valueByAliases(row, aliases) {
  const lookup = new Map(Object.keys(row || {}).map(key => [normalizedKey(key), row[key]]));
  for (const alias of aliases) {
    const value = lookup.get(normalizedKey(alias));
    if (value !== undefined && clean(value)) return clean(value);
  }
  return '';
}
function recursivelyListCsv(root) {
  if (!root || !fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...recursivelyListCsv(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) out.push(full);
  }
  return out;
}
function classifyCsv(file) { return path.basename(file).toLowerCase().includes('subaward') ? 'SUBAWARD' : 'PRIME_AWARD'; }
function canonicalIdentity(row, level) {
  const primeUeiAliases = ['recipient_uei', 'recipient unique entity identifier', 'recipient_unique_entity_identifier', 'Recipient UEI'];
  const primeNameAliases = ['recipient_name', 'recipient legal business name', 'recipient_legal_business_name', 'Recipient Name'];
  const subUeiAliases = [
    'sub_recipient_uei', 'Sub-Recipient UEI', 'subrecipient_uei', 'subawardee_uei',
    'subawardee_or_recipient_uei', 'sub_awardee_or_recipient_uei', 'recipient_uei'
  ];
  const subNameAliases = [
    'Sub-Awardee Name', 'subawardee_name', 'subrecipient_name', 'sub_recipient_name',
    'subawardee_or_recipient_legal_business_name', 'sub_awardee_or_recipient_legal_business_name',
    'recipient_name', 'Recipient Name'
  ];
  const uei = upper(valueByAliases(row, level === 'SUBAWARD' ? subUeiAliases : primeUeiAliases));
  const name = normalizeName(valueByAliases(row, level === 'SUBAWARD' ? subNameAliases : primeNameAliases));
  if (uei) return { key: `UEI:${uei}`, uei, name: name || null, authority: 'UEI' };
  if (name) return { key: `NAME:${name}`, uei: null, name, authority: 'NORMALIZED_LEGAL_NAME_FALLBACK' };
  return null;
}
function artifactPath(manifest, basename) {
  return (manifest?.artifacts || []).find(item => path.basename(item?.filePath || '') === basename)?.filePath || null;
}
function ensureInside(parent, candidate) {
  const root = path.resolve(parent);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`STAGING_PATH_ESCAPE:${target}`);
  return target;
}

class PartitionedAwardedUniverseCoverageService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.outputDir = path.join(this.rootDir, 'DATA', 'revenue_universe');
    this.extractRoot = path.join(this.rootDir, 'DATA', 'staging', 'government_data', 'usaspending_partition_coverage');
    this.reportPath = path.join(this.outputDir, 'latest_partitioned_awarded_universe_coverage.json');
    this.aggregationFactory = options.aggregationFactory || (() => new UsaspendingAwardAggregationService({ rootDir: this.rootDir }));
  }

  resolveMasterFile() {
    let store = {};
    try { store = JSON.parse(fs.readFileSync(path.join(this.rootDir, 'DATA', 'enterprise_db', 'enterprise_store.json'), 'utf8')); } catch {}
    const segment = Array.isArray(store?.segments)
      ? store.segments.find(item => String(item?.id || item?.name || '').toUpperCase() === 'MASTER_DEDUPED_ALL_SEGMENTS')
      : null;
    const candidates = [
      process.env.P2GC_MASTER_FILE,
      segment?.file,
      path.join(this.rootDir, 'DATA', 'OUTBOUND', 'MASTER_DEDUPED_ALL_SEGMENTS.csv'),
      path.join(this.rootDir, 'MASTER_DEDUPED_ALL_SEGMENTS.csv')
    ].filter(Boolean);
    return candidates.find(file => fs.existsSync(file)) || null;
  }

  async buildMasterIdentityIndex(file) {
    const uei = new Set();
    const names = new Set();
    let rows = 0;
    await new Promise((resolve, reject) => {
      fs.createReadStream(file)
        .pipe(csv())
        .on('data', row => {
          rows += 1;
          const rowUei = upper(valueByAliases(row, ['uei', 'uei_number', 'uei sam', 'unique_entity_id', 'unique entity id', 'unique entity identifier']));
          const rowName = normalizeName(valueByAliases(row, [
            'company', 'company_name', 'company name', 'companyname', 'legal_business_name', 'legal business name',
            'entity legal business name', 'organization', 'vendor_name', 'vendor name', 'business_name', 'business name'
          ]));
          if (rowUei) uei.add(rowUei);
          if (rowName) names.add(rowName);
        })
        .on('error', reject)
        .on('end', resolve);
    });
    return { rows, uei, names };
  }

  async collectCsv(file, level, prime, sub, counters) {
    await new Promise((resolve, reject) => {
      fs.createReadStream(file)
        .pipe(csv())
        .on('data', row => {
          if (level === 'SUBAWARD') counters.subawardRows += 1;
          else counters.primeAwardRows += 1;
          const identity = canonicalIdentity(row, level);
          if (!identity) {
            counters.rowsWithoutCanonicalIdentity += 1;
            if (level === 'SUBAWARD') counters.subawardRowsWithoutCanonicalIdentity += 1;
            else counters.primeRowsWithoutCanonicalIdentity += 1;
            return;
          }
          const target = level === 'SUBAWARD' ? sub : prime;
          if (!target.has(identity.key)) target.set(identity.key, identity);
        })
        .on('error', reject)
        .on('end', resolve);
    });
  }

  validateCompositeManifest(file) {
    if (!file || !fs.existsSync(file)) throw new Error('PARTITIONED_USASPENDING_MANIFEST_NOT_FOUND');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest?.ok !== true || manifest?.status !== 'COMPLETED' || !Array.isArray(manifest?.partitions) || !manifest.partitions.length) {
      throw new Error('PARTITIONED_USASPENDING_MANIFEST_NOT_GREEN');
    }
    return manifest;
  }

  async run(options = {}) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.mkdirSync(this.extractRoot, { recursive: true });
    const generatedAt = new Date().toISOString();
    const compositeManifestPath = path.resolve(options.compositeManifestPath || '');
    const composite = this.validateCompositeManifest(compositeManifestPath);
    const masterFile = this.resolveMasterFile();
    if (!masterFile) throw new Error('CURRENT_MASTER_NOT_AVAILABLE');
    const master = await this.buildMasterIdentityIndex(masterFile);

    const prime = new Map();
    const sub = new Map();
    const sourceRows = {
      primeAwardRows: 0,
      subawardRows: 0,
      rowsWithoutCanonicalIdentity: 0,
      primeRowsWithoutCanonicalIdentity: 0,
      subawardRowsWithoutCanonicalIdentity: 0
    };
    const partitionEvidence = [];
    const runRoot = ensureInside(this.extractRoot, path.join(this.extractRoot, `PARTITION-COVERAGE-${generatedAt.replace(/[:.]/g, '-')}`));
    fs.mkdirSync(runRoot, { recursive: true });

    for (let index = 0; index < composite.partitions.length; index += 1) {
      const partition = composite.partitions[index];
      const manifestPath = path.resolve(partition.manifestPath || '');
      if (!fs.existsSync(manifestPath)) throw new Error(`PARTITION_MANIFEST_MISSING:${partition.startDate}:${partition.endDate}`);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest?.ok !== true || manifest?.status !== 'COMPLETED') throw new Error(`PARTITION_MANIFEST_NOT_GREEN:${partition.startDate}:${partition.endDate}`);
      const zipPath = artifactPath(manifest, 'usaspending_prime_and_subawards.zip');
      if (!zipPath || !fs.existsSync(zipPath)) throw new Error(`PARTITION_ZIP_MISSING:${partition.startDate}:${partition.endDate}`);

      const target = ensureInside(runRoot, path.join(runRoot, `partition-${String(index + 1).padStart(3, '0')}`));
      const extraction = this.aggregationFactory().extract(zipPath, target);
      const files = recursivelyListCsv(target);
      if (!files.length) throw new Error(`PARTITION_ZIP_NO_CSV:${partition.startDate}:${partition.endDate}`);
      const beforePrime = sourceRows.primeAwardRows;
      const beforeSub = sourceRows.subawardRows;
      for (const file of files) await this.collectCsv(file, classifyCsv(file), prime, sub, sourceRows);
      const partitionPrimeRows = sourceRows.primeAwardRows - beforePrime;
      const partitionSubawardRows = sourceRows.subawardRows - beforeSub;
      partitionEvidence.push({
        startDate: partition.startDate,
        endDate: partition.endDate,
        calculatedTransactionCount: partition.calculatedTransactionCount ?? null,
        maximumTransactionLimit: partition.maximumTransactionLimit ?? null,
        transactionRowsGtLimit: partition.transactionRowsGtLimit === true,
        primeAwardRows: partitionPrimeRows,
        subawardRows: partitionSubawardRows,
        sourceManifestPath: manifestPath,
        sourceZipPath: zipPath,
        extractionTool: extraction?.tool || null,
        suspectedDownloadCap: partitionPrimeRows >= 500000 || partition.transactionRowsGtLimit === true
      });
    }

    const capped = partitionEvidence.filter(item => item.suspectedDownloadCap);
    if (capped.length) {
      const blocked = {
        ok: false,
        status: 'PARTITION_SOURCE_CAP_DETECTED',
        generatedAt,
        compositeManifestPath,
        cappedPartitions: capped,
        sourceRows,
        safety: { sourceArchivesReadOnly: true, currentMasterReadOnly: true, productionOrionModified: false, instantlyModified: false, campaignActivationPerformed: false, emailsSent: false }
      };
      fs.writeFileSync(this.reportPath, JSON.stringify(blocked, null, 2), 'utf8');
      return blocked;
    }

    const primeUeis = new Set([...prime.values()].map(item => item.uei).filter(Boolean));
    const subUeis = new Set([...sub.values()].map(item => item.uei).filter(Boolean));
    const awardedUeis = new Set([...primeUeis, ...subUeis]);
    const ueiOverlap = [...primeUeis].filter(uei => subUeis.has(uei));
    const awardedUeisInMaster = [...awardedUeis].filter(uei => master.uei.has(uei));
    const primeUeisInMaster = [...primeUeis].filter(uei => master.uei.has(uei));
    const subUeisInMaster = [...subUeis].filter(uei => master.uei.has(uei));
    const primeNameFallbackOnly = [...prime.values()].filter(item => !item.uei && item.name).length;
    const subNameFallbackOnly = [...sub.values()].filter(item => !item.uei && item.name).length;

    const report = {
      ok: true,
      status: sourceRows.rowsWithoutCanonicalIdentity === 0 ? 'PARTITIONED_EXACT_SOURCE_SCOPE_DEDUPED' : 'PARTITIONED_DEDUPED_WITH_IDENTITY_COVERAGE_GAP',
      generatedAt,
      scope: {
        authority: composite.authority || 'USAspending.gov',
        startDate: composite.requestedRange?.startDate || null,
        endDate: composite.requestedRange?.endDate || null,
        partitionCount: composite.partitions.length,
        partitionPlanning: composite.partitionPlanning || null,
        compositeManifestPath,
        partitionEvidence
      },
      currentMaster: {
        file: masterFile,
        rows: master.rows,
        uniqueUeis: master.uei.size,
        uniqueNormalizedNames: master.names.size
      },
      awardedUniverse: {
        exactUniquePrimeAwardedUeis: primeUeis.size,
        exactUniqueSubcontractAwardedUeis: subUeis.size,
        exactPrimeAndSubUeiOverlap: ueiOverlap.length,
        exactUniqueAwardedUeisEitherRole: awardedUeis.size,
        exactAwardedUeisInCurrentMaster: awardedUeisInMaster.length,
        exactAwardedUeisMissingFromCurrentMaster: awardedUeis.size - awardedUeisInMaster.length,
        exactPrimeAwardedUeisInCurrentMaster: primeUeisInMaster.length,
        exactPrimeAwardedUeisMissingFromCurrentMaster: primeUeis.size - primeUeisInMaster.length,
        exactSubcontractAwardedUeisInCurrentMaster: subUeisInMaster.length,
        exactSubcontractAwardedUeisMissingFromCurrentMaster: subUeis.size - subUeisInMaster.length,
        primeNameFallbackOnlyIdentities: primeNameFallbackOnly,
        subcontractNameFallbackOnlyIdentities: subNameFallbackOnly,
        exactAwardedUeiUniverseExceedsCurrentMasterRowCount: awardedUeis.size > master.rows,
        exactNetAwardedUeiUniverseVsMasterRows: awardedUeis.size - master.rows
      },
      sourceRows,
      exactness: {
        exactMetricsUseUeiOnly: true,
        dedupedAcrossAllPartitions: true,
        nonOverlappingDatePartitionsRequired: true,
        noPartitionAt500kCap: true,
        everySourceRowHasCanonicalIdentity: sourceRows.rowsWithoutCanonicalIdentity === 0,
        rowsWithoutCanonicalIdentity: sourceRows.rowsWithoutCanonicalIdentity
      },
      safety: {
        sourceArchivesReadOnly: true,
        currentMasterReadOnly: true,
        productionOrionModified: false,
        instantlyModified: false,
        campaignActivationPerformed: false,
        emailsSent: false
      },
      artifacts: { coverageReport: this.reportPath, extractionRoot: runRoot }
    };
    fs.writeFileSync(this.reportPath, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = PartitionedAwardedUniverseCoverageService;
module.exports.canonicalIdentity = canonicalIdentity;
