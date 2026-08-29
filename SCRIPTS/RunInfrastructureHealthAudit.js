'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const InfrastructureHealthAuditService = require('../SERVICES/runtime/InfrastructureHealthAuditService');

function runApprovalDashboardDiagnostic(root) {
  if (process.platform !== 'win32') {
    return { ok: true, skipped: true, reason: 'WINDOWS_ONLY_DIAGNOSTIC' };
  }

  const script = path.join(root, 'SCRIPTS', 'DiagnoseCanonicalApprovalDashboardWindows.ps1');
  const execution = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Root', root],
    { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000 }
  );

  let parsed = null;
  try { parsed = JSON.parse(String(execution.stdout || '').trim()); } catch {}

  return {
    ok: execution.status === 0 && parsed?.ok === true,
    exitCode: execution.status,
    signal: execution.signal || null,
    error: execution.error ? execution.error.message : null,
    result: parsed,
    stdout: parsed ? undefined : String(execution.stdout || '').slice(-16000),
    stderr: String(execution.stderr || '').slice(-8000)
  };
}

function runCeoDashboardBackendTrace(root) {
  const script = path.join(root, 'SCRIPTS', 'TraceCeoDashboardBackend.js');
  const execution = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000
  });
  let parsed = null;
  try { parsed = JSON.parse(String(execution.stdout || '').trim()); } catch {}
  return {
    ok: execution.status === 0 && parsed?.ok === true,
    exitCode: execution.status,
    signal: execution.signal || null,
    error: execution.error ? execution.error.message : null,
    result: parsed,
    stdout: parsed ? undefined : String(execution.stdout || '').slice(-16000),
    stderr: String(execution.stderr || '').slice(-8000)
  };
}

async function main() {
  const root = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..'));

  const approvalDashboardDiagnostic = runApprovalDashboardDiagnostic(root);
  const ceoDashboardBackendTrace = runCeoDashboardBackendTrace(root);

  const audit = new InfrastructureHealthAuditService({ root, intervalHours: 72 });
  const dueBefore = audit.due();
  let result = null;
  let auditError = null;
  try {
    result = await audit.run();
  } catch (error) {
    auditError = { message: error.message, stack: error.stack || null };
  }
  const dueAfter = audit.due();

  const auditOk = result?.ok === true;
  const proof = {
    ok: auditOk && approvalDashboardDiagnostic.ok === true && ceoDashboardBackendTrace.ok === true,
    service: 'MILES_INFRASTRUCTURE_HEALTH_AUDIT_PROOF',
    mode: 'FORCED_READ_ONLY_PROOF',
    intervalHours: 72,
    dueBefore,
    dueAfter,
    observedAt: result?.observedAt || new Date().toISOString(),
    result,
    auditError,
    approvalDashboardDiagnostic,
    ceoDashboardBackendTrace,
    safety: {
      arbitraryShell: false,
      destructiveActionsPerformed: false,
      providerMutation: false,
      sendsProspects: false,
      deletesEmail: false,
      changesDns: false,
      publishesB12: false,
      approvalDashboardDiagnosticReadOnly: true,
      ceoDashboardBackendTraceReadOnly: true
    }
  };

  console.log('MILES_INFRASTRUCTURE_HEALTH_AUDIT_PROOF');
  console.log(JSON.stringify(proof, null, 2));
  process.exitCode = proof.ok ? 0 : 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error('MILES_INFRASTRUCTURE_HEALTH_AUDIT_PROOF_RED');
    console.error(error.stack || error.message);
    process.exitCode = 2;
  });
}

module.exports = { main, runApprovalDashboardDiagnostic, runCeoDashboardBackendTrace };
