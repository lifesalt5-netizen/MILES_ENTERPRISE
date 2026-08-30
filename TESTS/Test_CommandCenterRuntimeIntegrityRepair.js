'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'SCRIPTS', 'RepairCommandCenterRuntimeIntegrity.js');
const run = spawnSync(process.execPath, [script], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, MILES_ROOT: root }
});

assert.strictEqual(run.status, 0, run.stderr || run.stdout || 'repair dry-run failed');
assert.match(run.stdout, /DRY_RUN_ONLY=TRUE/);
assert.match(run.stdout, /MilesCommandCenter\.js: (CHANGE_REQUIRED|ALREADY_FIXED)/);
assert.match(run.stdout, /ceo\.js: (CHANGE_REQUIRED|ALREADY_FIXED)/);
assert.match(run.stdout, /app\.js: (CHANGE_REQUIRED|ALREADY_FIXED)/);

console.log('COMMAND_CENTER_RUNTIME_INTEGRITY_REPAIR_TEST=PASS');
