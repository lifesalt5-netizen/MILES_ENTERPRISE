'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const verifier = fs.readFileSync(path.join(root, 'SCRIPTS', 'VerifyMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');
const scheduler = fs.readFileSync(path.join(root, 'SCRIPTS', 'ScheduleMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');

assert(scheduler.includes('launchMode = "INDEPENDENT_WATCHDOG_REQUEST"'), 'Scheduler must publish the independent watchdog request launch mode.');
assert(scheduler.includes('MILES_CONTROL_OWNER_RECOVERY_PROOF_ALREADY_ACTIVE'), 'Scheduler must report idempotent reuse of an already-active recovery proof.');
assert(scheduler.includes('idempotentReuse = $IdempotentReuse'), 'Scheduler evidence must disclose idempotent reuse.');
assert(scheduler.includes('-Status "CONTROL_OWNER_RECOVERY_PROOF_SCHEDULED"'), 'Idempotent reuse must preserve the verifier-compatible GREEN schedule status.');
assert(scheduler.includes('-ProofId $existingProofId'), 'Idempotent reuse must preserve the existing proof ID.');
assert(scheduler.includes('-ScheduledFor $existingNotBefore'), 'Idempotent reuse must preserve the existing proof schedule.');
assert(!scheduler.includes('throw "RECOVERY_PROOF_REQUEST_ALREADY_ACTIVE:'), 'An already-active valid recovery proof must not overwrite GREEN schedule evidence with RED.');
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
