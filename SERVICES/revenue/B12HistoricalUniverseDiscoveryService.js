'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PERIOD_START = Date.parse('2025-09-01T00:00:00Z');
const PERIOD_END = Date.parse('2026-03-01T00:00:00Z');
const READ_SAMPLE_BYTES = 128 * 1024;
const DEFAULT_MAX_FILES = 250000;
const SUPPORTED_EXTENSIONS = new Set(['.csv', '.json', '.jsonl', '.txt', '.xlsx', '.xls']);
const PARSEABLE_EXTENSIONS = new Set(['.csv', '.json', '.jsonl', '.txt']);
const PATH_HINTS = [
  'b12', 'campaign', 'contact', 'contacts', 'lead', 'leads', 'prospect', 'prospects',
  'email', 'emails', 'mailing', 'recipient', 'recipients', 'send', 'sent', 'outbound',
  'marketing', 'gsa', 'sam', 'federal', 'va', 'vehicle', 'growth', 'segment'
];
const HEADER_HINTS = [
  'email', 'emailaddress', 'company', 'companyname', 'organization', 'contact', 'firstname',
  'lastname', 'fullname', 'name', 'domain', 'website', 'uei', 'cage', 'phone', 'linkedin'
];
const HARD_EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git', 'node_modules', '.cache', '.next', 'dist', 'build', '__pycache__'
]);
const HARD_EXCLUDED_PATH_FRAGMENTS = [
  `${path.sep}DATA${path.sep}staging${path.sep}government_data${path.sep}`.toLowerCase(),
  `${path.sep}DATA${path.sep}revenue${path.sep}b12_reconciliation${path.sep}`.toLowerCase(),
  `${path.sep}DATA${path.sep}orion_refresh${path.sep}`.toLowerCase()
];

function isoNow() { return new Date().toISOString(); }
function clean(value) { return value == null ? '' : String(value).trim(); }
function normalizedKey(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function csvEscape(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

function safeReadJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}

function parseConfiguredRoots(value) {
  if (!value) return [];
  return String(value)
    .split(path.delimiter)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => path.resolve(item));
}

function uniquePaths(values) {
  const seen = new Set();
  const out = [];
  for (const value of values.filter(Boolean)) {
    const resolved = path.resolve(value);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function withinPeriod(ms) {
  return Number.isFinite(ms) && ms >= PERIOD_START && ms < PERIOD_END;
}

function dateEvidenceFromName(file) {
  const value = path.basename(file).toLowerCase();
  const patterns = [
    /2025[-_ ]?(09|10|11|12)/,
    /2026[-_ ]?(01|02)/,
    /(sep|sept|september|oct|october|nov|november|dec|december)[-_ ]?2025/,
    /(jan|january|feb|february)[-_ ]?2026/
  ];
  return patterns.some(pattern => pattern.test(value));
}

function pathHintScore(file) {
  const text = file.toLowerCase();
  return PATH_HINTS.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
}

function sampleFile(file, bytes = READ_SAMPLE_BYTES) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const size = Math.min(bytes, fs.fstatSync(descriptor).size);
    const buffer = Buffer.alloc(size);
    if (size) fs.readSync(descriptor, buffer, 0, size, 0);
    return buffer.toString('utf8').replace(/^\uFEFF/, '');
  } finally {
    fs.closeSync(descriptor);
  }
}

function headerEvidence(file, extension) {
  if (!PARSEABLE_EXTENSIONS.has(extension)) return { score: 0, fields: [], sampleReadable: false };
  try {
    const sample = sampleFile(file);
    const firstLine = sample.split(/\r?\n/, 1)[0] || '';
    let fields = [];
    if (extension === '.csv' || extension === '.txt') {
      fields = firstLine.split(',').map(normalizedKey).filter(Boolean);
    } else {
      const keys = [...sample.matchAll(/["']([^"'\r\n]{1,80})["']\s*:/g)].slice(0, 200).map(match => normalizedKey(match[1]));
      fields = [...new Set(keys)];
    }
    const matched = HEADER_HINTS.filter(alias => fields.some(field => field === normalizedKey(alias) || field.includes(normalizedKey(alias))));
    return { score: matched.length, fields: matched, sampleReadable: true };
  } catch (error) {
    return { score: 0, fields: [], sampleReadable: false, error: String(error.message || error) };
  }
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex').toUpperCase();
}

