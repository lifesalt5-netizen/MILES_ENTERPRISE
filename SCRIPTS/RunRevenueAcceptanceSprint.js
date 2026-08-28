'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TEST_ID = '01a040ce-dbf7-7872-8938-f1501647af92';
const POLL_MS = Number(process.env.MILES_PLACEMENT_POLL_MS || 90000);
const MAX_WAIT_MS = Number(process.env.MILES_PLACEMENT_MAX_WAIT_MS || 30 * 60 * 1000);
const AUDIT_TIMEOUT_MS = Number(process.env.MILES_REVENUE_AUDIT_TIMEOUT_MS || 10 * 60 * 1000);
const MIN_ANALYTICS_ROWS = Number(process.env.MILES_PLACEMENT_MIN_ANALYTICS_ROWS || 27);
const MIN_SENDER_EVIDENCE = Number(process.env.MILES_PLACEMENT_MIN_SENDER_EVIDENCE || 9);
const REQUIRED_STABLE_POLLS = Number(process.env.MILES_PLACEMENT_REQUIRED_STABLE_POLLS || 2);
const MIN_PLATEAU_ROWS = Number(process.env.MILES_PLACEMENT_MIN_PLATEAU_ROWS || 18);
const REQUIRED_PLATEAU_POLLS = Number(process.env.MILES_PLACEMENT_REQUIRED_PLATEAU_POLLS || 4);

const SAFE_AUDITS = [
  ['SCRIPTS/AUDIT_MILES_REVENUE_OPERATIONS.js'],
  ['SCRIPTS/AUDIT_MILES_MEETING_PIPELINE.js'],
  ['SCRIPTS/AUDIT_MILES_CALENDLY_PIPELINE.js'],
  ['SCRIPTS/AUDIT_OUTBOUND_SENDER_CAPACITY_V2.js'],
  ['SCRIPTS/AuditInstantlyOperationalContinuity.js'],
  ['SCRIPTS/AUDIT_OUTREACH_DOMAIN_DNS_READONLY.js'],
  ['SCRIPTS/AuditInstantlySendWindowHistory.js'],
  ['SCRIPTS/AuditUnified8787ScreenAcceptance.js'],
  ['SCRIPTS/AuditOrionRebuildReadiness.js'],
  ['SCRIPTS/AuditOrionOfficialSourceAvailability.js'],
  ['SCRIPTS/QualifyRepositoryRisks.js'],
  ['SCRIPTS/ReconcileProductionTruth.js']
];

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function runNode(args, label, timeoutMs = AUDIT_TIMEOUT_MS) {
  return new Promise(resolve => {
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const finish = (code, extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ label, args, startedAt, finishedAt: new Date().toISOString(), code, stdout, stderr, timedOut, ...extra });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      const timeoutMessage = `AUDIT_TIMEOUT_AFTER_${timeoutMs}MS`;
      stderr = `${stderr}${stderr ? '\n' : ''}${timeoutMessage}`;
      process.stderr.write(`[${label}] ${timeoutMessage}\n`);
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        if (!settled) {
          try { child.kill('SIGKILL'); } catch {}
          finish(124, { timeoutMs });
        }
      }, 5000).unref?.();
    }, timeoutMs);

    child.stdout.on('data', d => { const s = d.toString(); stdout += s; process.stdout.write(`[${label}] ${s}`); });
    child.stderr.on('data', d => { const s = d.toString(); stderr += s; process.stderr.write(`[${label}] ${s}`); });
    child.on('close', code => finish(timedOut ? 124 : code, timedOut ? { timeoutMs } : {}));
    child.on('error', err => {
      stderr = `${stderr}${stderr ? '\n' : ''}${err.message}`;
      finish(-1);
    });
  });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function parsePlacement(stdout = '') {
  const rowsMatch = stdout.match(/Analytics rows:\s*(\d+)/i);
  const sendersMatch = stdout.match(/Senders with evidence:\s*(\d+)/i);
  const watchMatch = stdout.match(/AUTH WATCH:\s*([^\r\n]+)/i);
  const rows = rowsMatch ? Number(rowsMatch[1]) : 0;
  const senders = sendersMatch ? Number(sendersMatch[1]) : 0;
  const authWatchSenders = watchMatch
    ? watchMatch[1].split(',').map(x => x.trim()).filter(Boolean)
    : [];
  return { rows, senders, authWatchSenders };
}

