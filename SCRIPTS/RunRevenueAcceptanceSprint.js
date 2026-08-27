'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TEST_ID = '01a040ce-dbf7-7872-8938-f1501647af92';
const POLL_MS = Number(process.env.MILES_PLACEMENT_POLL_MS || 90000);
const MAX_WAIT_MS = Number(process.env.MILES_PLACEMENT_MAX_WAIT_MS || 30 * 60 * 1000);

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

async function pollPlacement(testId) {
  const started = Date.now();
  const attempts = [];
  while (Date.now() - started <= MAX_WAIT_MS) {
    const result = await runNode(['SCRIPTS/AuditInstantlyInboxPlacement.js', '--test-id', testId], 'PLACEMENT');
    attempts.push(result);
    const match = result.stdout.match(/Analytics rows:\s*(\d+)/i);
    const rows = match ? Number(match[1]) : 0;
    if (rows > 0) return { ready: true, rows, attempts };
    if (Date.now() - started + POLL_MS > MAX_WAIT_MS) break;
    console.log(`[PLACEMENT] analytics not ready; retrying in ${Math.round(POLL_MS / 1000)}s`);
    await sleep(POLL_MS);
  }
  return { ready: false, rows: 0, attempts };
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

  const auditPromise = Promise.all(SAFE_AUDITS.map((args, i) => runNode(args, `AUDIT-${i + 1}`)));
  const placementPromise = pollPlacement(testId);
  const [audits, placement] = await Promise.all([auditPromise, placementPromise]);

  const failedAudits = audits.filter(x => x.code !== 0);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'SAFE_READ_ONLY_BATCH',
    testId,
    audits,
    failedAuditCount: failedAudits.length,
    placement,
    constraints: {
      sendsRealProspects: false,
      deletesEmail: false,
      publishesB12: false,
      changesDNS: false,
      startsSoak: false
    },
    truth: placement.ready ? 'POST_DMARC_PLACEMENT_ANALYTICS_AVAILABLE' : 'POST_DMARC_PLACEMENT_ANALYTICS_PENDING',
    result: placement.ready && failedAudits.length === 0 ? 'REVENUE_ACCEPTANCE_SPRINT_EVIDENCE_READY' : 'REVENUE_ACCEPTANCE_SPRINT_COMPLETED_WITH_OPEN_ITEMS'
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));

  console.log('============================================================');
  console.log(`Safe audits complete: ${audits.length}`);
  console.log(`Audit nonzero exits: ${failedAudits.length}`);
  console.log(`Placement analytics ready: ${placement.ready ? 'YES' : 'NO'}`);
  console.log(`Report: ${output}`);
  console.log(`RESULT: ${report.result}`);
  if (!placement.ready || failedAudits.length) process.exitCode = 2;
}

if (require.main === module) main().catch(err => {
  console.error(err.stack || err);
  console.log('RESULT: REVENUE_ACCEPTANCE_SPRINT_RED');
  process.exitCode = 1;
});

module.exports = { SAFE_AUDITS, DEFAULT_TEST_ID };
