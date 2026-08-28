'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const watchdog = fs.readFileSync(path.join(root, 'SCRIPTS', 'EnsureMilesControlOwnerWindows.ps1'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'SCRIPTS', 'InstallMilesControlOwnerWatchdogWindows.ps1'), 'utf8');
const proofScheduler = fs.readFileSync(path.join(root, 'SCRIPTS', 'ScheduleMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');
const proofRunner = fs.readFileSync(path.join(root, 'SCRIPTS', 'RunMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');
const proofVerifier = fs.readFileSync(path.join(root, 'SCRIPTS', 'VerifyMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');

assert(watchdog.includes('miles-autonomous-coo'));
assert(watchdog.includes('RuntimeGenerationGuard.js'));
assert(watchdog.includes('StartAutonomousCOO.js'));
assert(watchdog.includes('StartMilesRemoteExecutionBridge.js'));
assert(watchdog.includes('pm2.cmd restart'));
assert(watchdog.includes('pm2.cmd start'));
assert(watchdog.includes('pm2.cmd save'));
assert(watchdog.includes('MILES_CONTROL_OWNER_WATCHDOG_GREEN'));
assert(watchdog.includes('fixedCommandAllowlistOnly = $true'));
assert(watchdog.includes('arbitraryShell = $false'));
assert(watchdog.includes('gitMutation = $false'));
assert(watchdog.includes('providerMutation = $false'));
assert(!/git\s+(reset|clean|checkout\s+--|push)/i.test(watchdog), 'Watchdog must not perform Git mutation/destructive recovery.');
assert(!/Remove-Item|del\s|erase\s|rm\s/i.test(watchdog), 'Watchdog must not delete files.');
assert(!/Invoke-Expression|\biex\b/i.test(watchdog), 'Watchdog must not evaluate arbitrary commands.');

assert(installer.includes('MILES-ControlOwner-Watchdog'));
assert(installer.includes('EnsureMilesControlOwnerWindows.ps1'));
assert(installer.includes('New-ScheduledTaskTrigger -AtLogOn'));
assert(installer.includes('RepetitionInterval (New-TimeSpan -Minutes 1)'));
assert(installer.includes('Register-ScheduledTask'));
assert(installer.includes('Start-ScheduledTask'));
assert(installer.includes('LogonType Interactive'));
assert(installer.includes('RunLevel Limited'));
assert(installer.includes('MILES_CONTROL_OWNER_WATCHDOG_INSTALL_GREEN'));
assert(!/git\s+(reset|clean|push)/i.test(installer), 'Installer must not perform Git recovery/mutation.');
assert(!/Invoke-Expression|\biex\b/i.test(installer), 'Installer must not evaluate arbitrary commands.');

assert(proofScheduler.includes('MILES-ControlOwner-Recovery-Proof'));
assert(proofScheduler.includes('MILES-ControlOwner-Watchdog'));
assert(proofScheduler.includes('RunMilesControlOwnerRecoveryProofWindows.ps1'));
assert(proofScheduler.includes('New-ScheduledTaskTrigger -Once'));
assert(proofScheduler.includes('AddSeconds(45)'));
assert(proofScheduler.includes('RunLevel Limited'));
assert(proofScheduler.includes('MILES_CONTROL_OWNER_RECOVERY_PROOF_SCHEDULED'));

assert(proofRunner.includes('miles-autonomous-coo'));
assert(proofRunner.includes('MILES-ControlOwner-Watchdog'));
assert(proofRunner.includes('MILES-ControlOwner-Recovery-Proof-Failsafe'));
assert(proofRunner.includes('EnsureMilesControlOwnerWindows.ps1'));
assert(proofRunner.includes('& pm2.cmd stop $ProcessName'));
assert(proofRunner.includes('AddMinutes(5)'));
assert(proofRunner.includes('CONTROL_OWNER_RECOVERED'));
assert(proofRunner.includes('PM2_RESTART'));
assert(proofRunner.includes('PM2_GUARDED_START'));
assert(proofRunner.includes('$watchdogObserved -gt $stoppedAt'));
assert(proofRunner.includes('CONTROL_OWNER_WATCHDOG_RECOVERY_PROVEN'));
assert(proofRunner.includes('recoveryMustComeFromIndependentWatchdog = $true'));
assert(!proofRunner.includes('pm2.cmd restart $ProcessName'), 'Proof runner itself must not restart the owner; recovery must come from the independent watchdog.');
assert(!proofRunner.includes('pm2.cmd start'), 'Proof runner itself must not start the owner.');

assert(proofVerifier.includes('CONTROL_OWNER_WATCHDOG_RECOVERY_PROVEN'));
assert(proofVerifier.includes('CONTROL_OWNER_WATCHDOG_RECOVERY_VERIFIED'));
assert(proofVerifier.includes('RECOVERY_PROOF_ID_MISMATCH'));
assert(proofVerifier.includes('RECOVERY_PROOF_WATCHDOG_EVIDENCE_NOT_POST_STOP'));
assert(proofVerifier.includes('CONTROL_OWNER_NOT_ONLINE_AFTER_PROOF'));
assert(proofVerifier.includes('readOnlyVerification = $true'));

for (const proofScript of [proofScheduler, proofRunner, proofVerifier]) {
  assert(!/Invoke-Expression|\biex\b/i.test(proofScript), 'Recovery proof must not evaluate arbitrary commands.');
  assert(!/git\s+(reset|clean|checkout\s+--|push)/i.test(proofScript), 'Recovery proof must not perform Git mutation/destructive recovery.');
  assert(!/sendReply|RemediateNamecheapDmarc|CreateControlledInstantlyInboxPlacementTest/i.test(proofScript), 'Recovery proof must not mutate providers or send outreach.');
}

console.log('CONTROL_OWNER_WATCHDOG_CONTRACT=PASS');
