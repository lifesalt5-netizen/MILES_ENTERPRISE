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
  'SERVICES/AutonomousWorkGenerationService.js',
  `  submitTask(task) {\n    const duplicate =\n      activeDuplicate(task);`,
  `  submitTask(task) {\n    // Credential findings are observations about missing/partial authentication,\n    // not authorization to access a protected account. Keep them visible in the\n    // autonomous-work evidence, but never enqueue an executable orphan task.\n    // A protected credential action must originate from a canonical CEO-routable\n    // operation instead of being synthesized directly into the runtime queue.\n    const findingCategory = statusUpper(task?.payload?.finding?.category);\n    if (findingCategory === "CREDENTIAL") {\n      this.metrics.tasksBlocked += 1;\n      return {\n        ok: true,\n        created: false,\n        duplicate: false,\n        blocked: true,\n        governanceBlocked: true,\n        blockReason: "CREDENTIAL_FINDING_REQUIRES_CANONICAL_CEO_OPERATION",\n        task\n      };\n    }\n\n    const duplicate =\n      activeDuplicate(task);`,
  'AUTONOMOUS_CREDENTIAL_ENQUEUE_GUARD'
);

patch(
  'SERVICES/AutonomousWorkGenerationService.js',
  `          blocked:\n            generated.filter(\n              task =>\n                task.payload.blocked ===\n                true\n            ).length,`,
  `          blocked:\n            submissions.filter(\n              item => item.blocked === true || item.governanceBlocked === true\n            ).length,\n\n          credentialGovernanceBlocked:\n            submissions.filter(\n              item => item.governanceBlocked === true &&\n                item.blockReason === "CREDENTIAL_FINDING_REQUIRES_CANONICAL_CEO_OPERATION"\n            ).length,`,
  'AUTONOMOUS_CREDENTIAL_BLOCKED_METRICS'
);

patch(
  'SERVICES/SelfMaintenanceService.js',
  `      if (!sourceOperationId) {\n        classification = "ORPHANED_NO_SOURCE_ID";\n        reason = "Runtime approval has no source operation ID; no automatic mutation is permitted.";`,
  `      const autonomousCredentialOrphan =\n        !sourceOperationId &&\n        String(task?.source || "") === "AutonomousWorkGenerationService" &&\n        /^AUTO_/i.test(String(task?.id || "")) &&\n        String(task?.payload?.finding?.category || "").toUpperCase() === "CREDENTIAL";\n      if (autonomousCredentialOrphan) {\n        classification = "ORPHANED_AUTONOMOUS_CREDENTIAL_FINDING";\n        reason = "Legacy autonomous credential finding has no canonical CEO-routable source operation; cancel it without approval or execution.";\n      } else if (!sourceOperationId) {\n        classification = "ORPHANED_NO_SOURCE_ID";\n        reason = "Runtime approval has no source operation ID; no automatic mutation is permitted.";`,
  'SELF_MAINTENANCE_CREDENTIAL_ORPHAN_CLASSIFICATION'
);

patch(
  'SERVICES/SelfMaintenanceService.js',
  `      if (!["STALE_FALSE_APPROVAL", "TERMINAL_SOURCE"].includes(item.classification)) {`,
  `      if (!["STALE_FALSE_APPROVAL", "TERMINAL_SOURCE", "ORPHANED_AUTONOMOUS_CREDENTIAL_FINDING"].includes(item.classification)) {`,
  'SELF_MAINTENANCE_CREDENTIAL_ORPHAN_RECONCILE'
);

patch(
  'SERVICES/SelfMaintenanceService.js',
  `      safety: { approvalsGranted: 0, tasksResumed: 0, tasksDeleted: 0, onlyCancelledClassifications: ["STALE_FALSE_APPROVAL", "TERMINAL_SOURCE"] },`,
  `      safety: { approvalsGranted: 0, tasksResumed: 0, tasksDeleted: 0, onlyCancelledClassifications: ["STALE_FALSE_APPROVAL", "TERMINAL_SOURCE", "ORPHANED_AUTONOMOUS_CREDENTIAL_FINDING"] },`,
  'SELF_MAINTENANCE_CREDENTIAL_ORPHAN_SAFETY'
);

console.log(APPLY ? 'AUTONOMOUS_CREDENTIAL_ORPHAN_ROUTING_REPAIR_APPLIED' : 'AUTONOMOUS_CREDENTIAL_ORPHAN_ROUTING_REPAIR_DRY_RUN_OK');
