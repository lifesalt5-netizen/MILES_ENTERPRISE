'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const SOURCE_FILE = __filename;
const POLL_MS = Math.max(5000, Number(process.env.MILES_REMOTE_BRIDGE_POLL_MS || 15000));
const PROGRESS_MS = Math.max(30000, Number(process.env.MILES_REMOTE_BRIDGE_PROGRESS_MS || 60000));
const DIRECTIVE_HTTP_TIMEOUT_MS = Math.max(5000, Number(process.env.MILES_BRIDGE_DIRECTIVE_HTTP_TIMEOUT_MS || 30000));
const GIT_COMMAND_TIMEOUT_MS = Math.max(10000, Number(process.env.MILES_BRIDGE_GIT_COMMAND_TIMEOUT_MS || 45000));
const CONTROL_BRANCH = 'miles-control';
const DIRECTIVE_REPO_PATH = 'DATA/control/miles_remote_execution_directive.json';
const DIRECTIVE_URL = process.env.MILES_REMOTE_DIRECTIVE_URL || `https://raw.githubusercontent.com/lifesalt5-netizen/MILES_ENTERPRISE/${CONTROL_BRANCH}/${DIRECTIVE_REPO_PATH}`;
let controlDirectiveCache = { sha: null, directive: null };
const STATE_FILE = path.join(ROOT, 'DATA', 'runtime', 'remote_execution_bridge_state.json');
const EVIDENCE_FILE = path.join(ROOT, 'DATA', 'runtime', 'remote_execution_bridge_evidence.json');
const EVIDENCE_BRANCH = 'miles-runtime-evidence';
const EVIDENCE_REPO_PATH = 'DATA/control/miles_remote_execution_result.json';
const BRIDGE_SUPERVISED = ['1','true','yes','y','on'].includes(String(process.env.MILES_BRIDGE_SUPERVISED || '').trim().toLowerCase());
const SUPERVISED_RESTART_EXIT_CODE = 75;
const CONTROL_OWNER_RESTART_EXIT_CODE = 76;
let evidencePublishTail = Promise.resolve();

function sourceDigest(file = SOURCE_FILE) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
const STARTUP_SOURCE_DIGEST = sourceDigest();

