'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const OrionOfficialSourceAvailabilityService = require('../SERVICES/orion/OrionOfficialSourceAvailabilityService');
const { fiscalYearFor, normalizeFiles } = OrionOfficialSourceAvailabilityService;

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); }
  };
}

(async () => {
  assert.strictEqual(fiscalYearFor(new Date('2026-08-28T12:00:00Z')), 2026);
  assert.strictEqual(fiscalYearFor(new Date('2026-10-01T00:00:00Z')), 2027);

  const normalized = normalizeFiles([
    { type: 'contracts', fiscal_year: 2026, updated_date: '2026-08-27', file_name: 'FY2026_All_Contracts_Full_20260827.zip', url: 'https://files.usaspending.gov/archives/FY2026_All_Contracts_Full_20260827.zip' },
    { type: 'contracts', fiscal_year: 'All', updated_date: '2026-08-28', file_name: 'FYAll_All_Contracts_Delta_20260828.zip', url: 'https://files.usaspending.gov/archives/FYAll_All_Contracts_Delta_20260828.zip' }
  ]);
  assert.strictEqual(normalized.every(row => row.officialHost), true);
  assert.strictEqual(normalized.filter(row => row.isFull).length, 1);
  assert.strictEqual(normalized.filter(row => row.isDelta).length, 1);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-source-'));
  const reportDir = path.join(root, 'DATA', 'orion_refresh');
  fs.mkdirSync(reportDir, { recursive: true });
  const activeDb = path.join(root, 'active.db');
  fs.writeFileSync(activeDb, 'do-not-touch', 'utf8');
  fs.writeFileSync(path.join(reportDir, 'latest_rebuild_readiness.json'), JSON.stringify({
    current: { path: activeDb, mtime: '2026-08-20T12:00:00.000Z' }
  }), 'utf8');
  const before = fs.readFileSync(activeDb, 'utf8');

  let observedBody = null;
  const fetchImpl = async (_url, options) => {
    observedBody = JSON.parse(options.body);
    return response({
      monthly_files: [
        { type: 'contracts', fiscal_year: 2026, updated_date: '2026-08-27', file_name: 'FY2026_All_Contracts_Full_20260827.zip', url: 'https://files.usaspending.gov/archives/FY2026_All_Contracts_Full_20260827.zip' },
        { type: 'contracts', fiscal_year: 'All', updated_date: '2026-08-28', file_name: 'FYAll_All_Contracts_Delta_20260828.zip', url: 'https://files.usaspending.gov/archives/FYAll_All_Contracts_Delta_20260828.zip' }
      ]
    });
  };

  const result = await new OrionOfficialSourceAvailabilityService({
    rootDir: root,
    now: '2026-08-28T12:00:00Z',
    fetchImpl,
    timeoutMs: 5000
  }).run();

  assert.deepStrictEqual(observedBody, { agency: 'all', fiscal_year: 2026, type: 'contracts' });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.fiscalYear, 2026);
  assert.strictEqual(result.summary.fullArchiveFound, true);
  assert.strictEqual(result.summary.deltaArchiveFound, true);
  assert.strictEqual(result.summary.sourceNewerThanCurrentDb, true);
  assert.strictEqual(result.conclusion, 'CURRENT_OFFICIAL_CONTRACT_SOURCE_AVAILABLE');
  assert.strictEqual(result.scopeBoundary.provesFullOrionFreshness, false);
  assert.strictEqual(result.safety.filesDownloaded, false);
  assert.strictEqual(result.safety.activeDatabaseModified, false);
  assert.strictEqual(fs.readFileSync(activeDb, 'utf8'), before, 'active ORION DB must not be modified by source availability probe');

  const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-source-bad-'));
  fs.mkdirSync(path.join(badRoot, 'DATA', 'orion_refresh'), { recursive: true });
  fs.writeFileSync(path.join(badRoot, 'DATA', 'orion_refresh', 'latest_rebuild_readiness.json'), JSON.stringify({ current: { mtime: '2026-08-20T12:00:00.000Z' } }));
  const bad = await new OrionOfficialSourceAvailabilityService({
    rootDir: badRoot,
    now: '2026-08-28T12:00:00Z',
    fetchImpl: async () => response({ monthly_files: [
      { type: 'contracts', fiscal_year: 2026, updated_date: '2026-08-27', file_name: 'FY2026_All_Contracts_Full_20260827.zip', url: 'https://evil.example/FY2026_All_Contracts_Full_20260827.zip' },
      { type: 'contracts', fiscal_year: 'All', updated_date: '2026-08-28', file_name: 'FYAll_All_Contracts_Delta_20260828.zip', url: 'https://files.usaspending.gov/FYAll_All_Contracts_Delta_20260828.zip' }
    ] })
  }).run();
  assert.strictEqual(bad.ok, false);
  assert(bad.summary.blockers.includes('NON_OFFICIAL_DOWNLOAD_HOST_OBSERVED'));

  console.log('ORION_OFFICIAL_SOURCE_AVAILABILITY=PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
