'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const ROOT = __dirname;
const POLL_MS = Math.max(5000, Number(process.env.MILES_REMOTE_BRIDGE_POLL_MS || 15000));
const DIRECTIVE_URL = process.env.MILES_REMOTE_DIRECTIVE_URL || 'https://raw.githubusercontent.com/lifesalt5-netizen/MILES_ENTERPRISE/main/DATA/control/miles_remote_execution_directive.json';
const STATE_FILE = path.join(ROOT, 'DATA', 'runtime', 'remote_execution_bridge_state.json');

const JOBS = Object.freeze({
  REVENUE_ACCEPTANCE_SPRINT: ['node', ['SCRIPTS/RunRevenueAcceptanceSprint.js']],
  INBOX_PLACEMENT_AUDIT: ['node', ['SCRIPTS/AuditInstantlyInboxPlacement.js', '--test-id', '01a040ce-dbf7-7872-8938-f1501647af92']],
  PRODUCTION_TRUTH_RECONCILIATION: ['node', ['SCRIPTS/ReconcileProductionTruth.js']]
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
    https.get(url, { headers: { 'user-agent': 'MILES-Remote-Execution-Bridge' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`DIRECTIVE_HTTP_${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error(`DIRECTIVE_JSON_INVALID:${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function run(command, args, label) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: ROOT, env: process.env, shell: false, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { const s=d.toString(); stdout += s; process.stdout.write(`[${label}] ${s}`); });
    child.stderr.on('data', d => { const s=d.toString(); stderr += s; process.stderr.write(`[${label}] ${s}`); });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.on('error', e => resolve({ code: -1, stdout, stderr: `${stderr}\n${e.message}` }));
  });
}

async function safeFastForward() {
  const fetchResult = await run('git', ['fetch', 'origin', 'main'], 'GIT');
  if (fetchResult.code !== 0) throw new Error('GIT_FETCH_FAILED');
  const mergeResult = await run('git', ['merge', '--ff-only', 'origin/main'], 'GIT');
  if (mergeResult.code !== 0) throw new Error('GIT_FAST_FORWARD_FAILED_NO_DESTRUCTIVE_RECOVERY_ATTEMPTED');
}

function validateDirective(d) {
  if (!d || d.enabled !== true) return { ok: false, reason: 'DISABLED' };
  if (!d.id || typeof d.id !== 'string') return { ok: false, reason: 'MISSING_ID' };
  if (!Object.prototype.hasOwnProperty.call(JOBS, d.job)) return { ok: false, reason: 'JOB_NOT_ALLOWLISTED' };
  return { ok: true };
}

async function executeDirective(directive, state) {
  const validation = validateDirective(directive);
  if (!validation.ok) return { skipped: true, reason: validation.reason };
  if (directive.id === state.lastDirectiveId) return { skipped: true, reason: 'ALREADY_EXECUTED' };

  await safeFastForward();
  const [command, args] = JOBS[directive.job];
  const startedAt = new Date().toISOString();
  const result = await run(command, args, directive.job);
  const record = { id: directive.id, job: directive.job, startedAt, finishedAt: new Date().toISOString(), code: result.code };
  state.lastDirectiveId = directive.id;
  state.runs = [...(state.runs || []).slice(-49), record];
  state.lastResult = record;
  writeState(state);
  return record;
}

async function tick() {
  const state = readState();
  const directive = await getJson(`${DIRECTIVE_URL}?t=${Date.now()}`);
  return executeDirective(directive, state);
}

async function main() {
  console.log('[MILES REMOTE BRIDGE] STARTED');
  console.log(`[MILES REMOTE BRIDGE] Poll ${Math.round(POLL_MS/1000)}s`);
  console.log(`[MILES REMOTE BRIDGE] Allowlisted jobs: ${Object.keys(JOBS).join(', ')}`);
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
module.exports = { JOBS, validateDirective, executeDirective, safeFastForward };
