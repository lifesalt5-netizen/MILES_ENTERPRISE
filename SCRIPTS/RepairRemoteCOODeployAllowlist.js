'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');

function patch(rel, before, after, label) {
  const file = path.join(ROOT, rel);
  let text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (text.includes(after)) {
    console.log(`${label}=ALREADY_CURRENT`);
    return false;
  }
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  text = text.replace(before, after);
  if (APPLY) fs.writeFileSync(file, text, 'utf8');
  console.log(`${label}=${APPLY ? 'APPLIED' : 'DRY_RUN_OK'}`);
  return true;
}

patch(
  'StartMilesRemoteExecutionBridge.js',
  "  INSTANTLY_LIFECYCLE_PROOF_EXECUTE: ['node', ['SCRIPTS/RunInstantlyLifecycleProof.js', '--execute']]\n});",
  "  INSTANTLY_LIFECYCLE_PROOF_EXECUTE: ['node', ['SCRIPTS/RunInstantlyLifecycleProof.js', '--execute']],\n  COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY: ['node', ['SCRIPTS/DeployConsolidatedCOOSelfMaintenance.js']]\n});",
  'BRIDGE_COO_DEPLOY_JOB'
);

patch(
  'TESTS/remote_execution_bridge_safety.test.js',
  "  'CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_VERIFY',\n  'INBOX_PLACEMENT_AUDIT',",
  "  'CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_VERIFY',\n  'COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY',\n  'INBOX_PLACEMENT_AUDIT',",
  'BRIDGE_COO_DEPLOY_EXPECTED_KEY'
);

patch(
  'TESTS/remote_execution_bridge_safety.test.js',
  "assert.deepStrictEqual(bridge.JOBS.INFRASTRUCTURE_HEALTH_AUDIT, ['node', ['SCRIPTS/RunInfrastructureHealthAudit.js']]);",
  "assert.deepStrictEqual(bridge.JOBS.INFRASTRUCTURE_HEALTH_AUDIT, ['node', ['SCRIPTS/RunInfrastructureHealthAudit.js']]);\nassert.deepStrictEqual(bridge.JOBS.COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY, ['node', ['SCRIPTS/DeployConsolidatedCOOSelfMaintenance.js']]);\nassert.strictEqual(bridge.validateDirective({id:'x',enabled:true,job:'COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY'}).ok, true);",
  'BRIDGE_COO_DEPLOY_TEST'
);

console.log(APPLY ? 'REMOTE_COO_DEPLOY_ALLOWLIST_REPAIR_APPLIED' : 'REMOTE_COO_DEPLOY_ALLOWLIST_REPAIR_DRY_RUN_OK');
