'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..'));
const CREATION_EVIDENCE = path.join(ROOT, 'DATA', 'runtime', 'revenue', 'deliverability', 'instantly_inbox_placement_test_creation_latest.json');
const MAX_CREATION_EVIDENCE_AGE_HOURS = Number(process.env.MILES_FINAL_PLACEMENT_TEST_MAX_AGE_HOURS || 24);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return null; }
}

function ageHours(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? (Date.now() - ms) / 3600000 : null;
}

function resolveLatestPlacementTestId(evidence) {
  const testId = String(evidence?.testId || evidence?.test?.id || '').trim();
  const generatedAt = evidence?.generatedAt || evidence?.createdAt || null;
  const age = ageHours(generatedAt);
  const executeEvidence = String(evidence?.mode || '').toUpperCase() === 'EXECUTE';
  const fresh = age !== null && age >= 0 && age <= MAX_CREATION_EVIDENCE_AGE_HOURS;
  return {
    ok: Boolean(testId) && executeEvidence && fresh,
    testId: testId || null,
    generatedAt,
    ageHours: age,
    executeEvidence,
    fresh,
    reason: !testId
      ? 'LATEST_PLACEMENT_TEST_ID_MISSING'
      : !executeEvidence
        ? 'LATEST_PLACEMENT_EVIDENCE_NOT_EXECUTED_TEST'
        : !fresh
          ? 'LATEST_PLACEMENT_TEST_EVIDENCE_STALE'
          : null
  };
}

function runAcceptance(testId) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['SCRIPTS/RunRevenueAcceptanceSprint.js', '--test-id', testId], {
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
      shell: false,
      stdio: 'inherit'
    });
    child.on('close', code => resolve(Number(code ?? 1)));
    child.on('error', error => {
      console.error(error.stack || error.message);
      resolve(1);
    });
  });
}

async function main() {
  const evidence = readJson(CREATION_EVIDENCE);
  const resolved = resolveLatestPlacementTestId(evidence);
  console.log('MILES_REVENUE_ACCEPTANCE_LATEST_PLACEMENT');
  console.log(JSON.stringify({
    creationEvidence: path.relative(ROOT, CREATION_EVIDENCE),
    ...resolved,
    historicalDefaultTestIgnored: true,
    failClosedIfLatestEvidenceMissingOrStale: true
  }, null, 2));
  if (!resolved.ok) {
    process.exitCode = 2;
    return;
  }
  process.exitCode = await runAcceptance(resolved.testId);
}

if (require.main === module) main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 2;
});

module.exports = { resolveLatestPlacementTestId, ageHours, CREATION_EVIDENCE, MAX_CREATION_EVIDENCE_AGE_HOURS };
