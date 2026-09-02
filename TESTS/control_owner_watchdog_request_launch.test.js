'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scheduler = fs.readFileSync(path.join(root, 'SCRIPTS', 'ScheduleMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');
const watchdogSource = fs.readFileSync(path.join(root, 'StartMilesControlOwnerWatchdog.js'), 'utf8');
const watchdog = require('../StartMilesControlOwnerWatchdog');

const executableScheduler = scheduler
  .split(/\r?\n/)
  .filter(line => !line.trim().startsWith('#'))
  .join('\n');

assert(scheduler.includes('control_owner_recovery_proof_request.json'));
assert(scheduler.includes('INDEPENDENT_WATCHDOG_REQUEST'));
assert(scheduler.includes('INDEPENDENT_CONTROL_OWNER_WATCHDOG'));
assert(scheduler.includes('$DelaySeconds = 120'));
assert(scheduler.includes('$RunnerDelaySeconds = 10'));
assert(scheduler.includes('CONTROL_OWNER_RECOVERY_PROOF_SCHEDULED'));
assert(scheduler.includes('MILES_CONTROL_OWNER_RECOVERY_PROOF_ALREADY_ACTIVE'));
assert(scheduler.includes('-IdempotentReuse $true'));
assert(scheduler.includes('-ExistingRequestStatus $existingStatus'));
assert(scheduler.includes('idempotentReuse = $IdempotentReuse'));
assert(scheduler.includes('existingRequestStatus = $ExistingRequestStatus'));
assert(!scheduler.includes('RECOVERY_PROOF_REQUEST_ALREADY_ACTIVE'));
assert(!executableScheduler.includes('LaunchMilesControlOwnerRecoveryProof.js'));
assert(!executableScheduler.includes('& node.exe $DetachedLauncher'));
assert(!executableScheduler.includes('DETACHED_FIXED_PROCESS'));
assert(!executableScheduler.includes('Start-Process -FilePath $powershell'));
assert(!executableScheduler.includes('Register-ScheduledTask'));
assert(!executableScheduler.includes('New-ScheduledTaskTrigger'));

assert(watchdogSource.includes("path.join(RUNTIME_DIR, 'control_owner_recovery_proof_request.json')"));
assert(watchdogSource.includes("path.join(ROOT, 'SCRIPTS', 'RunMilesControlOwnerRecoveryProofWindows.ps1')"));
assert(watchdogSource.includes("launchMode: 'INDEPENDENT_WATCHDOG_CHILD'"));
assert(watchdogSource.includes('detached: false'));
assert(watchdogSource.includes("'-DelaySeconds', '10'"));
assert(watchdogSource.includes('fixedRecoveryProofScriptOnly: true'));
assert(watchdogSource.includes('recoveryProofRunsInsideIndependentWatchdog: true'));
assert(!watchdogSource.includes('shell: true'));
assert(!/exec\s*\(|execSync\s*\(/.test(watchdogSource));

const proofId = 'a'.repeat(32);
const good = watchdog.normalizeRecoveryProofRequest({
  proofId,
  status: 'PENDING',
  notBefore: new Date(Date.now() + 60000).toISOString()
});
assert.strictEqual(good.ok, true);
assert.strictEqual(good.proofId, proofId);
assert.strictEqual(good.status, 'PENDING');
assert(Number.isFinite(good.notBeforeMs));

assert.strictEqual(watchdog.normalizeRecoveryProofRequest(null).ok, false);
assert.strictEqual(watchdog.normalizeRecoveryProofRequest({ proofId: 'bad', status: 'PENDING', notBefore: new Date().toISOString() }).reason, 'INVALID_PROOF_ID');
assert.strictEqual(watchdog.normalizeRecoveryProofRequest({ proofId, status: 'PENDING', notBefore: 'not-a-date' }).reason, 'INVALID_NOT_BEFORE');

console.log('CONTROL_OWNER_WATCHDOG_REQUEST_LAUNCH=PASS');
