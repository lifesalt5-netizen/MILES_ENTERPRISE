'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TEST_ID = '01a040ce-dbf7-7872-8938-f1501647af92';
const POLL_MS = Number(process.env.MILES_PLACEMENT_POLL_MS || 90000);
const MAX_WAIT_MS = Number(process.env.MILES_PLACEMENT_MAX_WAIT_MS || 30 * 60 * 1000);
const MIN_ANALYTICS_ROWS = Number(process.env.MILES_PLACEMENT_MIN_ANALYTICS_ROWS || 27);
const MIN_SENDER_EVIDENCE = Number(process.env.MILES_PLACEMENT_MIN_SENDER_EVIDENCE || 9);
const REQUIRED_STABLE_POLLS = Number(process.env.MILES_PLACEMENT_REQUIRED_STABLE_POLLS || 2);

const SAFE_AUDITS = [
  ['SCRIPTS/AUDIT_MILES_REVENUE_OPERATIONS.js'],
  ['SCRIPTS/AUDIT_MILES_MEETING_PIPELINE.js'],
  ['SCRIPTS/AUDIT_MILES_CALENDLY_PIPELINE.js'],
  ['SCRIPTS/AUDIT_OUTBOUND_SENDER_CAPACITY_V2.js'],
  ['SCRIPTS/AUDIT_OUTREACH_DOMAIN_DNS_READONLY.js'],
  ['SCRIPTS/AuditInstantlySendWindowHistory.js'],
  ['SCRIPTS/AuditUnified8787ScreenAcceptance.js'],
  ['SCRIPTS/AuditOrionRebuildReadiness.js'],
  ['SCRIPTS/QualifyRepositoryRisks.js'],
  ['SCRIPTS/ReconcileProductionTruth.js']
];

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function runNode(args, label) {
  return new Promise(resolve => {
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { const s = d.toString(); stdout += s; process.stdout.write(`[${label}] ${s}`); });
    child.stderr.on('data', d => { const s = d.toString(); stderr += s; process.stderr.write(`[${label}] ${s}`); });
    child.on('close', code => resolve({ label, args, startedAt, finishedAt: new Date().toISOString(), code, stdout, stderr }));
    child.on('error', err => resolve({ label, args, startedAt, finishedAt: new Date().toISOString(), code: -1, stdout, stderr: `${stderr}\n${err.message}` }));
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

async function pollPlacement(testId) {
  const started = Date.now();
  const attempts = [];
  let previousQualifiedRows = null;
  let stablePolls = 0;
  let latest = { rows: 0, senders: 0, authWatchSenders: [] };

  while (Date.now() - started <= MAX_WAIT_MS) {
    const result = await runNode(['SCRIPTS/AuditInstantlyInboxPlacement.js', '--test-id', testId], 'PLACEMENT');
    latest = parsePlacement(result.stdout);
    attempts.push({ ...result, parsed: latest });

    const materiallyPopulated = latest.rows >= MIN_ANALYTICS_ROWS && latest.senders >= MIN_SENDER_EVIDENCE;
    if (materiallyPopulated) {
      if (previousQualifiedRows === latest.rows) stablePolls += 1;
      else stablePolls = 1;
      previousQualifiedRows = latest.rows;
      if (stablePolls >= REQUIRED_STABLE_POLLS) {
        return {
          ready: true,
          stable: true,
          rows: latest.rows,
          senders: latest.senders,
          authWatchSenders: latest.authWatchSenders,
          stablePolls,
          attempts
        };
      }
    } else {
      stablePolls = 0;
      previousQualifiedRows = null;
    }

    if (Date.now() - started + POLL_MS > MAX_WAIT_MS) break;
    console.log(`[PLACEMENT] evidence incomplete: rows=${latest.rows}/${MIN_ANALYTICS_ROWS}, senders=${latest.senders}/${MIN_SENDER_EVIDENCE}, stable=${stablePolls}/${REQUIRED_STABLE_POLLS}; retrying in ${Math.round(POLL_MS / 1000)}s`);
    await sleep(POLL_MS);
  }

  return {
    ready: false,
    stable: false,
    rows: latest.rows,
    senders: latest.senders,
    authWatchSenders: latest.authWatchSenders,
    stablePolls,
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
  console.log(`Placement poll: ${Math.round(POLL_MS / 1000)}s, max wait ${Math.round(MAX_WAIT_MS / 60000)}m`);
  console.log(`Placement completeness gate: >=${MIN_ANALYTICS_ROWS} rows, >=${MIN_SENDER_EVIDENCE} senders, ${REQUIRED_STABLE_POLLS} stable polls`);

  const auditPromise = Promise.all(SAFE_AUDITS.map((args, i) => runNode(args, `AUDIT-${i + 1}`)));
  const placementPromise = pollPlacement(testId);
  const [audits, placement] = await Promise.all([auditPromise, placementPromise]);

  const failedAudits = audits.filter(x => x.code !== 0);
  const authWatchOpen = placement.authWatchSenders.length > 0;
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'SAFE_READ_ONLY_BATCH',
    testId,
    audits,
    failedAuditCount: failedAudits.length,
    placement,
    placementCompletenessGate: {
      minAnalyticsRows: MIN_ANALYTICS_ROWS,
      minSenderEvidence: MIN_SENDER_EVIDENCE,
      requiredStablePolls: REQUIRED_STABLE_POLLS
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
  console.log(`Placement evidence stable: ${placement.ready ? 'YES' : 'NO'}`);
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
  MIN_ANALYTICS_ROWS,
  MIN_SENDER_EVIDENCE,
  REQUIRED_STABLE_POLLS,
  parsePlacement
};
