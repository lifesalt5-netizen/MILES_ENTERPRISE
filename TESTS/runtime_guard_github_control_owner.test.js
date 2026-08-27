'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const guard = require('../SCRIPTS/RuntimeGenerationGuard');

assert.strictEqual(guard.CONTROL_OWNER_RUNTIME, 'miles-autonomous-coo');
assert.strictEqual(guard.parseArgs(['--runtime','miles-autonomous-coo','--entry','StartAutonomousCOO.js','--arg','--loop']).runtime, 'miles-autonomous-coo');

const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RuntimeGenerationGuard.js'), 'utf8');
assert(src.includes("RemoteExecutionBridgeSupervisor"));
assert(src.includes("InfrastructureHealthScheduler"));
assert(src.includes("runtime !== CONTROL_OWNER_RUNTIME"));
assert(src.includes("new RemoteExecutionBridgeSupervisor({ root: ROOT })"));
assert(src.includes("new InfrastructureHealthScheduler({ root: ROOT, intervalHours: 72 })"));
assert(src.includes("controlOwnership?.infrastructureScheduler?.stop()"));
assert(src.includes("controlOwnership?.bridgeSupervisor?.stop()"));
assert(src.includes("githubControlOwner: options.runtime === CONTROL_OWNER_RUNTIME"));
assert(!src.includes('shell: true'));
assert(!src.includes('powershell'));
console.log('RUNTIME_GUARD_GITHUB_CONTROL_OWNER=PASS');
