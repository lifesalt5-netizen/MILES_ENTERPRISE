'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const bridge = require('../StartMilesRemoteExecutionBridge');

assert.deepStrictEqual(Object.keys(bridge.JOBS).sort(), [
  'INBOX_PLACEMENT_AUDIT',
  'IONOS_INBOX_CLEANUP_EXECUTE',
  'IONOS_INBOX_CLEANUP_PLAN',
  'PRODUCTION_TRUTH_RECONCILIATION',
  'REVENUE_ACCEPTANCE_SPRINT'
]);
assert.deepStrictEqual(bridge.JOBS.IONOS_INBOX_CLEANUP_PLAN, ['node', ['SCRIPTS/RunIonosInboxCleanup.js']]);
assert.deepStrictEqual(bridge.JOBS.IONOS_INBOX_CLEANUP_EXECUTE, ['node', ['SCRIPTS/RunIonosInboxCleanup.js', '--execute']]);
assert.strictEqual(bridge.CONTROL_BRANCH, 'miles-control');
assert(bridge.DIRECTIVE_URL.includes('/miles-control/DATA/control/miles_remote_execution_directive.json'));
assert.strictEqual(bridge.EVIDENCE_BRANCH, 'miles-runtime-evidence');
assert.strictEqual(bridge.EVIDENCE_REPO_PATH, 'DATA/control/miles_remote_execution_result.json');
assert(bridge.PROGRESS_MS >= 30000);
assert.strictEqual(typeof bridge.STARTUP_SOURCE_DIGEST, 'string');
assert(bridge.STARTUP_SOURCE_DIGEST.length > 0);
assert.strictEqual(bridge.sourceDigest(), bridge.STARTUP_SOURCE_DIGEST);
assert.strictEqual(bridge.bridgeSourceChanged(bridge.STARTUP_SOURCE_DIGEST), false);
assert.deepStrictEqual(bridge.baseEvidence({ id: 'x', job: 'REVENUE_ACCEPTANCE_SPRINT' }, '2026-01-01T00:00:00.000Z', 'STARTED').phase, 'STARTED');
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'REVENUE_ACCEPTANCE_SPRINT'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'IONOS_INBOX_CLEANUP_PLAN'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'IONOS_INBOX_CLEANUP_EXECUTE'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'POWERSHELL'}).ok, false);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:false,job:'REVENUE_ACCEPTANCE_SPRINT'}).ok, false);

const src = fs.readFileSync(path.join(__dirname, '..', 'StartMilesRemoteExecutionBridge.js'), 'utf8');
assert(src.includes("['merge', '--ff-only', 'origin/main']"));
assert(src.includes("refs/heads/${EVIDENCE_BRANCH}"));
assert(src.includes('GIT_INDEX_FILE'));
assert(src.includes("'commit-tree'"));
assert(src.includes("baseEvidence(directive, startedAt, 'STARTED')"));
assert(src.includes("baseEvidence(directive, startedAt, 'RUNNING')"));
assert(src.includes('SELF-RELOAD'));
assert(src.includes('detached: true'));
assert(src.includes("stdio: 'ignore'"));
assert(!src.includes('refs/heads/main'));
assert(!src.includes('reset --hard'));
assert(!src.includes('git clean'));
assert(!src.includes('shell: true'));
assert(!src.includes('CreateControlledInstantlyInboxPlacementTest'));
assert(!src.includes('RemediateNamecheapDmarc'));
assert(!src.includes('sendReply'));
console.log('REMOTE_EXECUTION_BRIDGE_SAFETY=PASS');
