'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function write(rel, text) {
  fs.writeFileSync(path.join(ROOT, rel), text, 'utf8');
}

function replaceOnce(text, needle, replacement, label) {
  if (text.includes(replacement)) return text;
  const count = text.split(needle).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one patch anchor, found ${count}`);
  return text.replace(needle, replacement);
}

function patchPlanner(text) {
  return replaceOnce(
    text,
    '  "SELF_MAINTENANCE_REPORT",\n  "WEBSITE_REVIEW"',
    '  "SELF_MAINTENANCE_REPORT",\n  "SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS",\n  "SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS",\n  "WEBSITE_REVIEW"',
    'planner actions'
  );
}

function patchDispatcher(text) {
  return replaceOnce(
    text,
    '  "SELF_MAINTENANCE_VALIDATE",\n  "SELF_MAINTENANCE_REPORT"\n]);',
    '  "SELF_MAINTENANCE_VALIDATE",\n  "SELF_MAINTENANCE_REPORT",\n  "SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS",\n  "SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS"\n]);',
    'dispatcher actions'
  );
}

function patchPolicy(text) {
  text = replaceOnce(
    text,
    'function isGovernedQualifiedReply(task = {}) {',
    `const GOVERNED_SELF_MAINTENANCE_ACTIONS = new Set([\n  "SELF_MAINTENANCE",\n  "SELF_MAINTENANCE_DIAGNOSE",\n  "SELF_MAINTENANCE_PLAN",\n  "SELF_MAINTENANCE_VALIDATE",\n  "SELF_MAINTENANCE_REPORT",\n  "SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS",\n  "SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS"\n]);\n\nfunction isGovernedSelfMaintenance(task = {}) {\n  const payload = task.payload || {};\n  const plan = payload.plan || task.plan || {};\n  const action = normalize(\n    task.action ||\n    payload.action ||\n    plan.action ||\n    task.type\n  );\n  const provider = normalize(\n    task.provider ||\n    payload.provider ||\n    plan.provider ||\n    task.system ||\n    payload.system ||\n    plan.system\n  );\n  const system = normalize(\n    task.system ||\n    payload.system ||\n    plan.system ||\n    "MILES"\n  );\n\n  return (\n    GOVERNED_SELF_MAINTENANCE_ACTIONS.has(action) &&\n    ["MILES", "SELFMAINTENANCESERVICE"].includes(provider) &&\n    (system === "MILES" || provider === "MILES")\n  );\n}\n\nfunction isGovernedQualifiedReply(task = {}) {`,
    'policy self-maintenance helper'
  );

  text = replaceOnce(
    text,
    '    const rawApprovalPattern = structuredApprovalPattern || proseApprovalPattern;\n    const governedQualifiedReply = isGovernedQualifiedReply(task);\n    const approvalPattern =\n      governedQualifiedReply && ["SEND", "REPLY"].includes(normalize(rawApprovalPattern))\n        ? null\n        : rawApprovalPattern;\n\n    const autonomousPattern =\n      governedQualifiedReply\n        ? "GOVERNED_QUALIFIED_REPLY"\n        : matchPattern(structured, approvals.autonomousPatterns) ||\n          matchPattern(affirmative, approvals.autonomousPatterns);',
    '    const governedQualifiedReply = isGovernedQualifiedReply(task);\n    const governedSelfMaintenance = isGovernedSelfMaintenance(task);\n    const rawApprovalPattern = governedSelfMaintenance\n      ? proseApprovalPattern\n      : structuredApprovalPattern || proseApprovalPattern;\n    const approvalPattern =\n      governedQualifiedReply && ["SEND", "REPLY"].includes(normalize(rawApprovalPattern))\n        ? null\n        : rawApprovalPattern;\n\n    const autonomousPattern =\n      governedQualifiedReply\n        ? "GOVERNED_QUALIFIED_REPLY"\n        : governedSelfMaintenance\n          ? "GOVERNED_SELF_MAINTENANCE"\n          : matchPattern(structured, approvals.autonomousPatterns) ||\n            matchPattern(affirmative, approvals.autonomousPatterns);',
    'policy approval/autonomy classification'
  );

  text = replaceOnce(
    text,
    '    let reason = governedQualifiedReply\n      ? "Evidence-gated qualified prospect reply is authorized for autonomous execution through controlled-write governance."\n      : "Read-only or low-risk action is authorized.";',
    '    let reason = governedQualifiedReply\n      ? "Evidence-gated qualified prospect reply is authorized for autonomous execution through controlled-write governance."\n      : governedSelfMaintenance\n        ? "Bounded MILES self-maintenance is authorized for autonomous execution; explicit protected CEO actions remain governed."\n        : "Read-only or low-risk action is authorized.";',
    'policy reason'
  );

  text = replaceOnce(
    text,
    '        governedQualifiedReply\n      },',
    '        governedQualifiedReply,\n        governedSelfMaintenance\n      },',
    'policy matches'
  );

  text = replaceOnce(
    text,
    'module.exports.isGovernedQualifiedReply = isGovernedQualifiedReply;\nmodule.exports.explicitApprovalPattern = explicitApprovalPattern;',
    'module.exports.isGovernedQualifiedReply = isGovernedQualifiedReply;\nmodule.exports.isGovernedSelfMaintenance = isGovernedSelfMaintenance;\nmodule.exports.explicitApprovalPattern = explicitApprovalPattern;',
    'policy exports'
  );

  return text;
}

function patchSelfMaintenance(text) {
  text = replaceOnce(
    text,
    'const fs = require("fs");\nconst path = require("path");\n',
    'const fs = require("fs");\nconst path = require("path");\nconst taskQueue = require("../CORE/TaskQueue");\nconst policyEngine = require("./governance/PolicyEngineService");\n',
    'self maintenance imports'
  );

  text = replaceOnce(
    text,
    '  validate() {\n',
    `  runtimeApprovalSourceOperationId(task = {}) {\n    const payload = task.payload || {};\n    return payload.sourceOperationId || payload.operationId || payload.businessOperationId || null;\n  }\n\n  currentPolicyForOperation(operation = {}) {\n    const command = operation.command || operation.objective || operation.title || "";\n    const plan = operation.plan || {};\n    return policyEngine.evaluate({\n      type: operation.action || operation.type || plan.action || "BUSINESS_EXECUTION",\n      action: operation.action || operation.type || plan.action || "BUSINESS_EXECUTION",\n      provider: operation.provider || plan.provider || "MILES",\n      connector: operation.connector || plan.connector || operation.provider || "MILES",\n      intent: operation.intent || plan.intent || null,\n      workflow: operation.workflow || plan.workflow || null,\n      title: operation.title || String(command).slice(0, 160),\n      command,\n      objective: operation.objective || command,\n      payload: {\n        provider: operation.provider || plan.provider || "MILES",\n        connector: operation.connector || plan.connector || operation.provider || "MILES",\n        action: operation.action || operation.type || plan.action || "BUSINESS_EXECUTION",\n        capability: operation.capability || plan.capability || operation.action || operation.type,\n        command,\n        objective: operation.objective || command,\n        plan: { ...plan, originalCommand: plan.originalCommand || command }\n      }\n    }, { actor: "MILES_SELF_MAINTENANCE", role: "MILES" });\n  }\n\n  auditRuntimeApprovals() {\n    const pendingStatuses = new Set([\n      "AWAITING_APPROVAL",\n      "AWAITING_CEO_APPROVAL",\n      "WAITING_FOR_CEO_APPROVAL"\n    ]);\n    const terminalStatuses = new Set([\n      "COMPLETED", "COMPLETE", "REJECTED", "CANCELLED", "BLOCKED", "FAILED"\n    ]);\n    const runtimeTasks = taskQueue.list().filter(task =>\n      pendingStatuses.has(String(task?.status || "").toUpperCase())\n    );\n    const businessQueue = safeReadJson(this.businessQueueFile, { operations: [] });\n    const operations = Array.isArray(businessQueue.operations) ? businessQueue.operations : [];\n    const byId = new Map(operations.filter(Boolean).map(operation => [operation.id, operation]));\n\n    const items = runtimeTasks.map(task => {\n      const sourceOperationId = this.runtimeApprovalSourceOperationId(task);\n      const operation = sourceOperationId ? byId.get(sourceOperationId) : null;\n      const operationStatus = String(operation?.status || "").toUpperCase();\n      let policy = null;\n      let classification = "REVIEW_REQUIRED";\n      let reason = "Runtime approval requires review.";\n\n      if (!sourceOperationId) {\n        classification = "ORPHANED_NO_SOURCE_ID";\n        reason = "Runtime approval has no source operation ID; no automatic mutation is permitted.";\n      } else if (!operation) {\n        classification = "ORPHANED_SOURCE_NOT_FOUND";\n        reason = "Source operation is not present in the canonical business queue; no automatic mutation is permitted.";\n      } else if (terminalStatuses.has(operationStatus)) {\n        classification = "TERMINAL_SOURCE";\n        reason = `Source operation is already terminal (${operationStatus}).`;\n      } else {\n        try {\n          policy = this.currentPolicyForOperation(operation);\n          if (policy?.evaluated !== false && policy?.decision === "ALLOW" && policy?.approvalRequired !== true) {\n            classification = "STALE_FALSE_APPROVAL";\n            reason = "Current canonical governance allows the source operation without CEO approval.";\n          } else if (policy?.approvalRequired === true || policy?.decision === "REQUIRE_APPROVAL") {\n            classification = "CANONICAL_APPROVAL_REQUIRED";\n            reason = policy.reason || "Current canonical governance still requires CEO approval.";\n          } else if (policy?.decision === "DENY") {\n            classification = "GOVERNANCE_DENIED";\n            reason = policy.reason || "Current canonical governance denies the source operation.";\n          }\n        } catch (error) {\n          classification = "POLICY_EVALUATION_FAILED";\n          reason = error.message;\n        }\n      }\n\n      return {\n        taskId: task.id,\n        status: task.status,\n        sourceOperationId,\n        sourceOperationStatus: operation?.status || null,\n        action: task.action || task.payload?.action || task.type || null,\n        provider: task.provider || task.payload?.provider || null,\n        classification,\n        reason,\n        policyDecision: policy?.decision || null,\n        approvalRequired: policy?.approvalRequired ?? null\n      };\n    });\n\n    const counts = items.reduce((acc, item) => {\n      acc[item.classification] = Number(acc[item.classification] || 0) + 1;\n      return acc;\n    }, {});\n\n    return {\n      ok: true,\n      service: "SelfMaintenanceService",\n      action: "SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS",\n      total: items.length,\n      counts,\n      items,\n      mutationPerformed: false,\n      checkedAt: now()\n    };\n  }\n\n  reconcileRuntimeApprovals() {\n    const audit = this.auditRuntimeApprovals();\n    const reconciled = [];\n    const untouched = [];\n\n    for (const item of audit.items) {\n      if (!["STALE_FALSE_APPROVAL", "TERMINAL_SOURCE"].includes(item.classification)) {\n        untouched.push(item);\n        continue;\n      }\n\n      const reconciledAt = now();\n      taskQueue.update(item.taskId, {\n        status: "CANCELLED",\n        cancellationReason: item.reason,\n        maintenanceReconciliation: {\n          reconciled: true,\n          reconciledAt,\n          reconciledBy: "SelfMaintenanceService",\n          previousStatus: item.status,\n          classification: item.classification,\n          sourceOperationId: item.sourceOperationId,\n          executionPerformed: false,\n          approvalGranted: false\n        }\n      });\n\n      reconciled.push({ ...item, newStatus: "CANCELLED", reconciledAt });\n    }\n\n    return {\n      ok: true,\n      service: "SelfMaintenanceService",\n      action: "SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS",\n      audited: audit.total,\n      reconciledCount: reconciled.length,\n      untouchedCount: untouched.length,\n      reconciled,\n      untouched,\n      safety: {\n        approvalsGranted: 0,\n        tasksResumed: 0,\n        tasksDeleted: 0,\n        onlyCancelledClassifications: ["STALE_FALSE_APPROVAL", "TERMINAL_SOURCE"]\n      },\n      completedAt: now()\n    };\n  }\n\n  maintain(task = {}) {\n    const before = this.diagnose();\n    const approvalAudit = this.auditRuntimeApprovals();\n    const approvalReconciliation = this.reconcileRuntimeApprovals();\n    const after = this.diagnose();\n    const validation = this.validate();\n\n    const result = {\n      ok: validation.ok !== false,\n      service: "SelfMaintenanceService",\n      action: "SELF_MAINTENANCE",\n      status: after.status,\n      objective: task.payload?.objective || task.payload?.command || task.title || "",\n      before,\n      approvalAudit,\n      approvalReconciliation,\n      after,\n      validation,\n      completedAt: now()\n    };\n\n    const outFile = path.join(this.reportDir, `self_maintenance_run_${Date.now()}.json`);\n    safeWriteJson(outFile, result);\n    return { ...result, outFile };\n  }\n\n  validate() {\n`,
    'self maintenance runtime reconciliation'
  );

  text = replaceOnce(
    text,
    '    if (action === "SELF_MAINTENANCE") {\n      return this.report(task);\n    }',
    '    if (action === "SELF_MAINTENANCE") {\n      return this.maintain(task);\n    }',
    'self maintenance default run'
  );

  text = replaceOnce(
    text,
    '    if (action === "SELF_MAINTENANCE_REPORT") {\n      return this.report(task);\n    }\n\n    return {',
    '    if (action === "SELF_MAINTENANCE_REPORT") {\n      return this.report(task);\n    }\n\n    if (action === "SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS") {\n      return this.auditRuntimeApprovals(task);\n    }\n\n    if (action === "SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS") {\n      return this.reconcileRuntimeApprovals(task);\n    }\n\n    return {',
    'self maintenance action routing'
  );

  text = replaceOnce(
    text,
    '        "SELF_MAINTENANCE_VALIDATE",\n        "SELF_MAINTENANCE_REPORT"\n      ]',
    '        "SELF_MAINTENANCE_VALIDATE",\n        "SELF_MAINTENANCE_REPORT",\n        "SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS",\n        "SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS"\n      ]',
    'self maintenance supported actions'
  );

  return text;
}

const patches = [
  ['SERVICES/CommandIntentPlannerService.js', patchPlanner],
  ['SERVICES/CapabilityDispatcherService.js', patchDispatcher],
  ['SERVICES/governance/PolicyEngineService.js', patchPolicy],
  ['SERVICES/SelfMaintenanceService.js', patchSelfMaintenance]
];

let changed = 0;
for (const [rel, fn] of patches) {
  const before = read(rel);
  const after = fn(before);
  if (after !== before) {
    changed += 1;
    if (APPLY) write(rel, after);
  }
  console.log(`${rel}: ${after === before ? 'already-patched' : APPLY ? 'patched' : 'would-patch'}`);
}

console.log(`COO_SELF_MAINTENANCE_AUTONOMY_${APPLY ? 'APPLY' : 'DRY_RUN'}_GREEN changed=${changed}`);