function placementFingerprint(v = {}) {
  return JSON.stringify({
    rows: Number(v.rows || 0),
    senders: Number(v.senders || 0),
    authWatchSenders: [...(v.authWatchSenders || [])].sort()
  });
}

async function pollPlacement(testId) {
  const started = Date.now();
  const attempts = [];
  let previousQualifiedRows = null;
  let stablePolls = 0;
  let previousPlateauFingerprint = null;
  let plateauPolls = 0;
  let latest = { rows: 0, senders: 0, authWatchSenders: [] };

  while (Date.now() - started <= MAX_WAIT_MS) {
    const result = await runNode(['SCRIPTS/AuditInstantlyInboxPlacement.js', '--test-id', testId], 'PLACEMENT', Math.min(AUDIT_TIMEOUT_MS, MAX_WAIT_MS));
    latest = parsePlacement(result.stdout);
    attempts.push({ ...result, parsed: latest });

    if (result.timedOut) {
      console.log('[PLACEMENT] placement audit child timed out; preserving fail-closed evidence state.');
      break;
    }

    const materiallyPopulated = latest.rows >= MIN_ANALYTICS_ROWS && latest.senders >= MIN_SENDER_EVIDENCE;
    if (materiallyPopulated) {
      if (previousQualifiedRows === latest.rows) stablePolls += 1;
      else stablePolls = 1;
      previousQualifiedRows = latest.rows;
      if (stablePolls >= REQUIRED_STABLE_POLLS) {
        return {
          ready: true,
          stable: true,
          evidenceBasis: 'CONFIGURED_COMPLETENESS_TARGET_STABLE',
          rows: latest.rows,
          senders: latest.senders,
          authWatchSenders: latest.authWatchSenders,
          stablePolls,
          plateauPolls,
          attempts
        };
      }
    } else {
      stablePolls = 0;
      previousQualifiedRows = null;
    }

    const plateauEligible = latest.rows >= MIN_PLATEAU_ROWS && latest.senders >= MIN_SENDER_EVIDENCE;
    if (plateauEligible) {
      const fingerprint = placementFingerprint(latest);
      if (fingerprint === previousPlateauFingerprint) plateauPolls += 1;
      else plateauPolls = 1;
      previousPlateauFingerprint = fingerprint;
      if (plateauPolls >= REQUIRED_PLATEAU_POLLS) {
        console.log(`[PLACEMENT] provider plateau accepted for verdict: rows=${latest.rows}, senders=${latest.senders}, unchanged=${plateauPolls} polls. Missing rows remain explicitly unobserved; current WATCH senders stay fail-closed.`);
        return {
          ready: true,
          stable: true,
          evidenceBasis: 'STABLE_PROVIDER_PLATEAU_BELOW_CONFIGURED_ROW_TARGET',
          rows: latest.rows,
          senders: latest.senders,
          authWatchSenders: latest.authWatchSenders,
          stablePolls,
          plateauPolls,
          attempts
        };
      }
    } else {
      plateauPolls = 0;
      previousPlateauFingerprint = null;
    }

    if (Date.now() - started + POLL_MS > MAX_WAIT_MS) break;
    console.log(`[PLACEMENT] evidence pending: rows=${latest.rows}/${MIN_ANALYTICS_ROWS}, senders=${latest.senders}/${MIN_SENDER_EVIDENCE}, completeStable=${stablePolls}/${REQUIRED_STABLE_POLLS}, plateau=${plateauPolls}/${REQUIRED_PLATEAU_POLLS}; retrying in ${Math.round(POLL_MS / 1000)}s`);
    await sleep(POLL_MS);
  }

  return {
    ready: false,
    stable: false,
    evidenceBasis: 'MAX_WAIT_REACHED_WITHOUT_STABLE_COMPLETENESS_OR_PLATEAU',
    rows: latest.rows,
    senders: latest.senders,
    authWatchSenders: latest.authWatchSenders,
    stablePolls,
    plateauPolls,
    attempts
  };
}

