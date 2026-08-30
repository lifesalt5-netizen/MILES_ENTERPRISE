'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const target = path.join(ROOT, 'SCRIPTS', 'RepairCommandCenterRuntimeIntegrity.js');
let source = fs.readFileSync(target, 'utf8');

const oldText = '    "  const action = plan.action || plan.capability || \'BUSINESS_EXECUTION\';\\n  const policy = governanceForCommand(command, plan);\\n  const approvalRequired = legacyRequiresCEOApproval(command, plan) || policy.approvalRequired === true;\\n  const governance = {\\n    policy,\\n    approval: { approved: false, approver: policy.approver || \'CEO\', approvedAt: null }\\n  };\\n",';

const newText = '    "  const action = plan.action || plan.capability || \'BUSINESS_EXECUTION\';\\n  const policy = governanceForCommand(command, plan);\\n  const approvalRequired = policy.evaluated === false\\n    ? legacyRequiresCEOApproval(command, plan)\\n    : policy.approvalRequired === true;\\n  const governance = {\\n    policy,\\n    approval: { approved: false, approver: policy.approver || \'CEO\', approvedAt: null }\\n  };\\n",';

if (!source.includes(newText)) {
  if (!source.includes(oldText)) {
    throw new Error('COMMAND_CENTER_REPAIR_IDEMPOTENCE_ANCHOR_NOT_FOUND');
  }
  source = source.replace(oldText, newText);
  if (APPLY) fs.writeFileSync(target, source, 'utf8');
  console.log(APPLY ? 'COMMAND_CENTER_REPAIR_IDEMPOTENCE_APPLIED' : 'COMMAND_CENTER_REPAIR_IDEMPOTENCE_DRY_RUN_OK');
} else {
  console.log('COMMAND_CENTER_REPAIR_IDEMPOTENCE_ALREADY_CURRENT');
}
