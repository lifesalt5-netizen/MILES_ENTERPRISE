'use strict';

const fs = require('fs');
const path = require('path');
const leadAudit = require('./LeadSupplyChainAuditService');

const ROOT = process.env.MILES_ROOT || process.cwd();
const MODEL_FILE = path.join(ROOT, 'DATA', 'registry', 'OutboundRevenueSegmentModel.json');
const SOURCE_REGISTRY = path.join(ROOT, 'DATA', 'marketing_coo', 'segment_registry.json');
const OUT_DIR = path.join(ROOT, 'DATA', 'revenue', 'lead_supply_chain_audit');

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreHint(segment, source) {
  const sourceText = normalize(`${source.name || ''} ${source.id || ''} ${source.category || ''} ${source.file || ''}`);
  let score = 0;
  let matchedHint = null;

  for (const hint of segment.sourceHints || []) {
    const normalizedHint = normalize(hint);
    if (!normalizedHint) continue;
    if (sourceText.includes(normalizedHint)) {
      const hintScore = Math.min(1, 0.6 + normalizedHint.split(' ').length * 0.1);
      if (hintScore > score) {
        score = hintScore;
        matchedHint = hint;
      }
    }
  }

  const nameScore = leadAudit.overlapScore(segment.name, `${source.name || ''} ${path.basename(source.file || '')}`);
  if (nameScore > score) {
    score = nameScore;
    matchedHint = 'NAME_OVERLAP';
  }

  return { score: Number(score.toFixed(3)), matchedHint };
}

function resolveSegment(segment, sources) {
  const candidates = sources
    .map(source => ({ ...source, ...scoreHint(segment, source) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.rows || 0) - Number(a.rows || 0));

  const best = candidates[0] || null;
  if (!best || best.score < 0.45) {
    return {
      id: segment.id,
      segment: segment.name,
      universe: segment.universe,
      group: segment.group,
      assignmentPriority: segment.assignmentPriority,
      mappingStatus: 'UNRESOLVED',
      confidence: 0,
      sourceFile: null,
      sourceRowsNonUnique: 0,
      matchedHint: null,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 5)
    };
  }

  return {
    id: segment.id,
    segment: segment.name,
    universe: segment.universe,
    group: segment.group,
    assignmentPriority: segment.assignmentPriority,
    mappingStatus: best.score >= 0.8 ? 'HIGH_CONFIDENCE' : 'REVIEW_REQUIRED',
    confidence: best.score,
    sourceFile: best.file,
    sourceRowsNonUnique: Number(best.rows || 0),
    matchedHint: best.matchedHint,
    candidateCount: candidates.length,
    candidates: candidates.slice(0, 5)
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(file, rows) {
  const columns = [
    'id','segment','universe','group','assignmentPriority','mappingStatus','confidence',
    'sourceRowsNonUnique','matchedHint','candidateCount','sourceFile'
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) lines.push(columns.map(column => csvEscape(row[column])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

function run() {
  const model = loadJson(MODEL_FILE, {});
  const sourceRows = loadJson(SOURCE_REGISTRY, []);
  const sources = leadAudit.uniqueSourceSummary(Array.isArray(sourceRows) ? sourceRows : []);
  const segments = (Array.isArray(model.segments) ? model.segments : [])
    .filter(segment => segment.enabled !== false)
    .sort((a, b) => Number(a.assignmentPriority || 9999) - Number(b.assignmentPriority || 9999));

  const resolved = segments.map(segment => resolveSegment(segment, sources));
  const federal = resolved.filter(row => row.universe === 'FEDERAL');
  const sled = resolved.filter(row => row.universe === 'SLED');
  const unresolved = resolved.filter(row => row.mappingStatus === 'UNRESOLVED');
  const reviewRequired = resolved.filter(row => row.mappingStatus === 'REVIEW_REQUIRED');
  const highConfidence = resolved.filter(row => row.mappingStatus === 'HIGH_CONFIDENCE');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const federalFile = writeCsv(path.join(OUT_DIR, 'FED_SEGMENT_MAPPING_CANDIDATES.csv'), federal);
  const sledFile = writeCsv(path.join(OUT_DIR, 'SLED_SEGMENT_MAPPING_CANDIDATES.csv'), sled);

  const result = {
    ok: unresolved.length === 0 && reviewRequired.length === 0,
    gate: 'OUTBOUND_REVENUE_SEGMENT_MODEL_AUDIT',
    generatedAt: new Date().toISOString(),
    modelFile: MODEL_FILE,
    sourceRegistry: SOURCE_REGISTRY,
    modelVersion: model.version || null,
    sendingGovernance: model.sendingGovernance || null,
    assignmentPolicy: model.assignmentPolicy || null,
    counts: {
      activeSegments: segments.length,
      federalSegments: federal.length,
      sledSegments: sled.length,
      highConfidence: highConfidence.length,
      reviewRequired: reviewRequired.length,
      unresolved: unresolved.length
    },
    resolved,
    unresolved,
    reviewRequired,
    outputs: {
      federalMappingCandidates: federalFile,
      sledMappingCandidates: sledFile
    },
    nextAction: unresolved.length || reviewRequired.length
      ? 'APPROVE_OR_REPAIR_SEGMENT_SOURCE_MAPPINGS_THEN_COUNT_UNIQUE_UEI_CONTACTS_AND_VERIFIED_EMAILS'
      : 'COUNT_UNIQUE_UEI_CONTACTS_AND_VERIFIED_EMAILS_FROM_RESOLVED_SOURCES'
  };

  result.outputFile = path.join(OUT_DIR, 'OUTBOUND_REVENUE_SEGMENT_MODEL_AUDIT_LATEST.json');
  fs.writeFileSync(result.outputFile, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run, scoreHint, resolveSegment };
