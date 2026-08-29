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
const DIRECTIVE_URL = process.env.MILES_REMOTE_DIRECTIVE_URL || `https://raw.githubusercontent.com/lifesalt5-netizen/MILES_ENTERPRISE/${CONTROL_BRANCH}/DATA/control/miles_remote_execution_directive.json`;
const STATE_FILE = path.join(ROOT, 'DATA', 'runtime', 'remote_execution_bridge_state.json');
const EVIDENCE_FILE = path.join(ROOT, 'DATA', 'runtime', 'remote_execution_bridge_evidence.json');
const EVIDENCE_BRANCH = 'miles-runtime-evidence';
const EVIDENCE_REPO_PATH = 'DATA/control/miles_remote_execution_result.json';
const BRIDGE_SUPERVISED = ['1','true','yes','y','on'].includes(String(process.env.MILES_BRIDGE_SUPERVISED || '').trim().toLowerCase());
const SUPERVISED_RESTART_EXIT_CODE = 75;
let evidencePublishTail = Promise.resolve();

function sourceDigest(file = SOURCE_FILE) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
const STARTUP_SOURCE_DIGEST = sourceDigest();

const JOBS = Object.freeze({
  REVENUE_ACCEPTANCE_SPRINT: ['node', ['SCRIPTS/RunRevenueAcceptanceSprint.js']],
  INBOX_PLACEMENT_AUDIT: ['node', ['SCRIPTS/AuditInstantlyInboxPlacement.js', '--test-id', '01a040ce-dbf7-7872-8938-f1501647af92']],
  PRODUCTION_TRUTH_RECONCILIATION: ['node', ['SCRIPTS/ReconcileProductionTruth.js']],
  INFRASTRUCTURE_HEALTH_AUDIT: ['node', ['SCRIPTS/RunInfrastructureHealthAudit.js']],
  CEO_APPROVAL_CONTROL_ACCEPTANCE: ['node', ['SCRIPTS/RunCeoApprovalControlAcceptance.js']],
  CONTROL_OWNER_WATCHDOG_INSTALL: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'SCRIPTS/InstallMilesControlOwnerWatchdogWindows.ps1', '-Root', ROOT]],
  CONTROL_OWNER_WATCHDOG_ENSURE: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'SCRIPTS/EnsureMilesControlOwnerWindows.ps1', '-Root', ROOT]],
  CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_SCHEDULE: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'SCRIPTS/ScheduleMilesControlOwnerRecoveryProofWindows.ps1', '-Root', ROOT]],
  CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_VERIFY: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'SCRIPTS/VerifyMilesControlOwnerRecoveryProofWindows.ps1', '-Root', ROOT]],
  IONOS_INBOX_CLEANUP_PLAN: ['node', ['SCRIPTS/RunIonosInboxCleanup.js']],
  IONOS_INBOX_CLEANUP_EXECUTE: ['node', ['SCRIPTS/RunIonosInboxCleanup.js', '--execute']],
  IONOS_SPAM_RESCUE_PLAN: ['node', ['SCRIPTS/RunIonosSpamRescue.js']],
  IONOS_SPAM_RESCUE_EXECUTE: ['node', ['SCRIPTS/RunIonosSpamRescue.js', '--execute']],
  INSTANTLY_LIFECYCLE_PROOF_PLAN: ['node', ['SCRIPTS/RunInstantlyLifecycleProof.js']],
  INSTANTLY_LIFECYCLE_PROOF_EXECUTE: ['node', ['SCRIPTS/RunInstantlyLifecycleProof.js', '--execute']]
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
    const finishResolve = value => { if (!settled) { settled = true; resolve(value); } };
    const finishReject = error => { if (!settled) { settled = true; reject(error); } };
    const request = https.get(url, { headers: { 'user-agent': 'MILES-Remote-Execution-Bridge' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return finishReject(new Error(`DIRECTIVE_HTTP_${res.statusCode}`));
        try { finishResolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { finishReject(new Error(`DIRECTIVE_JSON_INVALID:${e.message}`)); }
      });
    });
    request.setTimeout(DIRECTIVE_HTTP_TIMEOUT_MS, () => { request.destroy(new Error('DIRECTIVE_HTTP_TIMEOUT')); });
    request.on('error', finishReject);
  });
}