function isExcludedDirectory(fullPath, entryName) {
  if (HARD_EXCLUDED_DIRECTORY_NAMES.has(entryName.toLowerCase())) return true;
  const lower = `${fullPath}${path.sep}`.toLowerCase();
  return HARD_EXCLUDED_PATH_FRAGMENTS.some(fragment => lower.includes(fragment));
}

function inventoryRegistryFiles(rootDir) {
  const registryPath = path.join(rootDir, 'DATA', 'marketing_coo', 'segment_registry.json');
  const registry = safeReadJson(registryPath, []);
  if (!Array.isArray(registry)) return { registryPath, files: [] };
  const files = [];
  for (const row of registry) {
    const candidate = clean(row?.file || row?.sourceFile || row?.path);
    if (!candidate) continue;
    const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(rootDir, candidate);
    files.push({
      file: resolved,
      registryName: row?.name || row?.id || null,
      registryCategory: row?.category || null,
      registryRows: Number(row?.exactRows || row?.estimatedRows || 0) || null
    });
  }
  return { registryPath, files };
}

class B12HistoricalUniverseDiscoveryService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    const configured = parseConfiguredRoots(options.historicalRoots || process.env.P2GC_B12_HISTORICAL_ROOTS || '');
    const parent = path.dirname(this.rootDir);
    const parentLooksScoped = /p2gc[_ -]?intelligence/i.test(path.basename(parent));
    this.scanRoots = uniquePaths([
      this.rootDir,
      ...(parentLooksScoped ? [parent] : []),
      ...configured
    ]).filter(root => fs.existsSync(root) && fs.statSync(root).isDirectory());
    this.outputDir = path.join(this.rootDir, 'DATA', 'revenue', 'b12_reconciliation', 'discovery');
    this.maxFiles = Number(options.maxFiles || process.env.P2GC_B12_DISCOVERY_MAX_FILES || DEFAULT_MAX_FILES);
    this.hashMaxBytes = Number(options.hashMaxBytes || process.env.P2GC_B12_DISCOVERY_HASH_MAX_BYTES || 1024 * 1024 * 1024);
    this.currentMasterCandidates = [
      process.env.P2GC_MASTER_FILE,
      path.join(this.rootDir, 'DATA', 'OUTBOUND', 'MASTER_DEDUPED_ALL_SEGMENTS.csv'),
      path.join(this.rootDir, 'MASTER_DEDUPED_ALL_SEGMENTS.csv')
    ].filter(Boolean).map(item => path.resolve(item));
  }

  discover() {
    const startedAt = isoNow();
    const registry = inventoryRegistryFiles(this.rootDir);
    const registryByPath = new Map(registry.files.map(item => [process.platform === 'win32' ? item.file.toLowerCase() : item.file, item]));
    const currentMasterSet = new Set(this.currentMasterCandidates.map(item => process.platform === 'win32' ? item.toLowerCase() : item));
    const found = new Map();
    const errors = [];
    let filesVisited = 0;
    let directoriesVisited = 0;
    let limitExceeded = false;

    const inspectFile = (file, sourceRoot, source = 'FILESYSTEM_SCAN') => {
      if (limitExceeded) return;
      filesVisited += 1;
      if (filesVisited > this.maxFiles) { limitExceeded = true; return; }
      const extension = path.extname(file).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) return;
      let stats;
      try { stats = fs.statSync(file); } catch (error) { errors.push({ file, error: String(error.message || error) }); return; }
      if (!stats.isFile()) return;

      const key = process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
      const registryItem = registryByPath.get(key) || null;
      const isCurrentMaster = currentMasterSet.has(key);
      const hints = pathHintScore(file);
      const header = headerEvidence(file, extension);
      const mtimeInPeriod = withinPeriod(stats.mtimeMs);
      const birthtimeInPeriod = withinPeriod(stats.birthtimeMs);
      const nameDateEvidence = dateEvidenceFromName(file);
      const periodEvidence = mtimeInPeriod || birthtimeInPeriod || nameDateEvidence;
      const contactEvidence = header.score >= 2;
      const relevant = Boolean(registryItem || (hints >= 1 && contactEvidence) || (periodEvidence && contactEvidence) || /b12/i.test(file));
      if (!relevant && !isCurrentMaster) return;

      let digest = null;
      let hashStatus = 'NOT_ATTEMPTED';
      if (stats.size <= this.hashMaxBytes) {
        try { digest = sha256(file); hashStatus = 'SHA256_COMPLETE'; }
        catch (error) { hashStatus = `HASH_FAILED:${String(error.message || error)}`; }
      } else {
        hashStatus = `SKIPPED_OVER_${this.hashMaxBytes}_BYTES`;
      }

      const record = {
        file: path.resolve(file),
        sourceRoot: path.resolve(sourceRoot),
        source,
        extension,
        bytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        createdAt: Number.isFinite(stats.birthtimeMs) ? stats.birthtime.toISOString() : null,
        mtimeInHistoricalWindow: mtimeInPeriod,
        createdInHistoricalWindow: birthtimeInPeriod,
        dateEvidenceInFileName: nameDateEvidence,
        pathHintScore: hints,
        contactHeaderEvidence: header.fields,
        contactHeaderScore: header.score,
        parseableNow: PARSEABLE_EXTENSIONS.has(extension),
        metadataOnly: !PARSEABLE_EXTENSIONS.has(extension),
        sha256: digest,
        hashStatus,
        registryReferenced: Boolean(registryItem),
        registryName: registryItem?.registryName || null,
        registryCategory: registryItem?.registryCategory || null,
        registryReportedRows: registryItem?.registryRows || null,
        currentMaster: isCurrentMaster,
        discoveryReason: registryItem
          ? 'REGISTERED_MARKETING_SOURCE'
          : isCurrentMaster
            ? 'CURRENT_MASTER_CONTROL'
            : /b12/i.test(file)
              ? 'B12_PATH_OR_FILENAME'
              : periodEvidence && contactEvidence
                ? 'HISTORICAL_WINDOW_PLUS_CONTACT_SCHEMA'
                : 'LEAD_PATH_PLUS_CONTACT_SCHEMA'
      };
      found.set(key, record);
    };

    const walk = (directory, sourceRoot) => {
      if (limitExceeded) return;
      directoriesVisited += 1;
      let entries;
      try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
      catch (error) { errors.push({ directory, error: String(error.message || error) }); return; }
      for (const entry of entries) {
        if (limitExceeded) break;
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!isExcludedDirectory(full, entry.name)) walk(full, sourceRoot);
        } else if (entry.isFile()) {
          inspectFile(full, sourceRoot);
        }
      }
    };

    for (const root of this.scanRoots) walk(root, root);

    for (const item of registry.files) {
      if (!fs.existsSync(item.file)) continue;
      const root = this.scanRoots.find(candidate => {
        const relative = path.relative(candidate, item.file);
        return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
      }) || path.dirname(item.file);
      inspectFile(item.file, root, 'MARKETING_REGISTRY');
    }

    const files = [...found.values()].sort((a, b) => a.file.localeCompare(b.file));
    const historicalCandidates = files.filter(item => !item.currentMaster);
    const controls = files.filter(item => item.currentMaster);
    const periodCandidates = historicalCandidates.filter(item => item.mtimeInHistoricalWindow || item.createdInHistoricalWindow || item.dateEvidenceInFileName || /b12/i.test(item.file));
    const parseableCandidates = historicalCandidates.filter(item => item.parseableNow);
    const metadataOnlyCandidates = historicalCandidates.filter(item => item.metadataOnly);
    const duplicateFileHashes = new Map();
    for (const item of historicalCandidates.filter(item => item.sha256)) {
      if (!duplicateFileHashes.has(item.sha256)) duplicateFileHashes.set(item.sha256, []);
      duplicateFileHashes.get(item.sha256).push(item.file);
    }
    const duplicateArtifacts = [...duplicateFileHashes.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([sha256Value, paths]) => ({ sha256: sha256Value, files: paths }));

    const result = {
      ok: !limitExceeded,
      status: limitExceeded ? 'DISCOVERY_INCOMPLETE_FILE_LIMIT_EXCEEDED' : 'DISCOVERY_COMPLETE',
      service: 'B12HistoricalUniverseDiscoveryService',
      mode: 'READ_ONLY_EVIDENCE_DISCOVERY',
      startedAt,
      completedAt: isoNow(),
      historicalWindow: { start: '2025-09-01', endExclusive: '2026-03-01' },
      scope: {
        scanRoots: this.scanRoots,
        configuredHistoricalRoots: parseConfiguredRoots(process.env.P2GC_B12_HISTORICAL_ROOTS || ''),
        maxFiles: this.maxFiles,
        filesVisited,
        directoriesVisited,
        excludedDirectoryNames: [...HARD_EXCLUDED_DIRECTORY_NAMES],
        excludedLargeDataFamilies: HARD_EXCLUDED_PATH_FRAGMENTS
      },
      registry: {
        file: registry.registryPath,
        referencedSourceCount: registry.files.length,
        existingReferencedSourceCount: registry.files.filter(item => fs.existsSync(item.file)).length
      },
      inventory: {
        discoveredRelevantFiles: files.length,
        historicalCandidateFiles: historicalCandidates.length,
        periodEvidenceCandidateFiles: periodCandidates.length,
        parseableCandidateFiles: parseableCandidates.length,
        metadataOnlyCandidateFiles: metadataOnlyCandidates.length,
        currentMasterControlFiles: controls.length,
        duplicateArtifactHashGroups: duplicateArtifacts.length
      },
      files,
      duplicateArtifacts,
      errors,
      nextGate: {
        reconstructRowsFromParseableCandidates: parseableCandidates.length > 0,
        inspectMetadataOnlyCandidates: metadataOnlyCandidates.length > 0,
        preserveOriginals: true,
        writeToHistoricalSources: false,
        compareToCurrentMaster: controls.length > 0 || this.currentMasterCandidates.some(file => fs.existsSync(file))
      },
      safety: {
        readOnlyDiscovery: true,
        historicalSourcesModified: false,
        currentMasterModified: false,
        providerMutation: false,
        campaignMutation: false,
        emailSent: false,
        suppressionOverridden: false,
        outputStagingOnly: true
      }
    };

    fs.mkdirSync(this.outputDir, { recursive: true });
    const reportPath = path.join(this.outputDir, 'latest_b12_historical_universe_discovery.json');
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8');
    const csvPath = path.join(this.outputDir, 'latest_b12_historical_source_inventory.csv');
    const columns = [
      'file', 'sourceRoot', 'source', 'extension', 'bytes', 'modifiedAt', 'createdAt',
      'mtimeInHistoricalWindow', 'createdInHistoricalWindow', 'dateEvidenceInFileName',
      'pathHintScore', 'contactHeaderScore', 'contactHeaderEvidence', 'parseableNow', 'metadataOnly',
      'registryReferenced', 'registryName', 'registryCategory', 'registryReportedRows', 'currentMaster',
      'discoveryReason', 'sha256', 'hashStatus'
    ];
    const lines = [columns.map(csvEscape).join(',')];
    for (const item of files) {
      lines.push(columns.map(column => csvEscape(Array.isArray(item[column]) ? item[column].join('|') : item[column])).join(','));
    }
    fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8');
    return { ...result, outputs: { report: reportPath, inventoryCsv: csvPath } };
  }
}

module.exports = B12HistoricalUniverseDiscoveryService;
