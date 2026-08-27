'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const bridge = require('../StartMilesRemoteExecutionBridge');

assert.deepStrictEqual(Object.keys(bridge.JOBS).sort(), [
  'INBOX_PLACEMENT_AUDIT',
  'PRODUCTION_TRUTH_RECONCILIATION',
  'REVENUE_ACCEPTANCE_SPRINT'
]);
assert.strictEqual(bridge.EVIDENCE_BRANCH, 'miles-runtime-evidence');
assert.strictEqual(bridge.EVIDENCE_REPO_PATH, 'DATA/control/miles_remote_execution_result.json');
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'REVENUE_ACCEPTANCE_SPRINT'}).ok, true);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'POWERSHELL'}).ok, false);
assert.strictEqual(bridge.validateDirective({id:'x',enabled:false,job:'REVENUE_ACCEPTANCE_SPRINT'}).ok, false);

const src = fs.readFileSync(path.join(__dirname, '..', 'StartMilesRemoteExecutionBridge.js'), 'utf8');
assert(src.includes("['merge', '--ff-only', 'origin/main']"));
assert(src.includes("refs/heads/${EVIDENCE_BRANCH}"));
assert(src.includes('GIT_INDEX_FILE'));
assert(src.includes("'commit-tree'"));
assert(!src.includes('refs/heads/main'));
assert(!src.includes('reset --hard'));
assert(!src.includes('git clean'));
assert(!src.includes('shell: true'));
assert(!src.includes('CreateControlledInstantlyInboxPlacementTest'));
assert(!src.includes('RemediateNamecheapDmarc'));
assert(!src.includes('sendReply'));
console.log('REMOTE_EXECUTION_BRIDGE_SAFETY=PASS');
