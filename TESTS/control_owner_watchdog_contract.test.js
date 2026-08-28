'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const ensure = fs.readFileSync(path.join(root, 'SCRIPTS', 'EnsureMilesControlOwnerWindows.ps1'), 'utf8');
const pm2ProbePath = path.join(root, 'SCRIPTS', 'GetMilesPm2ProcessStatus.js');
const pm2Probe = fs.readFileSync(pm2ProbePath, 'utf8');
const watchdogProcess = fs.readFileSync(path.join(root, 'StartMilesControlOwnerWatchdog.js'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'SCRIPTS', 'InstallMilesControlOwnerWatchdogWindows.ps1'), 'utf8');
const proofScheduler = fs.readFileSync(path.join(root, 'SCRIPTS', 'ScheduleMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');
const proofRunner = fs.readFileSync(path.join(root, 'SCRIPTS', 'RunMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');
const proofFailsafe = fs.readFileSync(path.join(root, 'SCRIPTS', 'RunMilesControlOwnerRecoveryFailsafeWindows.ps1'), 'utf8');
const proofVerifier = fs.readFileSync(path.join(root, 'SCRIPTS', 'VerifyMilesControlOwnerRecoveryProofWindows.ps1'), 'utf8');

assert(ensure.includes('miles-autonomous-coo'));
assert(ensure.includes('RuntimeGenerationGuard.js'));
assert(ensure.includes('StartAutonomousCOO.js'));
assert(ensure.includes('StartMilesRemoteExecutionBridge.js'));
assert(ensure.includes('remote_execution_bridge_supervisor.json'));
assert(ensure.includes('Get-ControlBridgeHealth'));
assert(ensure.includes('BRIDGE_RUNNING_FRESH_CHILD_ALIVE'));
assert(ensure.includes('CONTROL_BRIDGE_UNHEALTHY'));
assert(ensure.includes('CONTROL_BRIDGE_NOT_HEALTHY_AFTER_RECOVERY'));
assert(ensure.includes('pm2.cmd restart'));
assert(ensure.includes('pm2.cmd start'));
assert(ensure.includes('pm2.cmd save'));
assert(ensure.includes('MILES_CONTROL_OWNER_WATCHDOG_GREEN'));
assert(ensure.includes('fixedCommandAllowlistOnly = $true'));
assert(ensure.includes('arbitraryShell = $false'));
assert(ensure.includes('gitMutation = $false'));
assert(ensure.includes('providerMutation = $false'));
assert(ensure.includes("$json | & node.exe -e $nodeProbe $Name"), 'PM2 jlist must be parsed by the fixed Node probe on Windows PowerShell.');
assert(ensure.includes('PM2_JLIST_JSON_PARSE_FAILED'));
assert(ensure.includes('PM2_JLIST_PARSE_FAILED'));
assert(!/\$rows\s*=\s*\$json\s*\|\s*ConvertFrom-Json/i.test(ensure), 'Raw PM2 jlist must not use Windows PowerShell ConvertFrom-Json because environment keys may collide by case.');
assert(!/git\s+(reset|clean|checkout\s+--|push)/i.test(ensure), 'Ensure script must not perform Git mutation/destructive recovery.');
assert(!/Invoke-Expression|\biex\b/i.test(ensure), 'Ensure script must not evaluate arbitrary commands.');

assert(pm2Probe.includes('JSON.parse'));
assert(pm2Probe.includes('FOUND\\t'));
const collisionPayload = JSON.stringify([{ name: 'miles-autonomous-coo', pm2_env: { status: 'online', username: 'lower', USERNAME: 'upper' } }]);
const collisionProbe = spawnSync(process.execPath, [pm2ProbePath, 'miles-autonomous-coo'], { input: collisionPayload, encoding: 'utf8' });
assert.strictEqual(collisionProbe.status, 0, collisionProbe.stderr);
assert.strictEqual(collisionProbe.stdout, 'FOUND\tonline');

assert(watchdogProcess.includes("path.join(ROOT, 'SCRIPTS', 'EnsureMilesControlOwnerWindows.ps1')"));
assert(watchdogProcess.includes("spawn('powershell.exe'"));
assert(watchdogProcess.includes("shell: false"));
assert(watchdogProcess.includes('setInterval(tick, INTERVAL_MS)'));
assert(watchdogProcess.includes('control_owner_watchdog_process_latest.json'));
assert(watchdogProcess.includes('WATCHDOG_ALREADY_RUNNING'));
assert(watchdogProcess.includes('fixedEnsureScriptOnly: true'));
assert(!watchdogProcess.includes('shell: true'));
assert(!/exec\s*\(|execSync\s*\(/.test(watchdogProcess), 'Independent watchdog must not execute arbitrary shell strings.');

assert(installer.includes('StartMilesControlOwnerWatchdog.js'));
assert(installer.includes('[Environment]::GetFolderPath("Startup")'));
assert(installer.includes('WScript.Shell'));
assert(installer.includes('CreateShortcut'));
assert(installer.includes('Start-Process -FilePath $node'));
assert(installer.includes('USER_STARTUP_INDEPENDENT_PROCESS'));
assert(installer.includes('preLogonRecoveryClaimed = $false'));
assert(installer.includes('MILES_CONTROL_OWNER_WATCHDOG_INSTALL_GREEN'));
assert(!installer.includes('Register-ScheduledTask'), 'Non-admin installer must not depend on Task Scheduler registration.');
assert(!installer.includes('New-ScheduledTaskTrigger'), 'Non-admin installer must not depend on Task Scheduler triggers.');
assert(!/git\s+(reset|clean|push)/i.test(installer), 'Installer must not perform Git recovery/mutation.');
assert(!/Invoke-Expression|\biex\b/i.test(installer), 'Installer must not evaluate arbitrary commands.');

assert(proofScheduler.includes('RunMilesControlOwnerRecoveryProofWindows.ps1'));
assert(proofScheduler.includes('Start-Process -FilePath $powershell'));
assert(proofScheduler.includes('DETACHED_FIXED_PROCESS'));
assert(proofScheduler.includes('$DelaySeconds = 45'));
assert(proofScheduler.includes('CONTROL_OWNER_RECOVERY_PROOF_SCHEDULED'));
assert(!proofScheduler.includes('Register-ScheduledTask'));
assert(!proofScheduler.includes('New-ScheduledTaskTrigger'));

assert(proofRunner.includes('miles-autonomous-coo'));
assert(proofRunner.includes('GetMilesPm2ProcessStatus.js'));
assert(proofRunner.includes('$json | & node.exe $Pm2ProbeScript $Name'));
assert(!/\$rows\s*=\s*\$json\s*\|\s*ConvertFrom-Json/i.test(proofRunner), 'Recovery runner must not parse raw PM2 jlist with PowerShell ConvertFrom-Json.');
assert(proofRunner.includes('remote_execution_bridge_supervisor.json'));
assert(proofRunner.includes('Get-ControlBridgeHealth'));
assert(proofRunner.includes('CONTROL_BRIDGE_NOT_HEALTHY_BEFORE_PROOF'));
assert(proofRunner.includes('bridgeRecoveryRequired = $true'));
assert(proofRunner.includes('INDEPENDENT_WATCHDOG_DID_NOT_PROVE_OWNER_AND_BRIDGE_RECOVERY'));
assert(proofRunner.includes('RunMilesControlOwnerRecoveryFailsafeWindows.ps1'));
assert(proofRunner.includes('Start-Process -FilePath $powershell'));
assert(proofRunner.includes('& pm2.cmd stop $ProcessName'));
assert(proofRunner.includes('CONTROL_OWNER_RECOVERED'));
assert(proofRunner.includes('PM2_RESTART'));
assert(proofRunner.includes('PM2_GUARDED_START'));
assert(proofRunner.includes('$watchdogObserved -gt $stoppedAt'));
assert(proofRunner.includes('CONTROL_OWNER_WATCHDOG_RECOVERY_PROVEN'));
assert(proofRunner.includes('recoveryMustComeFromIndependentWatchdog = $true'));
assert(proofRunner.includes('PRIMARY_WATCHDOG_RECOVERED_CANCEL_FAILSAFE'));
assert(!proofRunner.includes('Register-ScheduledTask'));
assert(!proofRunner.includes('New-ScheduledTaskTrigger'));
assert(!proofRunner.includes('pm2.cmd restart $ProcessName'), 'Proof runner itself must not restart the owner; recovery must come from the independent watchdog.');
assert(!proofRunner.includes('pm2.cmd start'), 'Proof runner itself must not start the owner.');

assert(proofFailsafe.includes('Start-Sleep -Seconds $DelaySeconds'));
assert(proofFailsafe.includes('control_owner_recovery_failsafe_cancel_'));
assert(proofFailsafe.includes('CONTROL_OWNER_RECOVERY_FAILSAFE_CANCELED'));
assert(proofFailsafe.includes('CONTROL_OWNER_RECOVERY_FAILSAFE_EXECUTED'));
assert(proofFailsafe.includes('EnsureMilesControlOwnerWindows.ps1'));
assert(!proofFailsafe.includes('Register-ScheduledTask'));

assert(proofVerifier.includes('GetMilesPm2ProcessStatus.js'));
assert(proofVerifier.includes('$json | & node.exe $Pm2ProbeScript $Name'));
assert(!/\$rows\s*=\s*\$json\s*\|\s*ConvertFrom-Json/i.test(proofVerifier), 'Recovery verifier must not parse raw PM2 jlist with PowerShell ConvertFrom-Json.');
assert(proofVerifier.includes('remote_execution_bridge_supervisor.json'));
assert(proofVerifier.includes('Get-ControlBridgeHealth'));
assert(proofVerifier.includes('RECOVERY_PROOF_BRIDGE_HEALTH_MISSING'));
assert(proofVerifier.includes('CONTROL_BRIDGE_NOT_HEALTHY_AFTER_PROOF'));
assert(proofVerifier.includes('CONTROL_OWNER_WATCHDOG_RECOVERY_PROVEN'));
assert(proofVerifier.includes('CONTROL_OWNER_WATCHDOG_RECOVERY_VERIFIED'));
assert(proofVerifier.includes('RECOVERY_PROOF_ID_MISMATCH'));
assert(proofVerifier.includes('RECOVERY_PROOF_WATCHDOG_EVIDENCE_NOT_POST_STOP'));
assert(proofVerifier.includes('CONTROL_OWNER_NOT_ONLINE_AFTER_PROOF'));
assert(proofVerifier.includes('USER_STARTUP_INDEPENDENT_PROCESS'));
assert(proofVerifier.includes('CONTROL_OWNER_WATCHDOG_HEARTBEAT_STALE'));
assert(proofVerifier.includes('readOnlyVerification = $true'));
assert(!proofVerifier.includes('Get-ScheduledTask'));

for (const script of [installer, proofScheduler, proofRunner, proofFailsafe, proofVerifier]) {
  assert(!/Invoke-Expression|\biex\b/i.test(script), 'Watchdog/recovery proof must not evaluate arbitrary commands.');
  assert(!/git\s+(reset|clean|checkout\s+--|push)/i.test(script), 'Watchdog/recovery proof must not perform Git mutation/destructive recovery.');
  assert(!/sendReply|RemediateNamecheapDmarc|CreateControlledInstantlyInboxPlacementTest/i.test(script), 'Watchdog/recovery proof must not mutate providers or send outreach.');
}

console.log('CONTROL_OWNER_WATCHDOG_CONTRACT=PASS');