function run(command, args, label = 'JOB', options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 0)) || null;
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const finish = payload => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(payload);
    };
    child.stdout.on('data', c => { stdout += c.toString(); });
    child.stderr.on('data', c => { stderr += c.toString(); });
    child.once('error', error => finish({ code: -1, error: error.message, stdout, stderr }));
    child.once('close', code => finish({ code: Number(code), stdout, stderr }));
    if (timeoutMs) {
      timer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish({ code: -2, error: `${label}_TIMEOUT`, stdout, stderr, timedOut: true, timeoutMs });
      }, timeoutMs);
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
    child.once('spawn', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } });
    child.once('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
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
  const blob = requireSuccess(await gitRun(['hash-object', '-w', EVIDENCE_FILE], 'EVIDENCE-GIT', { quiet: true }), 'EVIDENCE_BLOB_CREATE_FAILED');
  const indexNonce = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const indexPath = path.join(ROOT, 'DATA', 'runtime', `remote-evidence-${process.pid}-${indexNonce}.index`);
  const gitEnv = { ...process.env, GIT_INDEX_FILE: indexPath, GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'MILES Runtime', GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'miles-runtime@local.invalid', GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'MILES Runtime', GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'miles-runtime@local.invalid' };
  try {
    requireSuccess(await gitRun(['read-tree', 'origin/main'], 'EVIDENCE-GIT', { env: gitEnv, quiet: true }), 'EVIDENCE_READ_TREE_FAILED');
    requireSuccess(await gitRun(['update-index', '--add', '--cacheinfo', `100644,${blob},${EVIDENCE_REPO_PATH}`], 'EVIDENCE-GIT', { env: gitEnv, quiet: true }), 'EVIDENCE_UPDATE_INDEX_FAILED');
    const tree = requireSuccess(await gitRun(['write-tree'], 'EVIDENCE-GIT', { env: gitEnv, quiet: true }), 'EVIDENCE_WRITE_TREE_FAILED');
    const commit = requireSuccess(await gitRun(['commit-tree', tree, '-p', 'origin/main', '-m', `MILES runtime evidence ${evidence.directiveId} ${evidence.phase || 'FINAL'}`], 'EVIDENCE-GIT', { env: gitEnv, quiet: true }), 'EVIDENCE_COMMIT_TREE_FAILED');
    requireSuccess(await gitRun(['push', 'origin', `+${commit}:refs/heads/${EVIDENCE_BRANCH}`], 'EVIDENCE-GIT', { env: gitEnv, quiet: true }), 'EVIDENCE_PUSH_FAILED');
    return { ok: true, branch: EVIDENCE_BRANCH, repoPath: EVIDENCE_REPO_PATH, commit };
  } finally {
    try { fs.unlinkSync(indexPath); } catch {}
  }
}

function publishEvidenceSerialized(evidence) {
  const task = evidencePublishTail.then(() => publishEvidence(evidence), () => publishEvidence(evidence));
  evidencePublishTail = task.catch(() => undefined);
  return task;
}

function baseEvidence(directive, startedAt, phase) {
  return { ok: phase === 'COMPLETED', phase, directiveId: directive.id, job: directive.job, startedAt, observedAt: new Date().toISOString(), safety: { arbitraryShell: false, destructiveGitRecovery: false, evidenceBranchOnly: EVIDENCE_BRANCH } };
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
  try { await publishEvidenceSerialized(baseEvidence(directive, startedAt, 'STARTED')); }
  catch (error) { console.error('[MILES REMOTE BRIDGE] STARTED evidence publish failed:', error.message); }
  let progressPublishing = false;
  const progressTimer = setInterval(async () => {
    if (progressPublishing) return;
    progressPublishing = true;
    try { await publishEvidenceSerialized({ ...baseEvidence(directive, startedAt, 'RUNNING'), elapsedSeconds: Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000)) }); }
    catch (error) { console.error('[MILES REMOTE BRIDGE] RUNNING evidence publish failed:', error.message); }
    finally { progressPublishing = false; }
  }, PROGRESS_MS);
  const result = await run(command, args, directive.job);
  clearInterval(progressTimer);
  const finishedAt = new Date().toISOString();
  const record = { id: directive.id, job: directive.job, startedAt, finishedAt, code: result.code };
  state.lastDirectiveId = directive.id;
  state.runs = [...(state.runs || []).slice(-49), record];
  state.lastResult = record;
  writeState(state);
  const evidence = { ...baseEvidence(directive, startedAt, 'COMPLETED'), ok: result.code === 0, finishedAt, exitCode: result.code, stdoutTail: String(result.stdout || '').slice(-16000), stderrTail: String(result.stderr || '').slice(-8000) };
  try { record.evidence = await publishEvidenceSerialized(evidence); }
  catch (error) { record.evidence = { ok: false, error: error.message }; console.error('[MILES REMOTE BRIDGE] FINAL evidence publish failed:', error.message); }
  return record;
}

async function main() {
  const state = readState();
  const poll = async () => {
    try {
      const directive = await getJson(`${DIRECTIVE_URL}?t=${Date.now()}`);
      const result = await executeDirective(directive, state);
      if (!result?.skipped) console.log('[MILES REMOTE BRIDGE] EXECUTED', JSON.stringify(result));
    } catch (error) {
      console.error('[MILES REMOTE BRIDGE] poll error:', error.message);
    }
  };
  await poll();
  setInterval(poll, POLL_MS);
  console.log(`[MILES REMOTE BRIDGE] STARTED pollMs=${POLL_MS} directive=${DIRECTIVE_URL}`);
}

if (require.main === module) main().catch(error => { console.error('[MILES REMOTE BRIDGE] FATAL', error.stack || error.message); process.exitCode = 2; });

module.exports = { JOBS, readState, writeState, validateDirective, executeDirective, safeFastForward, bridgeSourceChanged, sourceDigest, relaunchCurrentBridge, main };
