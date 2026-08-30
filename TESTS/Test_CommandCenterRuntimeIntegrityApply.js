'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-runtime-integrity-'));

function copy(rel) {
  const from = path.join(repoRoot, rel);
  const to = path.join(tempRoot, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

try {
  copy('SERVICES/digital_coo/MilesCommandCenter.js');
  copy('SERVICES/ceo_dashboard/public/ceo.js');
  copy('SERVICES/digital_coo/public/app.js');

  const repairScript = path.join(repoRoot, 'SCRIPTS', 'RepairCommandCenterRuntimeIntegrity.js');
  const applied = spawnSync(process.execPath, [repairScript, '--apply'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, MILES_ROOT: tempRoot }
  });

  assert.strictEqual(applied.status, 0, applied.stderr || applied.stdout || 'apply-mode repair failed');
  assert.match(applied.stdout, /REPAIR_APPLIED=TRUE/);

  const commandCenter = fs.readFileSync(path.join(tempRoot, 'SERVICES/digital_coo/MilesCommandCenter.js'), 'utf8');
  const ceoJs = fs.readFileSync(path.join(tempRoot, 'SERVICES/ceo_dashboard/public/ceo.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(tempRoot, 'SERVICES/digital_coo/public/app.js'), 'utf8');

  assert.match(commandCenter, /function reconcileRuntimeApprovals\(\)/);
  assert.match(commandCenter, /APPROVED_AND_RESUMED/);
  assert.match(commandCenter, /policyEngine\.evaluate/);
  assert.match(ceoJs, /\/execution\?operationId=/);
  assert.match(ceoJs, /severity:"WARNING", title:"Worker runtime approval backlog"/);
  assert.match(appJs, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(appJs, /startPolling\(initialOperationId\)/);

  for (const rel of [
    'SERVICES/digital_coo/MilesCommandCenter.js',
    'SERVICES/ceo_dashboard/public/ceo.js',
    'SERVICES/digital_coo/public/app.js'
  ]) {
    const checked = spawnSync(process.execPath, ['--check', path.join(tempRoot, rel)], { encoding: 'utf8' });
    assert.strictEqual(checked.status, 0, `${rel} syntax check failed:\n${checked.stderr || checked.stdout}`);
  }

  const second = spawnSync(process.execPath, [repairScript, '--apply'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, MILES_ROOT: tempRoot }
  });
  assert.strictEqual(second.status, 0, second.stderr || second.stdout || 'second apply failed');
  assert.match(second.stdout, /ALREADY_FIXED/);

  console.log('COMMAND_CENTER_RUNTIME_INTEGRITY_APPLY_TEST=PASS');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
