'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ensure = fs.readFileSync(path.join(root, 'SCRIPTS', 'EnsureMilesControlOwnerWindows.ps1'), 'utf8');

assert(ensure.includes('remote_execution_bridge_state.json'));
assert(ensure.includes('remote_execution_bridge_evidence.json'));
assert(ensure.includes('remote_execution_bridge_consumption_watch.json'));
assert(ensure.includes('miles-control/DATA/control/miles_remote_execution_directive.json'));
assert(ensure.includes('Get-CurrentControlDirective'));
assert(ensure.includes('Get-ControlBridgeConsumptionHealth'));
assert(ensure.includes('ControlDirectivePickupGraceSeconds = 120'));
assert(ensure.includes('BridgeEvidenceFreshSeconds = 180'));
assert(ensure.includes('BRIDGE_CONTROL_DIRECTIVE_CURRENT'));
assert(ensure.includes('BRIDGE_CONTROL_DIRECTIVE_PROCESSING'));
assert(ensure.includes('BRIDGE_CONTROL_DIRECTIVE_PICKUP_GRACE'));
assert(ensure.includes('BRIDGE_DIRECTIVE_CONSUMPTION_STALLED'));
assert(ensure.includes('BRIDGE_RUNNING_FRESH_CHILD_ALIVE_CONTROL_CONSUMPTION_CURRENT'));
assert(ensure.includes('CONTROL_OWNER_ONLINE_CONTROL_CONSUMPTION_WATCH'));
assert(ensure.includes('controlVerified'));
assert(ensure.includes('Get-Date).AddSeconds(120)'));
assert(ensure.includes('Invoke-RestMethod'));
assert(ensure.includes('Cache-Control'));
assert(ensure.includes('TimeoutSec $ControlDirectiveProbeTimeoutSeconds'));
assert(ensure.includes('currentDirectiveId'));
assert(ensure.includes('lastDirectiveId'));
assert(ensure.includes('evidenceDirectiveId'));
assert(ensure.includes('mismatchAgeSeconds'));
assert(ensure.includes('$uri = "${ControlDirectiveUrl}?t=$nonce"'));
assert(!ensure.includes('$uri = "$ControlDirectiveUrl?t=$nonce"'));
assert(!/git\s+(reset|clean|checkout\s+--|push)/i.test(ensure));
assert(!/Invoke-Expression|\biex\b/i.test(ensure));
assert(!/sendReply|RemediateNamecheapDmarc|CreateControlledInstantlyInboxPlacementTest/i.test(ensure));

console.log('CONTROL_OWNER_BRIDGE_CONSUMPTION_HEALTH=PASS');
