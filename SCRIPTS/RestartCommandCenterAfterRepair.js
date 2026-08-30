'use strict';

const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function fail(message, details = null) {
  console.error(`COMMAND_CENTER_RESTART_RED: ${message}`);
  if (details) console.error(details);
  process.exit(2);
}

function verifyRepairMarkers() {
  const checks = [
    ['SERVICES/digital_coo/MilesCommandCenter.js', ['function reconcileRuntimeApprovals()', 'APPROVED_AND_RESUMED', 'policyEngine.evaluate']],
    ['SERVICES/ceo_dashboard/public/ceo.js', ['/execution?operationId=']],
    ['SERVICES/digital_coo/public/app.js', ['initialOperationId', 'startPolling(initialOperationId)']]
  ];
  for (const [rel, markers] of checks) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) fail(`Missing repaired source: ${rel}`);
    const text = fs.readFileSync(file, 'utf8');
    for (const marker of markers) {
      if (!text.includes(marker)) fail(`Repair marker missing from ${rel}: ${marker}`);
    }
  }
}

function powershellExe() {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

function listenerPid() {
  const script = [
    "$c = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (-not $c) { exit 3 }",
    "[Console]::Out.Write($c.OwningProcess)"
  ].join('; ');
  try {
    const raw = execFileSync(powershellExe(), ['-NoProfile', '-NonInteractive', '-Command', script], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
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
    const commandShell = process.env.ComSpec || 'cmd.exe';
    return execFileSync(commandShell, ['/d', '/s', '/c', 'pm2.cmd', ...args], baseOptions);
  }

  return execFileSync('pm2', args, baseOptions);
}

function pm2List() {
  const raw = runPm2(['jlist'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) fail('PM2 did not return an application list.');
  return list;
}

function findCommandCenterOwner(pid, list) {
  if (!pid) return null;
  return list.find(item => Number(item?.pid) === Number(pid)) || null;
}

function restartOwner(owner) {
  const env = owner.pm2_env || {};
  const status = String(env.status || '').toLowerCase();
  if (status !== 'online') fail(`Port 8787 owner is managed by PM2 but is not online (${status || 'unknown'}).`);
  const selector = owner.pm_id != null ? String(owner.pm_id) : String(owner.name || env.name || '');
  if (!selector) fail('Could not identify the PM2 selector for port 8787 owner.');
  const name = owner.name || env.name || selector;
  console.log(`RESTARTING_PM2_OWNER=${name}`);
  runPm2(['restart', selector, '--update-env'], {
    stdio: 'inherit'
  });
  return name;
}

function getJson(url, timeoutMs = 15000) {
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

async function waitForCommandCenter() {
  const deadline = Date.now() + 30000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const dashboard = await getJson('http://127.0.0.1:8787/api/dashboard', 5000);
      if (dashboard && dashboard.ok === true) return dashboard;
      lastError = new Error(`Dashboard returned ok=${dashboard?.ok}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw lastError || new Error('Command Center did not return healthy dashboard data.');
}

async function main() {
  if (process.platform !== 'win32') fail('This deployment helper is intended for the Windows production host only.');
  verifyRepairMarkers();

  const beforePid = listenerPid();
  if (!beforePid) fail('No listener found on 127.0.0.1:8787. Start the canonical MILES control surface before using this helper.');

  let list;
  try { list = pm2List(); }
  catch (error) { fail('Could not read PM2 process state.', error.message); }

  const owner = findCommandCenterOwner(beforePid, list);
  if (!owner) fail(`Port 8787 PID ${beforePid} is not a PM2-managed application. Refusing to stop or replace an unknown process.`);

  const ownerName = restartOwner(owner);
  const dashboard = await waitForCommandCenter();
  const afterPid = listenerPid();

  console.log(`PORT_8787_PID_BEFORE=${beforePid}`);
  console.log(`PORT_8787_PID_AFTER=${afterPid || 'UNKNOWN'}`);
  console.log(`CANONICAL_APPROVALS=${Array.isArray(dashboard.operations) ? dashboard.operations.filter(item => ['AWAITING_APPROVAL','WAITING_FOR_CEO_APPROVAL','AWAITING_CEO_APPROVAL'].includes(String(item?.status || '').toUpperCase())).length : 'UNKNOWN'}`);
  console.log(`WORKER_RUNTIME_AWAITING_APPROVAL=${dashboard.taskQueue?.awaitingApproval ?? 'UNKNOWN'}`);
  console.log(`COMMAND_CENTER_OWNER=${ownerName}`);
  console.log('COMMAND_CENTER_RESTART_GREEN');
  console.log('Refresh http://127.0.0.1:8787 in the browser and test View Mission / approval flow.');
}

main().catch(error => fail(error.message, error.stack));
