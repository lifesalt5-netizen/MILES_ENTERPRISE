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

function uniqueSourceSummary(rows) {
  const byFile = new Map();
  for (const row of rows) {
    const file = String(row?.file || '').trim();
    if (!file) continue;
    const existing = byFile.get(file);
    const candidate = Number(row?.exactRows || row?.estimatedRows || 0);
    if (!existing || candidate > existing.rows) {
      byFile.set(file, {
        file,
        name: row?.name || row?.id || path.basename(file),
        category: row?.category || null,
        rows: candidate,
        hasEmailColumn: row?.hasEmailColumn === true,
        verified: row?.verified === true,
        readyForUpload: row?.readyForUpload === true
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

  const segmentHealth = inventorySegments.map(s => ({
    segment: s.segmentName || s.name,
    companies: Number(s.companyCount || 0),
    contacts: Number(s.contactCount || 0),
    verifiedEmails: Number(s.verifiedEmailCount || 0),
    health: health(Number(s.companyCount || 0)),
    sourceFile: s.sourceFile || null,
    blockers: s.blockers || []
  }));

  const result = {
    ok: defects.length === 0,
    gate: 'P0_LEAD_SUPPLY_CHAIN_AUDIT',
    generatedAt,
    reference: {
      historicalQualifiedUniverse: 320000,
      note: 'Historical reference supplied by CEO; this audit must reconcile current canonical data to it rather than assume it is current.'
    },
    sourceRegistry: {
      file: MARKETING_REGISTRY,
      registeredEntries: Array.isArray(marketingRows) ? marketingRows.length : 0,
      uniqueFiles: sources.length,
      nonUniqueRowSum: sourceRowsNonUnique,
      topSources: sources.slice(0, 50)
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
      segmentHealth
    },
    defects,
    nextActions: [
      'Resolve all active Federal and SLED segments to canonical source files.',
      'Count unique companies by UEI/company identity before email filtering.',
      'Count contacts separately from companies.',
      'Report email verification dispositions without deleting the underlying qualified company.',
      'Apply cross-segment priority as assignment, not destructive deletion.',
      'Generate FED_SEGMENT_INVENTORY.csv and SLED_SEGMENT_INVENTORY.csv from canonical source data.',
      'Generate a row-count waterfall for each filtering/dedupe stage.'
    ]
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outputFile = path.join(OUT_DIR, 'LEAD_SUPPLY_CHAIN_AUDIT_LATEST.json');
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  result.outputFile = outputFile;
  return result;
}

module.exports = { run, uniqueSourceSummary, health };
