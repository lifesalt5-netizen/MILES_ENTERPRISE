'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const InfrastructureHealthAuditService = require('../SERVICES/runtime/InfrastructureHealthAuditService');

function runApprovalDashboardDiagnostic(root) {
  if (process.platform !== 'win32') return { ok: true, skipped: true, reason: 'WINDOWS_ONLY_DIAGNOSTIC' };
  const script = path.join(root, 'SCRIPTS', 'DiagnoseCanonicalApprovalDashboardWindows.ps1');
  const execution = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Root',root], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  let parsed = null;
  try { parsed = JSON.parse(String(execution.stdout || '').trim()); } catch {}
  return { ok: execution.status === 0 && parsed?.ok === true, exitCode: execution.status, signal: execution.signal || null, error: execution.error ? execution.error.message : null, result: parsed, stdout: parsed ? undefined : String(execution.stdout || '').slice(-16000), stderr: String(execution.stderr || '').slice(-8000) };
}

function runCeoDashboardBackendTrace(root) {
  const script = path.join(root, 'SCRIPTS', 'TraceCeoDashboardBackend.js');
  const execution = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  let parsed = null;
  try { parsed = JSON.parse(String(execution.stdout || '').trim()); } catch {}
  return { ok: execution.status === 0 && parsed?.ok === true, exitCode: execution.status, signal: execution.signal || null, error: execution.error ? execution.error.message : null, result: parsed, stdout: parsed ? undefined : String(execution.stdout || '').slice(-16000), stderr: String(execution.stderr || '').slice(-8000) };
}

function runCeoApprovalAcceptance(root) {
  const script = path.join(root, 'SCRIPTS', 'RunCeoApprovalControlAcceptance.js');
  const execution = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 45000 });
  const stdout = String(execution.stdout || '');
  const jsonStart = stdout.indexOf('{');
  let parsed = null;
  if (jsonStart >= 0) {
    try { parsed = JSON.parse(stdout.slice(jsonStart)); } catch {}
  }
  return {
    ok: execution.status === 0 && parsed?.ok === true,
    exitCode: execution.status,
    error: execution.error ? execution.error.message : null,
    proof: parsed,
    stdout: parsed ? null : stdout.slice(-12000),
    stderr: String(execution.stderr || '').slice(-4000)
  };
}

