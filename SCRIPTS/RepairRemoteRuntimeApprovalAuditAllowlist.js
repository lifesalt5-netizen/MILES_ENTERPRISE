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
    return;
  }
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  text = text.replace(before, after);
  if (APPLY) fs.writeFileSync(file, text, 'utf8');
  console.log(`${label}=${APPLY ? 'APPLIED' : 'DRY_RUN_OK'}`);
}

patch(
  'StartMilesRemoteExecutionBridge.js',
  "  COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY: ['node', ['SCRIPTS/DeployConsolidatedCOOSelfMaintenance.js']]\n});",
  "  COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY: ['node', ['SCRIPTS/DeployConsolidatedCOOSelfMaintenance.js']],\n  COO_RUNTIME_APPROVAL_AUDIT: ['node', ['SCRIPTS/AuditRuntimeApprovalBacklog.js']]\n});",
  'BRIDGE_RUNTIME_APPROVAL_AUDIT_JOB'
);

patch(
  'TESTS/remote_execution_bridge_safety.test.js',
  "  'COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY',\n  'INBOX_PLACEMENT_AUDIT',",
  "  'COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY',\n  'COO_RUNTIME_APPROVAL_AUDIT',\n  'INBOX_PLACEMENT_AUDIT',",
  'BRIDGE_RUNTIME_APPROVAL_AUDIT_EXPECTED_KEY'
);

patch(
  'TESTS/remote_execution_bridge_safety.test.js',
  "assert.deepStrictEqual(bridge.JOBS.COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY, ['node', ['SCRIPTS/DeployConsolidatedCOOSelfMaintenance.js']]);",
  "assert.deepStrictEqual(bridge.JOBS.COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY, ['node', ['SCRIPTS/DeployConsolidatedCOOSelfMaintenance.js']]);\nassert.deepStrictEqual(bridge.JOBS.COO_RUNTIME_APPROVAL_AUDIT, ['node', ['SCRIPTS/AuditRuntimeApprovalBacklog.js']]);",
  'BRIDGE_RUNTIME_APPROVAL_AUDIT_TEST'
);

console.log(APPLY ? 'REMOTE_RUNTIME_APPROVAL_AUDIT_ALLOWLIST_APPLIED' : 'REMOTE_RUNTIME_APPROVAL_AUDIT_ALLOWLIST_DRY_RUN_OK');
