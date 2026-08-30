'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const generator = fs.readFileSync(path.join(ROOT, 'SERVICES', 'AutonomousWorkGenerationService.js'), 'utf8').replace(/^\uFEFF/, '');
const maintenance = fs.readFileSync(path.join(ROOT, 'SERVICES', 'SelfMaintenanceService.js'), 'utf8').replace(/^\uFEFF/, '');

assert(generator.includes('CREDENTIAL_FINDING_REQUIRES_CANONICAL_CEO_OPERATION'));
assert(generator.includes('findingCategory === "CREDENTIAL"'));
assert(generator.includes('created: false'));
assert(generator.includes('governanceBlocked: true'));
assert(generator.includes('credentialGovernanceBlocked'));

assert(maintenance.includes('ORPHANED_AUTONOMOUS_CREDENTIAL_FINDING'));
assert(maintenance.includes('String(task?.source || "") === "AutonomousWorkGenerationService"'));
assert(maintenance.includes('/^AUTO_/i.test(String(task?.id || ""))'));
assert(maintenance.includes('String(task?.payload?.finding?.category || "").toUpperCase() === "CREDENTIAL"'));
assert(maintenance.includes('["STALE_FALSE_APPROVAL", "TERMINAL_SOURCE", "ORPHANED_AUTONOMOUS_CREDENTIAL_FINDING"]'));
assert(maintenance.includes('approvalsGranted: 0'));
assert(maintenance.includes('tasksResumed: 0'));
assert(maintenance.includes('tasksDeleted: 0'));

console.log('AUTONOMOUS_CREDENTIAL_ORPHAN_ROUTING_REGRESSION_PASS');