function pm2List(root) {
  try {
    const shell = process.env.ComSpec || 'cmd.exe';
    const raw = spawnSync(shell, ['/d','/s','/c','pm2','jlist'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    if (raw.status !== 0) return { ok:false, error:String(raw.stderr || '').trim() || `PM2_JLIST_EXIT_${raw.status}` };
    return { ok:true, apps:JSON.parse(String(raw.stdout || '[]')) };
  } catch (error) { return { ok:false, error:error.message }; }
}

function httpJson(port, requestPath, timeoutMs = 10000) {
  return new Promise(resolve => {
    const req = http.get({ hostname:'127.0.0.1', port, path:requestPath, timeout:timeoutMs }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ ok:res.statusCode >= 200 && res.statusCode < 300, statusCode:res.statusCode, json, text:json ? null : text.slice(0,2000) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', error => resolve({ ok:false, error:error.message }));
  });
}

function sourceMtimeMs(root) {
  const files = [
    path.join(root, 'StartUnifiedMilesControlCenter.js'),
    path.join(root, 'SERVICES', 'digital_coo', 'UnifiedMilesGateway.js')
  ];
  return Math.max(...files.map(file => fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0));
}

async function ensureUnifiedControlCenterCurrent(root) {
  if (process.platform !== 'win32') return { ok:true, skipped:true, reason:'WINDOWS_ONLY_CONTROL_CENTER' };
  const list = pm2List(root);
  if (!list.ok) return { ok:false, status:'PM2_LIST_FAILED', error:list.error };
  const app = list.apps.find(item => String(item?.name || item?.pm2_env?.name || '') === 'miles-command-center');
  if (!app) return { ok:false, status:'MILES_COMMAND_CENTER_NOT_FOUND' };
  const uptimeMs = Number(app.pm2_env?.pm_uptime || 0);
  const latestSourceMs = sourceMtimeMs(root);
  const status = String(app.pm2_env?.status || '').toLowerCase();
  const restartRequired = status !== 'online' || !Number.isFinite(uptimeMs) || uptimeMs <= 0 || latestSourceMs > uptimeMs + 1000;

  if (!restartRequired) {
    const health = await httpJson(8787, '/api/health');
    return { ok:health.ok === true, status:'CURRENT_NO_RESTART', restartPerformed:false, pid:app.pid || null, pm2Status:status, processStartedAt:new Date(uptimeMs).toISOString(), latestSourceModifiedAt:new Date(latestSourceMs).toISOString(), health };
  }

  const shell = process.env.ComSpec || 'cmd.exe';
  const restart = spawnSync(shell, ['/d','/s','/c','pm2','restart','miles-command-center','--update-env'], { cwd:root, encoding:'utf8', windowsHide:true, timeout:60000 });
  if (restart.status !== 0) {
    return { ok:false, status:'RESTART_FAILED', restartPerformed:true, exitCode:restart.status, stdout:String(restart.stdout || '').slice(-4000), stderr:String(restart.stderr || '').slice(-4000) };
  }

  let health = null;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    health = await httpJson(8787, '/api/health', 5000);
    if (health.ok) break;
  }
  return { ok:health?.ok === true, status:health?.ok ? 'RESTARTED_AND_HEALTHY' : 'RESTARTED_HEALTH_CHECK_FAILED', restartPerformed:true, previousPid:app.pid || null, processStartedAt:uptimeMs ? new Date(uptimeMs).toISOString() : null, latestSourceModifiedAt:new Date(latestSourceMs).toISOString(), health };
}

async function main() {
  const root = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..'));

  const approvalDashboardDiagnosticBefore = runApprovalDashboardDiagnostic(root);
  const ceoDashboardBackendTraceBefore = runCeoDashboardBackendTrace(root);
  const unifiedControlCenter = await ensureUnifiedControlCenterCurrent(root);
  const approvalDashboardDiagnostic = runApprovalDashboardDiagnostic(root);
  const ceoDashboardBackendTrace = runCeoDashboardBackendTrace(root);

  const audit = new InfrastructureHealthAuditService({ root, intervalHours: 72 });
  const dueBefore = audit.due();
  let result = null;
  let auditError = null;
  try { result = await audit.run(); }
  catch (error) { auditError = { message:error.message, stack:error.stack || null }; }
  const dueAfter = audit.due();

  const acceptance = runCeoApprovalAcceptance(root);
  const auditOk = result?.ok === true;
  const overallOk = auditOk && unifiedControlCenter.ok === true && approvalDashboardDiagnostic.ok === true && ceoDashboardBackendTrace.ok === true && acceptance.ok === true;

  const compact = {
    ok: overallOk,
    service: 'MILES_INFRASTRUCTURE_HEALTH_AUDIT_COMPACT',
    observedAt: result?.observedAt || new Date().toISOString(),
    infrastructureAudit: {
      ok: auditOk,
      error: auditError?.message || null,
      dueBefore: dueBefore?.reason || null,
      dueAfter: dueAfter?.reason || null
    },
    unifiedControlCenter: {
      ok: unifiedControlCenter.ok === true,
      status: unifiedControlCenter.status || null,
      restartPerformed: unifiedControlCenter.restartPerformed === true,
      healthStatus: unifiedControlCenter.health?.json?.status || null,
      service: unifiedControlCenter.health?.json?.service || null
    },
    approvalDashboardDiagnostic: {
      ok: approvalDashboardDiagnostic.ok === true,
      canonicalPendingApprovals: approvalDashboardDiagnostic.result?.api?.canonicalPendingApprovals ?? null,
      workerRuntimeAwaitingApproval: approvalDashboardDiagnostic.result?.api?.workerRuntimeAwaitingApproval ?? null,
      taskQueueSource: approvalDashboardDiagnostic.result?.api?.taskQueueSource || null,
      exactHtmlMatchPaths: approvalDashboardDiagnostic.result?.diagnosis?.exactHtmlMatchPaths || []
    },
    ceoDashboardBackendTrace: {
      ok: ceoDashboardBackendTrace.ok === true,
      stateAwaitingApproval: ceoDashboardBackendTrace.result?.apiState?.workQueue?.awaitingApproval ?? null,
      briefApprovalCount: ceoDashboardBackendTrace.result?.apiBrief?.approvalCount ?? null,
      briefRequiresKevin: ceoDashboardBackendTrace.result?.apiBrief?.requiresKevin ?? null
    },
    ceoApprovalAcceptance: acceptance.proof || {
      ok: false,
      exitCode: acceptance.exitCode,
      error: acceptance.error || null,
      stdout: acceptance.stdout || null,
      stderr: acceptance.stderr || null
    },
    safety: {
      arbitraryShell: false,
      destructiveActionsPerformed: false,
      providerMutation: false,
      sendsProspects: false,
      deletesEmail: false,
      changesDns: false,
      publishesB12: false,
      ceoApprovalAcceptanceNonexistentOperationProbeOnly: true,
      controlPlaneRestartOnlyWhenSourceNewer: true,
      restartTargetAllowlisted: 'miles-command-center'
    }
  };

  console.log('MILES_INFRASTRUCTURE_HEALTH_AUDIT_COMPACT');
  console.log(JSON.stringify(compact, null, 2));
  process.exitCode = overallOk ? 0 : 2;
}

if (require.main === module) main().catch(error => { console.error('MILES_INFRASTRUCTURE_HEALTH_AUDIT_PROOF_RED'); console.error(error.stack || error.message); process.exitCode = 2; });

module.exports = { main, runApprovalDashboardDiagnostic, runCeoDashboardBackendTrace, runCeoApprovalAcceptance, pm2List, httpJson, sourceMtimeMs, ensureUnifiedControlCenterCurrent };