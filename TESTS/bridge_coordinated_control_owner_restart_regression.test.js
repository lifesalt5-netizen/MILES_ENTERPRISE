'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(ROOT, 'StartMilesRemoteExecutionBridge.js'), 'utf8').replace(/^\uFEFF/, '');
const supervisor = fs.readFileSync(path.join(ROOT, 'SERVICES', 'runtime', 'RemoteExecutionBridgeSupervisor.js'), 'utf8').replace(/^\uFEFF/, '');
const deploy = fs.readFileSync(path.join(ROOT, 'SCRIPTS', 'DeployConsolidatedCOOSelfMaintenance.js'), 'utf8').replace(/^\uFEFF/, '');

assert(bridge.includes('const CONTROL_OWNER_RESTART_EXIT_CODE = 76'));
assert(bridge.includes("directive.job === 'COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY'"));
assert(bridge.includes('record.evidence = await publishEvidenceSerialized(evidence)'));
assert(bridge.indexOf('record.evidence = await publishEvidenceSerialized(evidence)') < bridge.indexOf('CONTROL_OWNER_RESTART_REQUESTED exit='));
assert(bridge.includes('process.exit(CONTROL_OWNER_RESTART_EXIT_CODE)'));

assert(supervisor.includes('const CONTROL_OWNER_RESTART_EXIT_CODE = 76'));
assert(supervisor.includes("status: 'CONTROL_OWNER_RESTART_REQUESTED'"));
assert(supervisor.includes('this.releaseLock()'));
assert(supervisor.includes('process.exit(CONTROL_OWNER_RESTART_EXIT_CODE)'));

assert(deploy.includes("mode: 'SUPERVISOR_AFTER_REMOTE_EVIDENCE'"));
assert(!deploy.includes("mode: 'DELAYED_AFTER_REMOTE_EVIDENCE'"));
assert(deploy.includes("restartKnownApp(byName.get('miles-worker'))"));
assert(deploy.includes("restartKnownApp(byName.get('miles-command-center'))"));
assert(deploy.includes("restartKnownApp(byName.get('p2gc-growth-demo'))"));
assert(deploy.includes("'p2gc-growth-demo'"));
assert(deploy.includes('async function waitForGrowthDemo()'));
assert(deploy.includes("getJson('http://127.0.0.1:8791/api/health')"));
assert(deploy.includes("capabilities.includes('truth_reconciliation')"));
assert(deploy.includes('P2GC_GROWTH_DEMO_HEALTH_AFTER='));
assert(deploy.includes("if (!REMOTE_BRIDGE_SUPERVISED)"));

console.log('BRIDGE_COORDINATED_CONTROL_OWNER_RESTART_REGRESSION_PASS');