const JOBS = Object.freeze({
  REVENUE_ACCEPTANCE_SPRINT: ['node', ['SCRIPTS/RunRevenueAcceptanceSprint.js']],
  REVENUE_ACCEPTANCE_LATEST_PLACEMENT: ['node', ['SCRIPTS/RunRevenueAcceptanceLatestPlacement.js']],
  REVENUE_UNIVERSE_RECONCILIATION: ['node', ['SCRIPTS/RunRevenueUniverseReconciliation.js']],
  FY2026_AWARDED_UNIVERSE_COVERAGE: ['node', ['SCRIPTS/RunFy2026AwardedUniverseCoverage.js']],
  SIX_FY_AWARDED_UNIVERSE_NORMALIZE: ['node', ['SCRIPTS/RunSixFiscalYearAwardUniverseNormalization.js']],
  INBOX_PLACEMENT_AUDIT: ['node', ['SCRIPTS/AuditInstantlyInboxPlacement.js', '--test-id', '01a040ce-dbf7-7872-8938-f1501647af92']],
  INBOX_PLACEMENT_CREATE_FRESH: ['node', ['SCRIPTS/CreateControlledInstantlyInboxPlacementTest.js', '--execute', '--force-new']],
  PRODUCTION_TRUTH_RECONCILIATION: ['node', ['SCRIPTS/ReconcileProductionTruth.js']],
  INFRASTRUCTURE_HEALTH_AUDIT: ['node', ['SCRIPTS/RunInfrastructureHealthAudit.js']],
  CONTROL_OWNER_WATCHDOG_INSTALL: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'SCRIPTS/InstallMilesControlOwnerWatchdogWindows.ps1', '-Root', ROOT]],
  CONTROL_OWNER_WATCHDOG_ENSURE: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'SCRIPTS/EnsureMilesControlOwnerWindows.ps1', '-Root', ROOT]],
  CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_SCHEDULE: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'SCRIPTS/ScheduleMilesControlOwnerRecoveryProofWindows.ps1', '-Root', ROOT]],
  CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_VERIFY: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'SCRIPTS/VerifyMilesControlOwnerRecoveryProofWindows.ps1', '-Root', ROOT]],
  IONOS_INBOX_CLEANUP_PLAN: ['node', ['SCRIPTS/RunIonosInboxCleanup.js']],
  IONOS_INBOX_CLEANUP_EXECUTE: ['node', ['SCRIPTS/RunIonosInboxCleanup.js', '--execute']],
  IONOS_SPAM_RESCUE_PLAN: ['node', ['SCRIPTS/RunIonosSpamRescue.js']],
  IONOS_SPAM_RESCUE_EXECUTE: ['node', ['SCRIPTS/RunIonosSpamRescue.js', '--execute']],
  INSTANTLY_LIFECYCLE_PROOF_PLAN: ['node', ['SCRIPTS/RunInstantlyLifecycleProof.js']],
  INSTANTLY_LIFECYCLE_PROOF_EXECUTE: ['node', ['SCRIPTS/RunInstantlyLifecycleProof.js', '--execute']],
  INSTANTLY_ZERO_COST_OAUTH_INIT_MISSING: ['node', ['SCRIPTS/RunInstantlyGoogleOAuthZeroCostMissingBatch.js', '--authorization', 'AUTHORIZE_ZERO_COST_PAID_SENDER_GOOGLE_OAUTH']],
  INSTANTLY_ZERO_COST_OAUTH_BROWSER_GUARDED: ['node', ['SCRIPTS/RunInstantlyGoogleOAuthBrowserGuarded.js', '--authorization', 'AUTHORIZE_EXISTING_AUTHENTICATED_GOOGLE_OAUTH_CONSENT']],
  COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY: ['node', ['SCRIPTS/DeployConsolidatedCOOSelfMaintenance.js']],
  P2GC_FEDERAL_GROWTH_REVIEW_DEPLOY: ['node', ['SCRIPTS/DeployP2GCFederalGrowthReview.js']],
  COO_RUNTIME_APPROVAL_AUDIT: ['node', ['SCRIPTS/AuditRuntimeApprovalBacklog.js']],
  ORION_OFFICIAL_SOURCE_ACQUISITION_PLAN: ['node', ['SCRIPTS/PlanOrionOfficialSourceAcquisition.js']],
  ORION_OFFICIAL_SOURCE_ACQUIRE_STAGING: ['node', ['SCRIPTS/AcquireOrionOfficialSourceToStaging.js']],
  ORION_OFFICIAL_ARCHIVE_INSPECTION: ['node', ['SCRIPTS/InspectOrionOfficialArchives.js']],
  ORION_REFRESH_TARGET_SCHEMA_AUDIT: ['node', ['SCRIPTS/AuditOrionRefreshTargetSchema.js']],
  OUTBOUND_SENDER_CAPACITY_FULL_GO: ['node', ['SCRIPTS/RunOutboundSenderCapacityFullGoGate.js']],
  ORION_CONTRACT_SIDECAR_BUILD: ['node', ['SCRIPTS/BuildOrionContractSidecar.js']],
  FEDERAL_SOURCE_READINESS_AUDIT: ['node', ['SCRIPTS/AuditFederalSourceReadiness.js']],
  SAM_BULK_EXTRACT_ACQUIRE_STAGING: ['node', ['SCRIPTS/AcquireSamBulkExtractsToStaging.js']],
  SAM_BULK_SCHEMA_AUDIT: ['node', ['SCRIPTS/InspectSamBulkSchema.js']],
  SAM_QUALIFIED_UNIVERSE_BUILD: ['node', ['SCRIPTS/BuildSamQualifiedUniverse.js']],
  SAM_CONTACT_RECOVERY_SOURCE_AUDIT: ['node', ['SCRIPTS/AuditSamContactRecoverySources.js']],
  SAM_EMAIL_RECOVERY: ['node', ['SCRIPTS/RecoverSamQualifiedEmails.js']],
  SAM_SQLITE_EMAIL_RECOVERY: ['node', ['SCRIPTS/RecoverSamQualifiedEmailsFromSqlite.js']],
  SAM_CURRENT_SEND_COLLISION_AUDIT: ['node', ['SCRIPTS/AuditSamCurrentSendCollisions.js']],
  SAM_PUBLIC_EMAIL_DISCOVERY: ['node', ['SCRIPTS/DiscoverSamPublicEmails.js']],
  ZERO_COST_EXTERNAL_PLACEMENT_EXECUTE: ['node', ['SCRIPTS/RunZeroCostExternalInboxPlacement.js', '--authorization', 'AUTHORIZE_ZERO_COST_EXTERNAL_PLACEMENT_TESTS']]
});

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastDirectiveId: null, runs: [] }; }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishResolve = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const finishReject = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = https.get(url, { headers: { 'user-agent': 'MILES-Remote-Execution-Bridge' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return finishReject(new Error(`DIRECTIVE_HTTP_${res.statusCode}`));
        try { finishResolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { finishReject(new Error(`DIRECTIVE_JSON_INVALID:${e.message}`)); }
      });
    });
    request.setTimeout(DIRECTIVE_HTTP_TIMEOUT_MS, () => {
      request.destroy(new Error(`DIRECTIVE_HTTP_TIMEOUT_${DIRECTIVE_HTTP_TIMEOUT_MS}MS`));
    });
    request.on('error', finishReject);
  });
}

