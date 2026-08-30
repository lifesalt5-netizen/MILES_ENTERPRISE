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
    [
      'const GOVERNED_SELF_MAINTENANCE_ACTIONS = new Set([',
      '  "SELF_MAINTENANCE",',
      '  "SELF_MAINTENANCE_DIAGNOSE",',
      '  "SELF_MAINTENANCE_PLAN",',
      '  "SELF_MAINTENANCE_VALIDATE",',
      '  "SELF_MAINTENANCE_REPORT",',
      '  "SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS",',
      '  "SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS"',
      ']);',
      '',
      'function isGovernedSelfMaintenance(task = {}) {',
      '  const payload = task.payload || {};',
      '  const plan = payload.plan || task.plan || {};',
      '  const action = normalize(task.action || payload.action || plan.action || task.type);',
      '  const provider = normalize(task.provider || payload.provider || plan.provider || task.system || payload.system || plan.system);',
      '  const system = normalize(task.system || payload.system || plan.system || "MILES");',
      '  return GOVERNED_SELF_MAINTENANCE_ACTIONS.has(action) &&',
      '    ["MILES", "SELFMAINTENANCESERVICE"].includes(provider) &&',
      '    (system === "MILES" || provider === "MILES");',
      '}',
      '',
      'function isGovernedQualifiedReply(task = {}) {'
    ].join('\n'),
    'policy self-maintenance helper'
  );

  text = replaceOnce(
    text,
    '    const structuredApprovalPattern = matchPattern(structured, approvals.approvalPatterns);\n    const proseApprovalPattern = explicitApprovalPattern(affirmative, approvals.approvalPatterns);\n    const rawApprovalPattern = structuredApprovalPattern || proseApprovalPattern;\n    const governedQualifiedReply = isGovernedQualifiedReply(task);\n    const approvalPattern =\n      governedQualifiedReply && ["SEND", "REPLY"].includes(normalize(rawApprovalPattern))\n        ? null\n        : rawApprovalPattern;\n\n    const autonomousPattern =\n      governedQualifiedReply\n        ? "GOVERNED_QUALIFIED_REPLY"\n        : matchPattern(structured, approvals.autonomousPatterns) ||\n          matchPattern(affirmative, approvals.autonomousPatterns);',
    '    const structuredApprovalPattern = matchPattern(structured, approvals.approvalPatterns);\n    const proseApprovalPattern = explicitApprovalPattern(affirmative, approvals.approvalPatterns);\n    const governedQualifiedReply = isGovernedQualifiedReply(task);\n    const governedSelfMaintenance = isGovernedSelfMaintenance(task);\n    const rawApprovalPattern = governedSelfMaintenance\n      ? proseApprovalPattern\n      : structuredApprovalPattern || proseApprovalPattern;\n    const approvalPattern =\n      governedQualifiedReply && ["SEND", "REPLY"].includes(normalize(rawApprovalPattern))\n        ? null\n        : rawApprovalPattern;\n\n    const autonomousPattern =\n      governedQualifiedReply\n        ? "GOVERNED_QUALIFIED_REPLY"\n        : governedSelfMaintenance\n          ? "GOVERNED_SELF_MAINTENANCE"\n          : matchPattern(structured, approvals.autonomousPatterns) ||\n            matchPattern(affirmative, approvals.autonomousPatterns);',
    'policy approval classification'
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

  const injected = [
    '  runtimeApprovalSourceOperationId(task = {}) {',
    '    const payload = task.payload || {};',
    '    return payload.sourceOperationId || payload.operationId || payload.businessOperationId || null;',
    '  }',
    '',
    '  currentPolicyForOperation(operation = {}) {',
    '    const command = operation.command || operation.objective || operation.title || "";',
    '    const plan = operation.plan || {};',
    '    return policyEngine.evaluate({',
    '      type: operation.action || operation.type || plan.action || "BUSINESS_EXECUTION",',
    '      action: operation.action || operation.type || plan.action || "BUSINESS_EXECUTION",',
    '      provider: operation.provider || plan.provider || "MILES",',
    '      connector: operation.connector || plan.connector || operation.provider || "MILES",',
    '      intent: operation.intent || plan.intent || null,',
    '      workflow: operation.workflow || plan.workflow || null,',
    '      title: operation.title || String(command).slice(0, 160),',
    '      command,',
    '      objective: operation.objective || command,',
    '      payload: {',
    '        provider: operation.provider || plan.provider || "MILES",',
    '        connector: operation.connector || plan.connector || operation.provider || "MILES",',
    '        action: operation.action || operation.type || plan.action || "BUSINESS_EXECUTION",',
    '        capability: operation.capability || plan.capability || operation.action || operation.type,',
    '        command,',
    '        objective: operation.objective || command,',
    '        plan: { ...plan, originalCommand: plan.originalCommand || command }',
    '      }',
    '    }, { actor: "MILES_SELF_MAINTENANCE", role: "MILES" });',
    '  }',
    '',
    '  auditRuntimeApprovals() {',
    '    const pendingStatuses = new Set(["AWAITING_APPROVAL", "AWAITING_CEO_APPROVAL", "WAITING_FOR_CEO_APPROVAL"]);',
    '    const terminalStatuses = new Set(["COMPLETED", "COMPLETE", "REJECTED", "CANCELLED", "BLOCKED", "FAILED"]);',
    '    const runtimeTasks = taskQueue.list().filter(task => pendingStatuses.has(String(task?.status || "").toUpperCase()));',
    '    const businessQueue = safeReadJson(this.businessQueueFile, { operations: [] });',
    '    const operations = Array.isArray(businessQueue.operations) ? businessQueue.operations : [];',
    '    const byId = new Map(operations.filter(Boolean).map(operation => [operation.id, operation]));',
    '    const items = runtimeTasks.map(task => {',
    '      const sourceOperationId = this.runtimeApprovalSourceOperationId(task);',
    '      const operation = sourceOperationId ? byId.get(sourceOperationId) : null;',
    '      const operationStatus = String(operation?.status || "").toUpperCase();',
    '      let policy = null;',
    '      let classification = "REVIEW_REQUIRED";',
    '      let reason = "Runtime approval requires review.";',
    '      if (!sourceOperationId) {',
    '        classification = "ORPHANED_NO_SOURCE_ID";',
    '        reason = "Runtime approval has no source operation ID; no automatic mutation is permitted.";',
    '      } else if (!operation) {',
    '        classification = "ORPHANED_SOURCE_NOT_FOUND";',
    '        reason = "Source operation is not present in the canonical business queue; no automatic mutation is permitted.";',
    '      } else if (terminalStatuses.has(operationStatus)) {',
    '        classification = "TERMINAL_SOURCE";',
    '        reason = "Source operation is already terminal (" + operationStatus + ").";',
    '      } else {',
    '        try {',
    '          policy = this.currentPolicyForOperation(operation);',
    '          if (policy?.evaluated !== false && policy?.decision === "ALLOW" && policy?.approvalRequired !== true) {',
    '            classification = "STALE_FALSE_APPROVAL";',
    '            reason = "Current canonical governance allows the source operation without CEO approval.";',
    '          } else if (policy?.approvalRequired === true || policy?.decision === "REQUIRE_APPROVAL") {',
    '            classification = "CANONICAL_APPROVAL_REQUIRED";',
    '            reason = policy.reason || "Current canonical governance still requires CEO approval.";',
    '          } else if (policy?.decision === "DENY") {',
    '            classification = "GOVERNANCE_DENIED";',
    '            reason = policy.reason || "Current canonical governance denies the source operation.";',
    '          }',
    '        } catch (error) {',
    '          classification = "POLICY_EVALUATION_FAILED";',
    '          reason = error.message;',
    '        }',
    '      }',
    '      return {',
    '        taskId: task.id, status: task.status, sourceOperationId, sourceOperationStatus: operation?.status || null,',
    '        action: task.action || task.payload?.action || task.type || null,',
    '        provider: task.provider || task.payload?.provider || null,',
    '        classification, reason, policyDecision: policy?.decision || null, approvalRequired: policy?.approvalRequired ?? null',
    '      };',
    '    });',
    '    const counts = items.reduce((acc, item) => {',
    '      acc[item.classification] = Number(acc[item.classification] || 0) + 1;',
    '      return acc;',
    '    }, {});',
    '    return { ok: true, service: "SelfMaintenanceService", action: "SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS", total: items.length, counts, items, mutationPerformed: false, checkedAt: now() };',
    '  }',
    '',
    '  reconcileRuntimeApprovals() {',
    '    const audit = this.auditRuntimeApprovals();',
    '    const reconciled = [];',
    '    const untouched = [];',
    '    for (const item of audit.items) {',
    '      if (!["STALE_FALSE_APPROVAL", "TERMINAL_SOURCE"].includes(item.classification)) {',
    '        untouched.push(item);',
    '        continue;',
    '      }',
    '      const reconciledAt = now();',
    '      taskQueue.update(item.taskId, {',
    '        status: "CANCELLED",',
    '        cancellationReason: item.reason,',
    '        maintenanceReconciliation: {',
    '          reconciled: true, reconciledAt, reconciledBy: "SelfMaintenanceService", previousStatus: item.status,',
    '          classification: item.classification, sourceOperationId: item.sourceOperationId, executionPerformed: false, approvalGranted: false',
    '        }',
    '      });',
    '      reconciled.push({ ...item, newStatus: "CANCELLED", reconciledAt });',
    '    }',
    '    return {',
    '      ok: true, service: "SelfMaintenanceService", action: "SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS",',
    '      audited: audit.total, reconciledCount: reconciled.length, untouchedCount: untouched.length, reconciled, untouched,',
    '      safety: { approvalsGranted: 0, tasksResumed: 0, tasksDeleted: 0, onlyCancelledClassifications: ["STALE_FALSE_APPROVAL", "TERMINAL_SOURCE"] },',
    '      completedAt: now()',
    '    };',
    '  }',
    '',
    '  maintain(task = {}) {',
    '    const before = this.diagnose();',
    '    const approvalAudit = this.auditRuntimeApprovals();',
    '    const approvalReconciliation = this.reconcileRuntimeApprovals();',
    '    const after = this.diagnose();',
    '    const validation = this.validate();',
    '    const result = {',
    '      ok: validation.ok !== false, service: "SelfMaintenanceService", action: "SELF_MAINTENANCE", status: after.status,',
    '      objective: task.payload?.objective || task.payload?.command || task.title || "", before, approvalAudit, approvalReconciliation, after, validation, completedAt: now()',
    '    };',
    '    const outFile = path.join(this.reportDir, "self_maintenance_run_" + Date.now() + ".json");',
    '    safeWriteJson(outFile, result);',
    '    return { ...result, outFile };',
    '  }',
    '',
    '  validate() {'
  ].join('\n');

  text = replaceOnce(text, '  validate() {\n', injected + '\n', 'self maintenance runtime reconciliation');

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
for (const [rel, patch] of patches) {
  const before = read(rel);
  const after = patch(before);
  if (after !== before) changed += 1;
  if (APPLY && after !== before) write(rel, after);
  console.log(`${rel}: ${after === before ? 'already-compliant' : APPLY ? 'patched' : 'would-patch'}`);
}

console.log(`COO_SELF_MAINTENANCE_AUTONOMY_${APPLY ? 'APPLY' : 'DRY_RUN'}_GREEN changed=${changed}`);
