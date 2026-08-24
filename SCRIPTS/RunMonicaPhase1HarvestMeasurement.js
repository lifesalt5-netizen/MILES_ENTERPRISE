'use strict';

const fs = require('fs');
const path = require('path');
const MonicaDiscoveryCandidateService = require('../SERVICES/monica/MonicaDiscoveryCandidateService');

const root = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..'));
const inputDir = path.join(root, 'DATA', 'MONICA', 'PHASE1_HARVEST');
const outputDir = path.join(root, 'DATA', 'MONICA', 'PHASE1_MEASUREMENT');
const outputFile = path.join(outputDir, 'latest.json');

function rowsFromJson(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['rows', 'candidates', 'data', 'results', 'records']) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function readFileRows(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  if (/\.jsonl$/i.test(file)) {
    return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) { throw new Error(`MONICA_INVALID_JSONL:${path.basename(file)}:${index + 1}:${error.message}`); }
    });
  }
  try { return rowsFromJson(JSON.parse(text)); }
  catch (error) { throw new Error(`MONICA_INVALID_JSON:${path.basename(file)}:${error.message}`); }
}

function write(result) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify({ ...result, outputFile }, null, 2), 'utf8');
}

function main() {
  if (!fs.existsSync(inputDir)) {
    const result = {
      ok: false,
      status: 'NO_PROVENANCE_BACKED_HARVEST_INPUT',
      mode: 'DISCOVERY_ONLY',
      inputDir,
      sourceFiles: [],
      rawRows: 0,
      outreachBlocked: true,
      campaignEnrollmentBlocked: true,
      generatedAt: new Date().toISOString()
    };
    write(result);
    console.log(JSON.stringify({ ...result, outputFile }, null, 2));
    process.exitCode = 2;
    return;
  }

  const files = fs.readdirSync(inputDir)
    .filter(name => /\.(json|jsonl)$/i.test(name))
    .map(name => path.join(inputDir, name))
    .sort();
  const rows = files.flatMap(readFileRows);
  if (!rows.length) {
    const result = {
      ok: false,
      status: 'NO_PROVENANCE_BACKED_HARVEST_ROWS',
      mode: 'DISCOVERY_ONLY',
      inputDir,
      sourceFiles: files,
      rawRows: 0,
      outreachBlocked: true,
      campaignEnrollmentBlocked: true,
      generatedAt: new Date().toISOString()
    };
    write(result);
    console.log(JSON.stringify({ ...result, outputFile }, null, 2));
    process.exitCode = 2;
    return;
  }

  const service = new MonicaDiscoveryCandidateService({ root });
  let measured;
  try {
    measured = service.measure(rows);
  } catch (error) {
    const result = {
      ok: false,
      status: 'HARVEST_VALIDATION_FAILED',
      mode: 'DISCOVERY_ONLY',
      inputDir,
      sourceFiles: files,
      rawRows: rows.length,
      error: error.message,
      outreachBlocked: true,
      campaignEnrollmentBlocked: true,
      generatedAt: new Date().toISOString()
    };
    write(result);
    console.error(JSON.stringify({ ...result, outputFile }, null, 2));
    process.exitCode = 2;
    return;
  }

  const candidateCount = measured.rows.length;
  const result = {
    ok: candidateCount > 0,
    status: candidateCount > 0 ? 'PHASE1_PROVENANCE_BACKED_MEASUREMENT_COMPLETE' : 'NO_NORMALIZED_CANDIDATES',
    mode: 'DISCOVERY_ONLY',
    inputDir,
    sourceFiles: files,
    rawRows: rows.length,
    candidateCount,
    lanes: measured.lanes,
    candidates: measured.rows,
    outreachBlocked: true,
    campaignEnrollmentBlocked: true,
    generatedAt: new Date().toISOString()
  };
  write(result);
  console.log(JSON.stringify({ ...result, outputFile }, null, 2));
  if (!result.ok) process.exitCode = 2;
}

main();