async function getDirectiveViaGit() {
  const ref = `refs/heads/${CONTROL_BRANCH}`;
  const remoteRef = `refs/remotes/origin/${CONTROL_BRANCH}`;
  const ls = await gitRun(['ls-remote', 'origin', ref], 'CONTROL-GIT', { quiet: true });
  const line = requireSuccess(ls, 'CONTROL_GIT_LS_REMOTE_FAILED').split(/\r?\n/).find(Boolean) || '';
  const sha = line.trim().split(/\s+/)[0] || '';
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('CONTROL_GIT_REMOTE_SHA_INVALID');
  if (controlDirectiveCache.sha === sha && controlDirectiveCache.directive) return controlDirectiveCache.directive;

  requireSuccess(
    await gitRun(['fetch', '--quiet', 'origin', `+${ref}:${remoteRef}`], 'CONTROL-GIT', { quiet: true }),
    'CONTROL_GIT_FETCH_FAILED'
  );
  const shown = requireSuccess(
    await gitRun(['show', `${sha}:${DIRECTIVE_REPO_PATH}`], 'CONTROL-GIT', { quiet: true }),
    'CONTROL_GIT_SHOW_FAILED'
  );
  let directive;
  try { directive = JSON.parse(shown); }
  catch (error) { throw new Error(`CONTROL_GIT_DIRECTIVE_JSON_INVALID:${error.message}`); }
  controlDirectiveCache = { sha, directive };
  return directive;
}

async function getDirective() {
  try { return await getDirectiveViaGit(); }
  catch (error) {
    console.error('[MILES REMOTE BRIDGE] CONTROL-GIT fallback:', error.message);
    return getJson(`${DIRECTIVE_URL}?t=${Date.now()}`);
  }
}

function run(command, args, label, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: options.env || process.env,
      shell: false,
      windowsHide: true
    });
    let stdout = '', stderr = '', settled = false, timer = null;
    const timeoutMs = Math.max(0, Number(options.timeoutMs || 0));
    const finish = result => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    child.stdout?.on('data', d => { const s=d.toString(); stdout += s; if (!options.quiet) process.stdout.write(`[${label}] ${s}`); });
    child.stderr?.on('data', d => { const s=d.toString(); stderr += s; if (!options.quiet) process.stderr.write(`[${label}] ${s}`); });
    child.on('close', (code, signal) => finish({ code, signal: signal || null, stdout, stderr, timedOut: false }));
    child.on('error', e => finish({ code: -1, signal: null, stdout, stderr: `${stderr}\n${e.message}`, timedOut: false }));
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        const marker = `COMMAND_TIMEOUT_${timeoutMs}MS`;
        stderr = `${stderr}\n${marker}`.trim();
        try { child.kill(); } catch {}
        finish({ code: -2, signal: 'TIMEOUT', stdout, stderr, timedOut: true, timeoutMs });
      }, timeoutMs);
      timer.unref?.();
    }
  });
}

