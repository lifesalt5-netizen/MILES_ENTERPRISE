'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || process.cwd();
const MARKETING_REGISTRY = path.join(ROOT, 'DATA', 'marketing_coo', 'segment_registry.json');
const CANONICAL_REGISTRY = path.join(ROOT, 'DATA', 'registry', 'CanonicalDatasetRegistry.json');
const LATEST_INVENTORY = path.join(ROOT, 'DATA', 'segment_intelligence', 'latest_segment_inventory.json');
const OUT_DIR = path.join(ROOT, 'DATA', 'revenue', 'lead_supply_chain_audit');

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function sum(rows, key) {
  return rows.reduce((n, row) => n + Number(row?.[key] || 0), 0);
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueSourceSummary(rows) {
  const byFile = new Map();
  for (const row of rows) {
    const file = String(row?.file || '').trim();
    if (!file) continue;
    const existing = byFile.get(file.toLowerCase());
    const candidate = Number(row?.exactRows || row?.estimatedRows || 0);
    if (!existing || candidate > existing.rows) {
      byFile.set(file.toLowerCase(), {
        file,
        name: row?.name || row?.id || path.basename(file),
        category: row?.category || null,
        rows: candidate,
        hasEmailColumn: row?.hasEmailColumn === true,
        verified: row?.verified === true,
        readyForUpload: row?.readyForUpload === true,
        status: row?.status || null,
        assignedCampaign: row?.assignedCampaign || null
      });
    }
  }
  return [...byFile.values()].sort((a, b) => b.rows - a.rows);
}

function health(count) {
  if (count >= 5000) return 'HEALTHY';
  if (count >= 2500) return 'MODERATE';
  if (count >= 1000) return 'REPLENISH';
  if (count >= 500) return 'HIGH_PRIORITY';
  if (count >= 100) return 'CRITICAL';
  return 'EMERGENCY';
}

function classifyUniverse(source) {
  const text = normalize(`${source.name} ${source.category} ${source.file}`);
  const sledTerms = [
    'SLED', 'STATE SLED', 'STATE PROCUREMENT', 'STATE VENDOR', 'STATE CONTRACT',
    'LOCAL GOVERNMENT', 'COUNTY', 'MUNICIPAL', 'CITY PROCUREMENT', 'EDUCATION',
    'SCHOOL DISTRICT', 'NASPO', 'SOURCEWELL', 'OMNIA', 'COOPERATIVE'
  ];
  if (sledTerms.some(term => text.includes(term))) return 'SLED';
  const federalTerms = [
    'SAM', 'GSA', 'VA ', 'VA FSS', 'USASPENDING', 'USA SPENDING', 'FPDS',
    'FEDERAL', '8A', 'HUBZONE', 'WOSB', 'SDVOSB', 'VOSB', 'SBA'
  ];
  if (federalTerms.some(term => text.includes(term))) return 'FEDERAL';
  return 'UNCLASSIFIED';
}

function tokens(value) {
  return new Set(normalize(value).split(' ').filter(x => x.length >= 2));
}

function overlapScore(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / Math.max(a.size, b.size);
}

function resolveInventorySource(segment, canonical, sources) {
  const segmentName = segment.segmentName || segment.name || '';
  const canonicalRow = canonical?.segments?.[segmentName] || null;
  const candidates = [];

  for (const source of sources) {
    let score = overlapScore(segmentName, `${source.name} ${path.basename(source.file)}`);
    if (canonicalRow?.primary && source.file.toLowerCase() === String(canonicalRow.primary).toLowerCase()) score = 1;
    if (canonicalRow?.fallback && source.file.toLowerCase() === String(canonicalRow.fallback).toLowerCase()) score = 0.99;
    if (score > 0) candidates.push({ ...source, score });
  }

  candidates.sort((a, b) => b.score - a.score || b.rows - a.rows);
  const best = candidates[0] || null;

  if (!best || best.score < 0.34) {
    return {
      segmentName,
      sourceFile: null,
      sourceRows: 0,
      resolution: 'UNRESOLVED',
      confidence: 0,
      candidates: candidates.slice(0, 5)
    };
  }

  return {
    segmentName,
    sourceFile: best.file,
    sourceRows: best.rows,
    resolution: best.score >= 0.75 ? 'HIGH_CONFIDENCE' : 'CANDIDATE_REVIEW',
    confidence: Number(best.score.toFixed(3)),
    sourceUniverse: classifyUniverse(best),
    candidates: candidates.slice(0, 5)
  };
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(file, rows, columns) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) lines.push(columns.map(column => csvEscape(row[column])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

function run() {
  const generatedAt = new Date().toISOString();
  const marketingRows = loadJson(MARKETING_REGISTRY, []);
  const canonical = loadJson(CANONICAL_REGISTRY, {});
  const inventory = loadJson(LATEST_INVENTORY, {});
  const sources = uniqueSourceSummary(Array.isArray(marketingRows) ? marketingRows : []);
  const canonicalSegments = Object.entries(canonical?.segments || {}).map(([name, row]) => ({ name, ...row }));
  const inventorySegments = Array.isArray(inventory?.segments) ? inventory.segments : [];

  const sourceRowsNonUnique = sum(sources, 'rows');
  const canonicalMappedSegments = canonicalSegments.length;
  const inventoryCompanyTotal = Number(inventory?.summary?.totalCompanies || 0);
  const inventoryVerifiedTotal = Number(inventory?.summary?.totalVerifiedEmails || 0);
  const inventoryGeneratedAt = inventory?.generatedAt || null;
  const inventoryAgeDays = inventoryGeneratedAt
    ? Math.max(0, (Date.now() - Date.parse(inventoryGeneratedAt)) / 86400000)
    : null;

  const defects = [];

  if (canonicalMappedSegments < 10) {
    defects.push({
      code: 'CANONICAL_SEGMENT_REGISTRY_INCOMPLETE',
      severity: 'P0',
      evidence: `${canonicalMappedSegments} canonical segments are mapped while the active outbound model contains materially more Federal/SLED segments.`,
      action: 'Expand the canonical registry to every active outbound segment before trusting segment totals.'
    });
  }

  if (inventorySegments.length && inventorySegments.every(s => !s.sourceFile)) {
    defects.push({
      code: 'INVENTORY_SOURCE_FILES_UNMAPPED',
      severity: 'P0',
      evidence: 'Every segment in latest_segment_inventory.json has sourceFile=null.',
      action: 'Resolve each inventory row to its canonical source file and calculate counts from the source rather than copied/static inventory counts.'
    });
  }

  if (canonical?.rules?.calculateCountsLive === true) {
    defects.push({
      code: 'LIVE_COUNT_POLICY_NOT_ENFORCED_BY_SEGMENT_INVENTORY',
      severity: 'P0',
      evidence: 'Canonical registry requires calculateCountsLive=true, but SegmentInventoryService reads Companies/LeadCount values from SEGMENT_INVENTORY_MASTER.csv instead of counting canonical source datasets.',
      action: 'Repair SegmentInventoryService or its upstream sync so company/contact/verified counts are derived live from resolved canonical data files.'
    });
  }

  if (inventoryAgeDays !== null && inventoryAgeDays > 1) {
    defects.push({
      code: 'SEGMENT_INVENTORY_STALE',
      severity: 'P0',
      evidence: `Latest committed segment inventory is ${inventoryAgeDays.toFixed(1)} days old.`,
      action: 'Regenerate inventory from current local canonical datasets during every revenue control-plane audit.'
    });
  }

  if (sourceRowsNonUnique > inventoryCompanyTotal * 2) {
    defects.push({
      code: 'SOURCE_UNIVERSE_MATERIALLY_EXCEEDS_REPORTED_INVENTORY',
      severity: 'P0',
      evidence: `Registered source files contain ${sourceRowsNonUnique} non-unique source rows versus ${inventoryCompanyTotal} reported inventory companies.`,
      action: 'Build a UEI/company identity waterfall to determine legitimate overlap versus destructive filtering or unregistered segments.'
    });
  }

  const sourceInventory = sources.map(source => ({
    universe: classifyUniverse(source),
    source: source.name,
    rows: source.rows,
    health: health(source.rows),
    hasEmailColumn: source.hasEmailColumn,
    verified: source.verified,
    readyForUpload: source.readyForUpload,
    status: source.status,
    assignedCampaign: source.assignedCampaign,
    file: source.file
  }));

  const federalSources = sourceInventory.filter(row => row.universe === 'FEDERAL');
  const sledSources = sourceInventory.filter(row => row.universe === 'SLED');
  const unclassifiedSources = sourceInventory.filter(row => row.universe === 'UNCLASSIFIED');

  const resolvedSegments = inventorySegments.map(segment => {
    const resolved = resolveInventorySource(segment, canonical, sources);
    return {
      segment: segment.segmentName || segment.name,
      reportedCompanies: Number(segment.companyCount || 0),
      reportedVerifiedEmails: Number(segment.verifiedEmailCount || 0),
      resolvedSourceRows: resolved.sourceRows,
      sourceFile: resolved.sourceFile,
      resolution: resolved.resolution,
      confidence: resolved.confidence,
      sourceUniverse: resolved.sourceUniverse || 'UNRESOLVED',
      health: health(resolved.sourceRows || Number(segment.companyCount || 0)),
      deltaVsReported: resolved.sourceRows ? resolved.sourceRows - Number(segment.companyCount || 0) : null,
      candidates: resolved.candidates
    };
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const federalSourceFile = writeCsv(
    path.join(OUT_DIR, 'FED_SOURCE_INVENTORY.csv'),
    federalSources,
    ['source', 'rows', 'health', 'hasEmailColumn', 'verified', 'readyForUpload', 'status', 'assignedCampaign', 'file']
  );
  const sledSourceFile = writeCsv(
    path.join(OUT_DIR, 'SLED_SOURCE_INVENTORY.csv'),
    sledSources,
    ['source', 'rows', 'health', 'hasEmailColumn', 'verified', 'readyForUpload', 'status', 'assignedCampaign', 'file']
  );
  const resolutionFile = writeCsv(
    path.join(OUT_DIR, 'OUTBOUND_SEGMENT_SOURCE_RESOLUTION.csv'),
    resolvedSegments,
    ['segment', 'reportedCompanies', 'reportedVerifiedEmails', 'resolvedSourceRows', 'deltaVsReported', 'health', 'sourceUniverse', 'resolution', 'confidence', 'sourceFile']
  );

  const result = {
    ok: defects.length === 0,
    gate: 'P0_LEAD_SUPPLY_CHAIN_AUDIT',
    generatedAt,
    reference: {
      historicalQualifiedUniverse: 320000,
      note: 'Historical reference supplied by CEO; reconcile current canonical data to it rather than assuming it is current.'
    },
    sourceRegistry: {
      file: MARKETING_REGISTRY,
      registeredEntries: Array.isArray(marketingRows) ? marketingRows.length : 0,
      uniqueFiles: sources.length,
      nonUniqueRowSum: sourceRowsNonUnique,
      federalSourceFiles: federalSources.length,
      federalNonUniqueRows: sum(federalSources, 'rows'),
      sledSourceFiles: sledSources.length,
      sledNonUniqueRows: sum(sledSources, 'rows'),
      unclassifiedSourceFiles: unclassifiedSources.length,
      unclassifiedNonUniqueRows: sum(unclassifiedSources, 'rows'),
      topSources: sources.slice(0, 100)
    },
    canonicalRegistry: {
      file: CANONICAL_REGISTRY,
      mappedSegments: canonicalMappedSegments,
      segmentNames: canonicalSegments.map(s => s.name),
      calculateCountsLive: canonical?.rules?.calculateCountsLive === true,
      neverStoreStaticCounts: canonical?.rules?.neverStoreStaticCounts === true
    },
    currentSegmentInventory: {
      file: LATEST_INVENTORY,
      generatedAt: inventoryGeneratedAt,
      ageDays: inventoryAgeDays,
      segmentCount: inventorySegments.length,
      reportedCompanies: inventoryCompanyTotal,
      reportedVerifiedEmails: inventoryVerifiedTotal,
      resolvedSegments
    },
    outputs: {
      federalSourceInventory: federalSourceFile,
      sledSourceInventory: sledSourceFile,
      outboundSegmentSourceResolution: resolutionFile
    },
    defects,
    nextActions: [
      'Expand CanonicalDatasetRegistry.json from four segments to every active Federal and SLED outbound segment.',
      'Use OUTBOUND_SEGMENT_SOURCE_RESOLUTION.csv to approve/repair segment-to-source mappings.',
      'Then calculate unique companies by UEI/company identity from resolved source files.',
      'Count contacts separately from companies and preserve qualified companies lacking verified email in enrichment queues.',
      'Report email verification dispositions without deleting the underlying qualified company.',
      'Apply cross-segment priority as assignment, not destructive deletion.',
      'Generate final FED_SEGMENT_INVENTORY.csv and SLED_SEGMENT_INVENTORY.csv only from approved canonical mappings.',
      'Generate a row-count waterfall for every filtering/dedupe stage.'
    ]
  };

  const outputFile = path.join(OUT_DIR, 'LEAD_SUPPLY_CHAIN_AUDIT_LATEST.json');
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  result.outputFile = outputFile;
  return result;
}

module.exports = {
  run,
  uniqueSourceSummary,
  health,
  classifyUniverse,
  overlapScore,
  resolveInventorySource
};
