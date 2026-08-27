'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const InfrastructureHealthAuditService = require('../SERVICES/runtime/InfrastructureHealthAuditService');

const ROOT = path.resolve(process.env.MILES_ROOT || process.cwd());
const OUTPUT = path.join(ROOT, 'DATA', 'runtime', 'revenue', 'governed_completion', 'latest.json');
const DEFAULT_TIMEOUT_MS = Math.max(60000, Number(process.env.MILES_COMPLETION_STEP_TIMEOUT_MS || 600000));

function tail(value, max) {
  const text = String(value || '');
  return text.length <= max ? text : text.slice(-max);
}

function runNodeStep(name, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise(resolve => {
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      shell: false,
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch {}
      resolve({ name, ok: false, exitCode: -2, timedOut: true, startedAt, finishedAt: new Date().toISOString(), stdoutTail: tail(stdout, 12000), stderrTail: tail(stderr, 6000) });
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ name, ok: false, exitCode: -1, timedOut: false, startedAt, finishedAt: new Date().toISOString(), stdoutTail: tail(stdout, 12000), stderrTail: tail(`${stderr}\n${error.message}`, 6000) });
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ name, ok: code === 0, exitCode: code, timedOut: false, startedAt, finishedAt: new Date().toISOString(), stdoutTail: tail(stdout, 12000), stderrTail: tail(stderr, 6000) });
    });
  });
}

function persist(result) {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2), 'utf8');
  return OUTPUT;
}

async function main() {
  const startedAt = new Date().toISOString();
  const steps = [];
  const orderedMutationSteps = [
    ['IONOS_ALL_FOLDER_PLAN', ['SCRIPTS/RunIonosInboxCleanup.js']],
    ['IONOS_ALL_FOLDER_EXECUTE', ['SCRIPTS/RunIonosInboxCleanup.js', '--execute']],
    ['IONOS_ALL_FOLDER_POST_VERIFY', ['SCRIPTS/RunIonosInboxCleanup.js']],
    ['INSTANTLY_LIFECYCLE_PLAN', ['SCRIPTS/RunInstantlyLifecycleProof.js']],
    ['INSTANTLY_LIFECYCLE_EXECUTE', ['SCRIPTS/RunInstantlyLifecycleProof.js', '--execute']],
    ['INSTANTLY_LIFECYCLE_POST_VERIFY', ['SCRIPTS/RunInstantlyLifecycleProof.js']]
  ];

  for (const [name, args] of orderedMutationSteps) {
    const step = await runNodeStep(name, args);
    steps.push(step);
    if (!step.ok) {
      const result = {
        ok: false,
        status: 'MUTATION_SEQUENCE_FAILED_CLOSED',
        startedAt,
        finishedAt: new Date().toISOString(),
        failedStep: name,
        steps,
        safety: {
          sendsProspectMessages: false,
          deletesEmails: false,
          deletesLeads: false,
          mutatesDns: false,
          publishesB12: false,
          ionosUidMoveOnly: true,
          providerPostReadRequired: true,
          orionFreshnessCannotBeFabricated: true
        }
      };
      result.outputFile = persist(result);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 2;
      return;
    }
  }

  const auditSteps = [
    ['INBOX_PLACEMENT_AUDIT', ['SCRIPTS/AuditInstantlyInboxPlacement.js', '--test-id', '01a040ce-dbf7-7872-8938-f1501647af92']],
    ['PRODUCTION_TRUTH_RECONCILIATION', ['SCRIPTS/ReconcileProductionTruth.js']],
    ['REVENUE_ACCEPTANCE_SPRINT', ['SCRIPTS/RunRevenueAcceptanceSprint.js']]
  ];
  for (const [name, args] of auditSteps) steps.push(await runNodeStep(name, args));

  let infrastructure;
  try {
    const audit = new InfrastructureHealthAuditService({ root: ROOT, intervalHours: 72 });
    infrastructure = await audit.run();
  } catch (error) {
    infrastructure = { ok: false, error: error.message };
  }

  const failedAudits = steps.filter(step => !step.ok).map(step => step.name);
  const ok = failedAudits.length === 0 && infrastructure?.ok === true;
  const result = {
    ok,
    status: ok ? 'GOVERNED_REVENUE_COMPLETION_GREEN' : 'GOVERNED_REVENUE_COMPLETION_BLOCKED',
    startedAt,
    finishedAt: new Date().toISOString(),
    failedAudits,
    steps,
    infrastructure,
    safety: {
      sendsProspectMessages: false,
      deletesEmails: false,
      deletesLeads: false,
      mutatesDns: false,
      publishesB12: false,
      ionosUidMoveOnly: true,
      providerPostReadRequired: true,
      orionFreshnessCannotBeFabricated: true
    }
  };
  result.outputFile = persist(result);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = ok ? 0 : 2;
}

if (require.main === module) main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

module.exports = { runNodeStep, tail };