function requireSuccess(result, code) {
  if (!result || result.code !== 0) {
    const suffix = result?.timedOut ? `_TIMEOUT_${result.timeoutMs || 'UNKNOWN'}MS` : '';
    throw new Error(`${code}${suffix}`);
  }
  return String(result.stdout || '').trim();
}

function gitRun(commandArgs, label = 'GIT', options = {}) {
  return run('git', commandArgs, label, { ...options, timeoutMs: GIT_COMMAND_TIMEOUT_MS });
}

async function safeFastForward() {
  const fetchResult = await gitRun(['fetch', 'origin', 'main']);
  requireSuccess(fetchResult, 'GIT_FETCH_FAILED');
  const mergeResult = await gitRun(['merge', '--ff-only', 'origin/main']);
  requireSuccess(mergeResult, 'GIT_FAST_FORWARD_FAILED_NO_DESTRUCTIVE_RECOVERY_ATTEMPTED');
}

function bridgeSourceChanged(startupDigest = STARTUP_SOURCE_DIGEST) {
  return sourceDigest() !== startupDigest;
}

async function relaunchCurrentBridge() {
  const child = spawn(process.execPath, [SOURCE_FILE], {
    cwd: ROOT,
    env: process.env,
    shell: false,
    windowsHide: true,
    detached: true,
    stdio: 'ignore'
  });

  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('SELF_RELOAD_SPAWN_TIMEOUT'));
    }, 3000);
    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });

  child.unref();
  console.log(`[MILES REMOTE BRIDGE] SELF-RELOAD pid=${child.pid}`);
  await new Promise(resolve => setTimeout(resolve, 750));
  if (child.exitCode !== null) throw new Error(`SELF_RELOAD_CHILD_EXITED_EARLY:${child.exitCode}`);
  return child.pid;
}

function validateDirective(d) {
  if (!d || d.enabled !== true) return { ok: false, reason: 'DISABLED' };
  if (!d.id || typeof d.id !== 'string') return { ok: false, reason: 'MISSING_ID' };
  if (!Object.prototype.hasOwnProperty.call(JOBS, d.job)) return { ok: false, reason: 'JOB_NOT_ALLOWLISTED' };
  return { ok: true };
}

async function publishEvidence(evidence) {
  fs.mkdirSync(path.dirname(EVIDENCE_FILE), { recursive: true });
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2), 'utf8');

  const fetchResult = await gitRun(['fetch', 'origin', 'main'], 'EVIDENCE-GIT', { quiet: true });
  requireSuccess(fetchResult, 'EVIDENCE_GIT_FETCH_FAILED');

  const blob = requireSuccess(
    await gitRun(['hash-object', '-w', EVIDENCE_FILE], 'EVIDENCE-GIT', { quiet: true }),
    'EVIDENCE_BLOB_CREATE_FAILED'
  );

  const indexNonce = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const indexPath = path.join(ROOT, 'DATA', 'runtime', `remote-evidence-${process.pid}-${indexNonce}.index`);
  const gitEnv = {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'MILES Runtime',
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'miles-runtime@local.invalid',
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'MILES Runtime',
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'miles-runtime@local.invalid'
  };

  try {
    requireSuccess(await gitRun(['read-tree', 'origin/main'], 'EVIDENCE-GIT', { env: gitEnv, quiet: true }), 'EVIDENCE_READ_TREE_FAILED');
    requireSuccess(await gitRun(['update-index', '--add', '--cacheinfo', `100644,${blob},${EVIDENCE_REPO_PATH}`], 'EVIDENCE-GIT', { env: gitEnv, quiet: true }), 'EVIDENCE_UPDATE_INDEX_FAILED');
    const tree = requireSuccess(await gitRun(['write-tree'], 'EVIDENCE-GIT', { env: gitEnv, quiet: true }), 'EVIDENCE_WRITE_TREE_FAILED');
    const commit = requireSuccess(
      await gitRun(['commit-tree', tree, '-p', 'origin/main', '-m', `MILES runtime evidence ${evidence.directiveId} ${evidence.phase || 'FINAL'}`], 'EVIDENCE-GIT', { env: gitEnv, quiet: true }),
      'EVIDENCE_COMMIT_TREE_FAILED'
    );
    requireSuccess(
      await gitRun(['push', 'origin', `+${commit}:refs/heads/${EVIDENCE_BRANCH}`], 'EVIDENCE-GIT', { env: gitEnv, quiet: true }),
      'EVIDENCE_PUSH_FAILED'
    );
    return { ok: true, branch: EVIDENCE_BRANCH, repoPath: EVIDENCE_REPO_PATH, commit };
  } finally {
    try { fs.unlinkSync(indexPath); } catch {}
  }
}