async function main() {
  const testId = argValue('--test-id', DEFAULT_TEST_ID);
  const root = path.resolve(process.env.MILES_ROOT || process.cwd());
  const outputDir = path.join(root, 'DATA', 'runtime', 'revenue', 'acceptance');
  const output = path.join(outputDir, 'revenue_acceptance_sprint_latest.json');

  console.log('============================================================');
  console.log('MILES P2GC REVENUE ACCEPTANCE SPRINT - SAFE READ-ONLY BATCH');
  console.log('============================================================');
  console.log(`Placement test: ${testId}`);
  console.log(`Parallel audits: ${SAFE_AUDITS.length}`);
  console.log(`Audit child timeout: ${Math.round(AUDIT_TIMEOUT_MS / 60000)}m`);
  console.log(`Placement poll: ${Math.round(POLL_MS / 1000)}s, max wait ${Math.round(MAX_WAIT_MS / 60000)}m`);
  console.log(`Placement completeness gate: >=${MIN_ANALYTICS_ROWS} rows, >=${MIN_SENDER_EVIDENCE} senders, ${REQUIRED_STABLE_POLLS} stable polls`);
  console.log(`Placement plateau gate: >=${MIN_PLATEAU_ROWS} rows, >=${MIN_SENDER_EVIDENCE} senders, ${REQUIRED_PLATEAU_POLLS} unchanged polls; plateau never overrides AUTH WATCH`);

  const auditPromise = Promise.all(SAFE_AUDITS.map((args, i) => runNode(args, `AUDIT-${i + 1}`)));
  const placementPromise = pollPlacement(testId);
  const [audits, placement] = await Promise.all([auditPromise, placementPromise]);

  const failedAudits = audits.filter(x => x.code !== 0);
  const timedOutAudits = audits.filter(x => x.timedOut);
  const authWatchOpen = placement.authWatchSenders.length > 0;
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'SAFE_READ_ONLY_BATCH',
    testId,
    audits,
    failedAuditCount: failedAudits.length,
    timedOutAuditCount: timedOutAudits.length,
    placement,
    placementCompletenessGate: {
      minAnalyticsRows: MIN_ANALYTICS_ROWS,
      minSenderEvidence: MIN_SENDER_EVIDENCE,
      requiredStablePolls: REQUIRED_STABLE_POLLS,
      minPlateauRows: MIN_PLATEAU_ROWS,
      requiredPlateauPolls: REQUIRED_PLATEAU_POLLS
    },
    constraints: {
      sendsRealProspects: false,
      deletesEmail: false,
      publishesB12: false,
      changesDNS: false,
      startsSoak: false
    },
    truth: placement.ready
      ? (authWatchOpen ? 'POST_DMARC_PLACEMENT_STABLE_WITH_AUTH_WATCH' : 'POST_DMARC_PLACEMENT_STABLE')
      : 'POST_DMARC_PLACEMENT_EVIDENCE_INCOMPLETE',
    result: placement.ready && !authWatchOpen && failedAudits.length === 0
      ? 'REVENUE_ACCEPTANCE_SPRINT_EVIDENCE_READY'
      : 'REVENUE_ACCEPTANCE_SPRINT_COMPLETED_WITH_OPEN_ITEMS'
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));

  console.log('============================================================');
  console.log(`Safe audits complete: ${audits.length}`);
  console.log(`Audit nonzero exits: ${failedAudits.length}`);
  console.log(`Audit timeouts: ${timedOutAudits.length}`);
  console.log(`Placement evidence stable: ${placement.ready ? 'YES' : 'NO'}`);
  console.log(`Placement evidence basis: ${placement.evidenceBasis}`);
  console.log(`Placement rows: ${placement.rows}`);
  console.log(`Placement senders: ${placement.senders}`);
  console.log(`Placement AUTH WATCH: ${placement.authWatchSenders.length ? placement.authWatchSenders.join(', ') : 'NONE'}`);
  console.log(`Report: ${output}`);
  console.log(`RESULT: ${report.result}`);
  if (!placement.ready || authWatchOpen || failedAudits.length) process.exitCode = 2;
}

if (require.main === module) main().catch(err => {
  console.error(err.stack || err);
  console.log('RESULT: REVENUE_ACCEPTANCE_SPRINT_RED');
  process.exitCode = 1;
});

module.exports = {
  SAFE_AUDITS,
  DEFAULT_TEST_ID,
  AUDIT_TIMEOUT_MS,
  MIN_ANALYTICS_ROWS,
  MIN_SENDER_EVIDENCE,
  REQUIRED_STABLE_POLLS,
  MIN_PLATEAU_ROWS,
  REQUIRED_PLATEAU_POLLS,
  runNode,
  parsePlacement,
  placementFingerprint
};
