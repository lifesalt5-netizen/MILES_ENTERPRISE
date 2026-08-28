'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const verifier = fs.readFileSync(path.join(root, 'SCRIPTS', 'VerifyMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');
const scheduler = fs.readFileSync(path.join(root, 'SCRIPTS', 'ScheduleMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');

assert(scheduler.includes('launchMode = "INDEPENDENT_WATCHDOG_REQUEST"'), 'Scheduler must publish the independent watchdog request launch mode.');
assert(verifier.includes('$schedule.launchMode -ne "INDEPENDENT_WATCHDOG_REQUEST"'), 'Verifier must require the governing independent watchdog request mode.');
assert(!verifier.includes('$schedule.launchMode -ne "DETACHED_FIXED_PROCESS"'), 'Verifier must not require the retired detached fixed-process mode.');
assert(verifier.includes('control_owner_recovery_proof_request.json'), 'Verifier must read the one-shot watchdog request for mismatch diagnostics.');
assert(verifier.includes('REQUEST_STATUS='), 'Verifier mismatch diagnostics must expose request status.');
assert(verifier.includes('REQUEST_EXIT='), 'Verifier mismatch diagnostics must expose request exit code.');
assert(verifier.includes('REQUEST_ERROR='), 'Verifier mismatch diagnostics must expose request error without mutating runtime state.');
assert(verifier.includes('CONTROL_OWNER_WATCHDOG_RECOVERY_VERIFIED'));
assert(verifier.includes('RECOVERY_PROOF_ID_MISMATCH'));
assert(verifier.includes('CONTROL_BRIDGE_NOT_HEALTHY_AFTER_PROOF'));
assert(verifier.includes('readOnlyVerification = $true'));

console.log('CONTROL_OWNER_RECOVERY_VERIFIER_MODE=PASS');
