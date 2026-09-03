'use strict';

const { execFileSync, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REQUIRED_PM2_APPS = [
  'miles-worker',
  'miles-autonomous-coo',
  'miles-command-center',
  'p2gc-growth-demo'
];
const REMOTE_BRIDGE_SUPERVISED = ['1', 'true', 'yes', 'y', 'on']
  .includes(String(process.env.MILES_BRIDGE_SUPERVISED || '').trim().toLowerCase());
const AUTONOMOUS_RESTART_DELAY_MS = Math.max(
  15000,
  Number(process.env.MILES_COO_DEPLOY_AUTONOMOUS_RESTART_DELAY_MS || 20000)
);

function fail(message, details = null) {
  console.error(`COO_CONSOLIDATED_DEPLOY_RED: ${message}`);
  if (details) console.error(details);
  process.exit(2);
}

function verifySourceMarkers() {
  const checks = [
    ['SERVICES/SelfMaintenanceService.js', [
      'auditRuntimeApprovals()',
      'reconcileRuntimeApprovals()',
      'approvalsGranted: 0',
      'tasksResumed: 0',
      'tasksDeleted: 0'
    ]],
    ['SERVICES/governance/PolicyEngineService.js', [
      'GOVERNED_SELF_MAINTENANCE',
      'isGovernedSelfMaintenance'
    ]],
    ['SERVICES/CommandIntentPlannerService.js', [
      'SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS',
      'SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS'
    ]],
    ['SERVICES/CapabilityDispatcherService.js', [
      'SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS',
      'SelfMaintenanceService'
    ]],
    ['SERVICES/digital_coo/MilesCommandCenter.js', [
      'policy.evaluated === false',
      'function reconcileRuntimeApprovals()'
    ]]
  ];

  for (const [rel, markers] of checks) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) fail(`Missing consolidated source: ${rel}`);
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    for (const marker of markers) {
      if (!text.includes(marker)) fail(`Required consolidated marker missing from ${rel}: ${marker}`);
    }
  }
}

