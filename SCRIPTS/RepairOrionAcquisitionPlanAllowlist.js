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
  "  COO_RUNTIME_APPROVAL_AUDIT: ['node', ['SCRIPTS/AuditRuntimeApprovalBacklog.js']]\n});",
  "  COO_RUNTIME_APPROVAL_AUDIT: ['node', ['SCRIPTS/AuditRuntimeApprovalBacklog.js']],\n  ORION_OFFICIAL_SOURCE_ACQUISITION_PLAN: ['node', ['SCRIPTS/PlanOrionOfficialSourceAcquisition.js']]\n});",
  'BRIDGE_ORION_ACQUISITION_PLAN_JOB'
);

console.log(APPLY ? 'ORION_ACQUISITION_PLAN_ALLOWLIST_REPAIR_APPLIED' : 'ORION_ACQUISITION_PLAN_ALLOWLIST_REPAIR_DRY_RUN_OK');
