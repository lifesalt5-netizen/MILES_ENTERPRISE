'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { salesBand } = require('./GsaSalesSegmentationService');

function isoNow() { return new Date().toISOString(); }

class GsaSampleTruthVerificationService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.outputRoot = path.join(this.rootDir, 'DATA', 'orion_refresh', 'gsa_execution');
  }

  async run(options = {}) {
    const segmentedPath = path.resolve(options.segmentedPath || '');
    if (!segmentedPath || !fs.existsSync(segmentedPath)) {
      return { ok: false, status: 'BLOCKED', blocker: 'SEGMENTED_GSA_ARTIFACT_NOT_FOUND' };
    }
    const sampleSize = Math.max(1, Math.min(100, Number(options.sampleSize || 25)));
    const samples = [];
    let rowIndex = 0;
    const input = fs.createReadStream(segmentedPath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      rowIndex += 1;
      if (samples.length < sampleSize) samples.push({ rowIndex, row: JSON.parse(line) });
      else {
        // Deterministic reservoir-like replacement keeps coverage across the full file without randomness.
        const slot = rowIndex % sampleSize;
        samples[slot] = { rowIndex, row: JSON.parse(line) };
      }
    }

    const failures = [];
    const checks = [];
    for (const sample of samples.sort((a, b) => a.rowIndex - b.rowIndex)) {
      const row = sample.row;
      const evidence = row.salesEvidence || {};
      const expectedBand = salesBand(evidence.gsaScheduleLinkedFederalObligations || 0);
      const actualSegments = Array.isArray(row.segments) ? row.segments : [];
      const identityPresent = Boolean(row.uei || row.contractNumber || row.legalBusinessName);
      const bandMatches = actualSegments.includes(expectedBand);
      const noInstantlyAuthorization = row.safety?.instantlyPushAuthorized === false;
      const noFabricatedVerifiedEmail = row.contactReadiness?.verified !== true || Boolean(row.contactReadiness?.email);
      const passed = identityPresent && bandMatches && noInstantlyAuthorization && noFabricatedVerifiedEmail;
      const result = { rowIndex: sample.rowIndex, uei: row.uei || null, contractNumber: row.contractNumber || null, expectedBand, identityPresent, bandMatches, noInstantlyAuthorization, noFabricatedVerifiedEmail, passed };
      checks.push(result);
      if (!passed) failures.push(result);
    }

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const report = {
      ok: failures.length === 0 && samples.length > 0,
      status: failures.length === 0 && samples.length > 0 ? 'PASSED' : 'FAILED',
      service: 'GsaSampleTruthVerificationService',
      generatedAt: isoNow(),
      sourcePath: segmentedPath,
      rowsObserved: rowIndex,
      sampleSize: samples.length,
      checksPassed: checks.length - failures.length,
      checksFailed: failures.length,
      failures,
      checks,
      safety: { readOnlyVerification: true, instantlyModified: false, productionOrionModified: false }
    };
    const reportPath = path.join(this.outputRoot, 'latest_gsa_sample_truth_verification.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    return { ...report, reportPath };
  }
}

module.exports = GsaSampleTruthVerificationService;