function publishEvidenceSerialized(evidence) {
  const task = evidencePublishTail.then(
    () => publishEvidence(evidence),
    () => publishEvidence(evidence)
  );
  evidencePublishTail = task.catch(() => undefined);
  return task;
}

function baseEvidence(directive, startedAt, phase) {
  return {
    ok: phase === 'COMPLETED',
    phase,
    directiveId: directive.id,
    job: directive.job,
    startedAt,
    observedAt: new Date().toISOString(),
    safety: {
      arbitraryShell: false,
      destructiveGitRecovery: false,
      evidenceBranchOnly: EVIDENCE_BRANCH
    }
  };
}

async function executeDirective(directive, state) {
  if (!directive || directive.enabled !== true) return { skipped: true, reason: 'DISABLED' };
  if (!directive.id || typeof directive.id !== 'string') return { skipped: true, reason: 'MISSING_ID' };
  if (directive.id === state.lastDirectiveId) return { skipped: true, reason: 'ALREADY_EXECUTED' };

  await safeFastForward();
  if (bridgeSourceChanged()) {
    if (BRIDGE_SUPERVISED) {
      console.log(`[MILES REMOTE BRIDGE] SUPERVISOR_RESTART_REQUESTED exit=${SUPERVISED_RESTART_EXIT_CODE}`);
      setTimeout(() => process.exit(SUPERVISED_RESTART_EXIT_CODE), 0);
      return { skipped: true, reason: 'SUPERVISOR_RESTART_AFTER_CODE_UPDATE' };
    }
    await relaunchCurrentBridge();
    setTimeout(() => process.exit(0), 0);
    return { skipped: true, reason: 'SELF_RELOAD_AFTER_CODE_UPDATE' };
  }

  const validation = validateDirective(directive);
  if (!validation.ok) return { skipped: true, reason: validation.reason };

  const [command, args] = JOBS[directive.job];
  const startedAt = new Date().toISOString();

  try {
    await publishEvidenceSerialized(baseEvidence(directive, startedAt, 'STARTED'));
  } catch (error) {
    console.error('[MILES REMOTE BRIDGE] STARTED evidence publish failed:', error.message);
  }

  let progressPublishing = false;
  const progressTimer = setInterval(async () => {
    if (progressPublishing) return;
    progressPublishing = true;
    try {
      await publishEvidenceSerialized({
        ...baseEvidence(directive, startedAt, 'RUNNING'),
        elapsedSeconds: Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000))
      });
    } catch (error) {
      console.error('[MILES REMOTE BRIDGE] RUNNING evidence publish failed:', error.message);
    } finally {
      progressPublishing = false;
    }
  }, PROGRESS_MS);

  const result = await run(command, args, directive.job);
  clearInterval(progressTimer);
  const finishedAt = new Date().toISOString();
  const record = { id: directive.id, job: directive.job, startedAt, finishedAt, code: result.code };
  state.lastDirectiveId = directive.id;
  state.runs = [...(state.runs || []).slice(-49), record];
  state.lastResult = record;
  writeState(state);

  const evidence = {
    ...baseEvidence(directive, startedAt, 'COMPLETED'),
    ok: result.code === 0,
    finishedAt,
    exitCode: result.code,
    stdoutTail: String(result.stdout || '').slice(-16000),
    stderrTail: String(result.stderr || '').slice(-8000)
  };

  try {
    record.evidence = await publishEvidenceSerialized(evidence);
  } catch (error) {
    record.evidence = { ok: false, error: error.message };
    state.lastResult = record;
    writeState(state);
  }

  // The consolidated deploy changes code loaded by the autonomous COO runtime.
  // Only after final state and evidence are safely persisted may the supervised
  // bridge request a whole control-owner recycle. Exit 76 is interpreted by the
  // supervisor as a PM2/runtime-guard restart request rather than a bridge-only
  // restart, eliminating detached restart helpers and post-deploy control gaps.
  if (
    BRIDGE_SUPERVISED &&
    directive.job === 'COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY' &&
    result.code === 0
  ) {
    console.log(`[MILES REMOTE BRIDGE] CONTROL_OWNER_RESTART_REQUESTED exit=${CONTROL_OWNER_RESTART_EXIT_CODE}`);
    setTimeout(() => process.exit(CONTROL_OWNER_RESTART_EXIT_CODE), 0);
  }
  return record;
}

