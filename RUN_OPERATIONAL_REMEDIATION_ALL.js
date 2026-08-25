'use strict';

const fs = require('fs');
const path = require('path');
const IonosInboxCleanupService = require('./SERVICES/revenue/IonosInboxCleanupService');
const InstantlyLifecycleReconciler = require('./SERVICES/revenue/InstantlyLifecycleReconciler');

function arg(name) { return process.argv.includes(name); }

async function main() {
  const root = path.resolve(process.env.MILES_ROOT || process.cwd());
  const execute = arg('--execute');
  const startedAt = new Date().toISOString();
  const results = {};
  const errors = [];

  const jobs = [
    ['ionosInboxCleanup', async () => new IonosInboxCleanupService({ root }).run({ execute })],
    ['instantlyLifecycleReconciliation', async () => new InstantlyLifecycleReconciler({ root }).run({ execute })]
  ];

  // Governing rule: do not stop after the first subsystem defect. Run every independent remediation lane.
  for (const [name, job] of jobs) {
    try {
      results[name] = await job();
    } catch (error) {
      results[name] = { ok: false, error: error.message };
      errors.push({ subsystem: name, error: error.message });
    }
  }

  const summary = {
    ok: errors.length === 0 && Object.values(results).every(x => x?.ok === true),
    service: 'P2GC_OPERATIONAL_REMEDIATION_ALL',
    mode: execute ? 'EXECUTE' : 'PLAN_ONLY',
    startedAt,
    completedAt: new Date().toISOString(),
    results,
    errors,
    governingRule: 'FULL_RELATED_SYSTEM_SWEEP_BEFORE_CLOSEOUT',
    safety: {
      ionosDeletesMessages: false,
      instantlyDeletesEmails: false,
      instantlyDeletesLeads: false,
      b12PublicPublishIncludedHere: false
    }
  };

  const out = path.join(root, 'DATA', 'operational_acceptance', 'combined_remediation', 'latest.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(summary, null, 2), 'utf8');
  summary.outputFile = out;
  console.log(JSON.stringify(summary, null, 2));
  console.log(summary.ok ? 'OPERATIONAL_REMEDIATION_CORE_GREEN' : 'OPERATIONAL_REMEDIATION_CORE_PARTIAL');
  process.exitCode = summary.ok ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 2;
});
