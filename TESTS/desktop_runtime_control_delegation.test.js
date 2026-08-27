'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'StartMiles.js'), 'utf8');
assert(src.includes("runtimeControlOwner:'miles-autonomous-coo'"));
assert(src.includes("delegated-to-miles-autonomous-coo"));
assert(src.includes("InfrastructureHealthAuditService"));
assert(!src.includes("new RemoteExecutionBridgeSupervisor"));
assert(!src.includes("new InfrastructureHealthScheduler"));
assert(!src.includes("remoteBridgeSupervisor.start()"));
assert(!src.includes("infrastructureHealthScheduler.start()"));
assert(!src.includes("remoteBridgeSupervisor.stop()"));
assert(!src.includes("infrastructureHealthScheduler.stop()"));
console.log('DESKTOP_RUNTIME_CONTROL_DELEGATION=PASS');
