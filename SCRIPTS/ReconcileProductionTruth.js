'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const core = require('./ReconcileProductionTruthCore');
const ROOT = path.resolve(process.argv[2] || process.env.MILES_ROOT || path.resolve(__dirname, '..'));
process.env.MILES_ROOT = ROOT;

function runNode(scriptName, args = [], timeoutMs = 90000) {
  const script = path.join(__dirname, scriptName);
  const run = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs
  });
  return {
    ok: run.status === 0,
    exitCode: run.status,
    error: run.error ? run.error.message : null,
    stdout: String(run.stdout || ''),
    stderr: String(run.stderr || '')
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return null; }
}

function tail(value, max = 5000) {
  const text = String(value || '');
  return text.length > max ? text.slice(-max) : text;
}

function compactReadiness() {
  const refreshDir = path.join(ROOT, 'DATA', 'orion_refresh');
  const local = readJson(path.join(refreshDir, 'latest_source_audit.json'));
  const official = readJson(path.join(refreshDir, 'latest_official_source_availability.json'));
  const rebuild = readJson(path.join(refreshDir, 'latest_rebuild_readiness.json'));
  return {
    service: 'MILES_ORION_REFRESH_READINESS_COMPACT',
    observedAt: new Date().toISOString(),
    localSourceDiscovery: local ? {
      conclusion: local.conclusion || null,
      currentAgeHours: local.current?.ageHours ?? null,
      usableCandidateCount: local.usableCandidateCount ?? null,
      newerCompatibleCandidateFound: local.newerCompatibleCandidateFound === true,
      newestUsablePath: local.newestUsable?.path || null,
      newestUsableAgeHours: local.newestUsable?.ageHours ?? null
    } : null,
    officialSourceAvailability: official ? {
      ok: official.ok === true,
      fiscalYear: official.fiscalYear ?? null,
      sourceNewerThanCurrentDb: official.summary?.sourceNewerThanCurrentDb ?? null,
      filesReturned: official.summary?.filesReturned ?? null,
      officialFiles: official.summary?.officialFiles ?? null,
      blockers: official.summary?.blockers || [],
      conclusion: official.conclusion || null,
      provesFullOrionFreshness: official.scopeBoundary?.provesFullOrionFreshness ?? null
    } : null,
    rebuildReadiness: rebuild ? {
      ok: rebuild.ok === true,
      currentDb: rebuild.current?.path || null,
      currentDbReadable: rebuild.current?.ok === true,
      missingTables: rebuild.current?.expectedTablesMissing || [],
      candidates: rebuild.summary?.candidates ?? null,
      sourceFiles: rebuild.summary?.sourceFiles ?? null,
      newerSourceFiles: rebuild.summary?.newerSourceFiles ?? null,
      compatibleDatabases: rebuild.summary?.compatibleDatabases ?? null,
      blockers: rebuild.summary?.blockers || [],
      nextStep: rebuild.reconstructionContract?.nextStep || null
    } : null,
    safety: {
      readOnlyAuditsOnly: true,
      filesDownloaded: false,
      productionDatabaseModified: false,
      stagingDatabasePromoted: false,
      freshnessFabricated: false
    }
  };
}

function main() {
  console.log('============================================================');
  console.log('MILES PRODUCTION TRUTH + ORION REFRESH READINESS');
  console.log('============================================================');

  const coreRun = runNode('ReconcileProductionTruthCore.js', process.argv[2] ? [process.argv[2]] : [], 180000);
  if (coreRun.stdout) process.stdout.write(tail(coreRun.stdout, 7000));
  if (coreRun.stderr) process.stderr.write(tail(coreRun.stderr, 4000));

  const localAudit = runNode('AuditOrionRefreshSources.js', [], 90000);
  const officialAudit = runNode('AuditOrionOfficialSourceAvailability.js', [], 120000);
  const readinessAudit = runNode('AuditOrionRebuildReadinessFast.js', [], 120000);

  const compact = compactReadiness();
  compact.auditRuns = {
    localSourceDiscovery: { ok: localAudit.ok, exitCode: localAudit.exitCode, error: localAudit.error, stderr: tail(localAudit.stderr, 1000) },
    officialSourceAvailability: { ok: officialAudit.ok, exitCode: officialAudit.exitCode, error: officialAudit.error, stderr: tail(officialAudit.stderr, 1000) },
    rebuildReadiness: { ok: readinessAudit.ok, exitCode: readinessAudit.exitCode, error: readinessAudit.error, stderr: tail(readinessAudit.stderr, 1000) }
  };

  console.log('\nMILES_ORION_REFRESH_READINESS_COMPACT');
  console.log(JSON.stringify(compact, null, 2));

  if (!coreRun.ok) {
    console.error(`PRODUCTION_TRUTH_CORE_EXIT_${coreRun.exitCode}`);
    process.exitCode = coreRun.exitCode || 1;
  } else {
    process.exitCode = 0;
  }
}

if (require.main === module) main();

module.exports = core;