function powershellExe() {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

function listenerPid(port = 8787) {
  const script = [
    `$c = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    'if (-not $c) { exit 3 }',
    '[Console]::Out.Write($c.OwningProcess)'
  ].join('; ');
  try {
    const raw = execFileSync(powershellExe(), ['-NoProfile', '-NonInteractive', '-Command', script], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function runPm2(args, options = {}) {
  const baseOptions = {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    ...options
  };
  if (process.platform === 'win32') {
    const shell = process.env.ComSpec || 'cmd.exe';
    return execFileSync(shell, ['/d', '/s', '/c', 'pm2.cmd', ...args], baseOptions);
  }
  return execFileSync('pm2', args, baseOptions);
}

function pm2List() {
  const raw = runPm2(['jlist'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('PM2 did not return an application list.');
  return list;
}

function pm2Name(item) {
  return String(item?.name || item?.pm2_env?.name || '').trim();
}

function pm2Selector(item) {
  const name = pm2Name(item);
  const selector = item?.pm_id != null ? String(item.pm_id) : name;
  if (!selector) fail(`Could not determine PM2 selector for ${name || 'unknown app'}.`);
  return selector;
}

function verifyRuntimeOwners(list, portPid) {
  const byName = new Map(list.map(item => [pm2Name(item), item]));
  for (const name of REQUIRED_PM2_APPS) {
    const item = byName.get(name);
    if (!item) fail(`Required PM2 application not found: ${name}`);
    const status = String(item?.pm2_env?.status || '').toLowerCase();
    if (status !== 'online') fail(`Required PM2 application is not online: ${name} (${status || 'unknown'})`);
  }

  const owner = list.find(item => Number(item?.pid) === Number(portPid));
  if (!owner) fail(`Port 8787 PID ${portPid} is not PM2-managed; refusing to alter an unknown process.`);
  if (pm2Name(owner) !== 'miles-command-center') {
    fail(`Port 8787 owner is ${pm2Name(owner) || 'unknown'}, expected miles-command-center.`);
  }
  return byName;
}

function restartKnownApp(item) {
  const name = pm2Name(item);
  const selector = pm2Selector(item);
  console.log(`RESTARTING_PM2_APP=${name}`);
  runPm2(['restart', selector, '--update-env'], { stdio: 'inherit' });
}

function scheduleDelayedRestart(item, delayMs = AUTONOMOUS_RESTART_DELAY_MS) {
  const name = pm2Name(item);
  const selector = pm2Selector(item);
  const delay = Math.max(15000, Number(delayMs || AUTONOMOUS_RESTART_DELAY_MS));
  const code = [
    "const { execFileSync } = require('child_process');",
    `setTimeout(() => {`,
    `  try {`,
    `    const shell = process.env.ComSpec || 'cmd.exe';`,
    `    execFileSync(shell, ['/d','/s','/c','pm2.cmd','restart',${JSON.stringify(selector)},'--update-env'], { cwd: ${JSON.stringify(ROOT)}, windowsHide: true, stdio: 'ignore' });`,
    `    process.exit(0);`,
    `  } catch { process.exit(2); }`,
    `}, ${delay});`
  ].join('\n');

  const child = spawn(process.execPath, ['-e', code], {
    cwd: ROOT,
    env: process.env,
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  });
  child.unref();
  console.log(`SCHEDULED_PM2_RESTART=${name}`);
  console.log(`SCHEDULED_PM2_RESTART_DELAY_MS=${delay}`);
  return { name, selector, pid: child.pid, delayMs: delay };
}

function getJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (error) { reject(new Error(`Invalid JSON from ${url}: ${error.message}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function waitForDashboard() {
  const deadline = Date.now() + 45000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const dashboard = await getJson('http://127.0.0.1:8787/api/dashboard');
      if (dashboard?.ok === true) return dashboard;
      lastError = new Error(`Dashboard returned ok=${dashboard?.ok}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw lastError || new Error('Command Center did not recover within 45 seconds.');
}

async function waitForGrowthDemo() {
  const deadline = Date.now() + 45000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await getJson('http://127.0.0.1:8791/api/health');
      const capabilities = Array.isArray(health?.capabilities) ? health.capabilities : [];
      if (health?.ok === true && health?.service === 'P2GC_EXECUTIVE_GROWTH_BLUEPRINT_DEMO' && capabilities.includes('truth_reconciliation')) {
        return health;
      }
      lastError = new Error(`Growth demo health did not prove current canonical runtime: ok=${health?.ok}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw lastError || new Error('P2GC growth demo did not recover within 45 seconds.');
}

function approvalCount(operations) {
  const pending = new Set(['AWAITING_APPROVAL', 'AWAITING_CEO_APPROVAL', 'WAITING_FOR_CEO_APPROVAL']);
  return Array.isArray(operations)
    ? operations.filter(item => pending.has(String(item?.status || '').toUpperCase())).length
    : null;
}

async function main() {
  if (process.platform !== 'win32') fail('This deployment helper is intended for the Windows MILES production host only.');
  verifySourceMarkers();

  const beforePid = listenerPid(8787);
  if (!beforePid) fail('No listener found on port 8787; refusing to guess at runtime ownership.');

  let list;
  try { list = pm2List(); }
  catch (error) { fail('Could not read PM2 state before maintenance.', error.message); }
  const byName = verifyRuntimeOwners(list, beforePid);

  let maintenance;
  try {
    const selfMaintenance = require('../SERVICES/SelfMaintenanceService');
    maintenance = selfMaintenance.run({
      action: 'SELF_MAINTENANCE',
      provider: 'MILES',
      system: 'MILES',
      payload: {
        provider: 'MILES',
        system: 'MILES',
        action: 'SELF_MAINTENANCE',
        capability: 'SELF_MAINTENANCE',
        objective: 'Deploy consolidated COO self-maintenance repair and reconcile only proven stale runtime approvals.'
      }
    });
  } catch (error) {
    fail('MILES self-maintenance execution failed before restart.', error.stack || error.message);
  }

  const safety = maintenance?.approvalReconciliation?.safety || {};
  if (
    Number(safety.approvalsGranted || 0) !== 0 ||
    Number(safety.tasksResumed || 0) !== 0 ||
    Number(safety.tasksDeleted || 0) !== 0
  ) {
    fail('Self-maintenance reported an unsafe runtime mutation.');
  }

  // Reload all independently served production surfaces that consume deployed code.
  // In bridge-supervised mode the autonomous COO itself is restarted by its owner
  // only after remote completion evidence is persisted, avoiding directive replay.
  restartKnownApp(byName.get('miles-worker'));
  if (!REMOTE_BRIDGE_SUPERVISED) {
    restartKnownApp(byName.get('miles-autonomous-coo'));
  }
  restartKnownApp(byName.get('miles-command-center'));
  restartKnownApp(byName.get('p2gc-growth-demo'));

  const [dashboard, growthDemoHealth] = await Promise.all([
    waitForDashboard(),
    waitForGrowthDemo()
  ]);
  const afterPid = listenerPid(8787);

  const autonomousRestart = REMOTE_BRIDGE_SUPERVISED
    ? { mode: 'SUPERVISOR_AFTER_REMOTE_EVIDENCE' }
    : { mode: 'IMMEDIATE' };

  console.log(`RUNTIME_APPROVALS_AUDITED=${maintenance?.approvalAudit?.total ?? 'UNKNOWN'}`);
  console.log(`RUNTIME_APPROVALS_RECONCILED=${maintenance?.approvalReconciliation?.reconciledCount ?? 'UNKNOWN'}`);
  console.log(`RUNTIME_APPROVALS_UNTOUCHED=${maintenance?.approvalReconciliation?.untouchedCount ?? 'UNKNOWN'}`);
  console.log(`CANONICAL_APPROVALS_AFTER=${approvalCount(dashboard.operations) ?? 'UNKNOWN'}`);
  console.log(`WORKER_RUNTIME_AWAITING_APPROVAL_AFTER=${dashboard.taskQueue?.awaitingApproval ?? 'UNKNOWN'}`);
  console.log(`P2GC_GROWTH_DEMO_HEALTH_AFTER=${growthDemoHealth?.ok === true ? 'GREEN' : 'RED'}`);
  console.log(`P2GC_GROWTH_DEMO_SERVICE_AFTER=${growthDemoHealth?.service || 'UNKNOWN'}`);
  console.log(`PORT_8787_PID_BEFORE=${beforePid}`);
  console.log(`PORT_8787_PID_AFTER=${afterPid || 'UNKNOWN'}`);
  console.log(`REMOTE_BRIDGE_SUPERVISED=${REMOTE_BRIDGE_SUPERVISED}`);
  console.log(`AUTONOMOUS_COO_RESTART_MODE=${autonomousRestart.mode}`);
  console.log('APPROVALS_GRANTED_BY_MAINTENANCE=0');
  console.log('TASKS_RESUMED_BY_MAINTENANCE=0');
  console.log('TASKS_DELETED_BY_MAINTENANCE=0');
  console.log('COO_CONSOLIDATED_DEPLOY_GREEN');
}

main().catch(error => fail(error.message, error.stack));