async function tick() {
  const state = readState();
  const directive = await getDirective();
  return executeDirective(directive, state);
}

async function main() {
  console.log('[MILES REMOTE BRIDGE] STARTED');
  console.log(`[MILES REMOTE BRIDGE] Poll ${Math.round(POLL_MS/1000)}s`);
  console.log(`[MILES REMOTE BRIDGE] Progress publish ${Math.round(PROGRESS_MS/1000)}s`);
  console.log(`[MILES REMOTE BRIDGE] Directive HTTP timeout ${Math.round(DIRECTIVE_HTTP_TIMEOUT_MS/1000)}s`);
  console.log(`[MILES REMOTE BRIDGE] Git command timeout ${Math.round(GIT_COMMAND_TIMEOUT_MS/1000)}s`);
  console.log(`[MILES REMOTE BRIDGE] Control branch: ${CONTROL_BRANCH}`);
  console.log(`[MILES REMOTE BRIDGE] Allowlisted jobs: ${Object.keys(JOBS).join(', ')}`);
  console.log(`[MILES REMOTE BRIDGE] Evidence branch: ${EVIDENCE_BRANCH}`);
  console.log(`[MILES REMOTE BRIDGE] Supervised: ${BRIDGE_SUPERVISED}`);
  for (;;) {
    try {
      const result = await tick();
      if (!result?.skipped) console.log('[MILES REMOTE BRIDGE] EXECUTED', JSON.stringify(result));
    } catch (error) {
      console.error('[MILES REMOTE BRIDGE] ERROR', error.message);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = {
  JOBS,
  CONTROL_BRANCH,
  DIRECTIVE_REPO_PATH,
  DIRECTIVE_URL,
  EVIDENCE_BRANCH,
  EVIDENCE_REPO_PATH,
  PROGRESS_MS,
  DIRECTIVE_HTTP_TIMEOUT_MS,
  GIT_COMMAND_TIMEOUT_MS,
  STARTUP_SOURCE_DIGEST,
  BRIDGE_SUPERVISED,
  SUPERVISED_RESTART_EXIT_CODE,
  CONTROL_OWNER_RESTART_EXIT_CODE,
  validateDirective,
  getDirectiveViaGit,
  getDirective,
  executeDirective,
  safeFastForward,
  publishEvidence,
  publishEvidenceSerialized,
  baseEvidence,
  sourceDigest,
  bridgeSourceChanged,
  relaunchCurrentBridge,
  run,
  gitRun
};