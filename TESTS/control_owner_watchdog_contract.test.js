'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const watchdog = fs.readFileSync(path.join(root, 'SCRIPTS', 'EnsureMilesControlOwnerWindows.ps1'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'SCRIPTS', 'InstallMilesControlOwnerWatchdogWindows.ps1'), 'utf8');

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

console.log('CONTROL_OWNER_WATCHDOG_CONTRACT=PASS');
