'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(ROOT, 'BACKUPS', `command-center-runtime-integrity-${stamp}`);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\uFEFF/, '');
}

function write(rel, content) {
  const target = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function backup(rel) {
  const source = path.join(ROOT, rel);
  const target = path.join(backupDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return { source, changed: false, already: true };
  if (!source.includes(before)) throw new Error(`PATCH_ANCHOR_NOT_FOUND: ${label}`);
  return { source: source.replace(before, after), changed: true, already: false };
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  if (source.includes(replacement)) return { source, changed: false, already: true };
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`PATCH_ANCHOR_NOT_FOUND: ${label}`);
  return {
    source: source.slice(0, start) + replacement + '\n\n' + source.slice(end),
    changed: true,
    already: false
  };
}

function lines(items) {
  return items.join('\n');
}

function patchCommandCenter(source) {
  let result = source;
  let changed = false;
  let patch;

  patch = replaceRequired(
    result,
    "const taskQueue = require('../../CORE/TaskQueue');\n",
    "const taskQueue = require('../../CORE/TaskQueue');\nconst policyEngine = require('../governance/PolicyEngineService');\n",
    'policy-engine-import'
  );
  result = patch.source;
  changed ||= patch.changed;

  const approvalFunctions = lines([
    "function legacyRequiresCEOApproval(command, plan = {}) {",
    "  const text = String(command || '').toLowerCase().replace(/\\s+/g, ' ').trim();",
    "  const action = String(plan.action || '').toUpperCase();",
    "  const protectedActions = new Set([",
    "    'CHANGE_PRICING',",
    "    'PRICING_CHANGE',",
    "    'SEND_PROPOSAL',",
    "    'SUBMIT_PROPOSAL',",
    "    'SIGN_AGREEMENT',",
    "    'SIGN_CONTRACT',",
    "    'HIRE',",
    "    'FIRE',",
    "    'DELETE_PRODUCTION_DATA',",
    "    'MAKE_FINANCIAL_COMMITMENT'",
    "  ]);",
    "  if (protectedActions.has(action)) return true;",
    "  return [",
    "    /\\b(change|set|increase|decrease|discount|override)\\s+(our\\s+)?pricing\\b/ ,".replace(' / ,','/,'),
    "    /\\b(send|submit|deliver)\\s+(the\\s+|a\\s+)?(final\\s+)?proposal\\b/ ,".replace(' / ,','/,'),
    "    /\\b(sign|execute)\\s+(the\\s+|a\\s+|an\\s+)?(agreement|contract|legal document)\\b/ ,".replace(' / ,','/,'),
    "    /\\b(hire|fire|terminate)\\s+(an?\\s+|the\\s+)?(employee|contractor|staff|person|worker)\\b/ ,".replace(' / ,','/,'),
    "    /\\b(delete|drop|destroy|purge)\\s+(production\\s+)?(database|records?|data|campaign|account|repository|repo)\\b/ ,".replace(' / ,','/,'),
    "    /\\b(make|approve|authorize|commit|spend|purchase|pay)\\b.{0,60}\\b(financial commitment|payment|expense|purchase|spend|budget)\\b/",
    "  ].some(pattern => pattern.test(text));",
    "}",
    "",
    "function governanceForCommand(command, plan = {}) {",
    "  const provider = normalizeProvider(plan.provider || 'MILES');",
    "  const action = plan.action || plan.capability || 'BUSINESS_EXECUTION';",
    "  const capability = plan.capability || action;",
    "  const connector = plan.connector || provider;",
    "  const taskLike = {",
    "    type: action,",
    "    action,",
    "    provider,",
    "    connector,",
    "    intent: plan.intent || null,",
    "    workflow: plan.workflow || null,",
    "    title: String(command || '').slice(0, 160),",
    "    command,",
    "    objective: plan.objective || command,",
    "    payload: {",
    "      provider,",
    "      connector,",
    "      action,",
    "      capability,",
    "      intent: plan.intent || null,",
    "      workflow: plan.workflow || null,",
    "      command,",
    "      objective: plan.objective || command,",
    "      plan: {",
    "        ...plan,",
    "        provider,",
    "        connector,",
    "        action,",
    "        capability,",
    "        originalCommand: plan.originalCommand || command,",
    "        objective: plan.objective || command",
    "      }",
    "    }",
    "  };",
    "  try {",
    "    return policyEngine.evaluate(taskLike, { actor: 'MILES_COMMAND_CENTER', role: 'MILES' });",
    "  } catch (error) {",
    "    return {",
    "      ok: false,",
    "      evaluated: false,",
    "      decision: 'ALLOW',",
    "      approvalRequired: legacyRequiresCEOApproval(command, plan),",
    "      approver: 'CEO',",
    "      risk: 'UNKNOWN',",
    "      reason: 'Command-center governance evaluation failed: ' + error.message,",
    "      evaluationError: error.message",
    "    };",
    "  }",
    "}"
  ]);

  patch = replaceBetween(
    result,
    'function requiresCEOApproval(command, plan = {}) {',
    'function makeOperation(command, suppliedPlan = null) {',
    approvalFunctions,
    'approval-functions'
  );
  result = patch.source;
  changed ||= patch.changed;

  patch = replaceRequired(
    result,
    "  const action = plan.action || plan.capability || 'BUSINESS_EXECUTION';\n  const approvalRequired = requiresCEOApproval(command, plan);\n",
    "  const action = plan.action || plan.capability || 'BUSINESS_EXECUTION';\n  const policy = governanceForCommand(command, plan);\n  const approvalRequired = policy.evaluated === false\n    ? legacyRequiresCEOApproval(command, plan)\n    : policy.approvalRequired === true;\n  const governance = {\n    policy,\n    approval: { approved: false, approver: policy.approver || 'CEO', approvedAt: null }\n  };\n",
    'make-operation-policy'
  );
  result = patch.source;
  changed ||= patch.changed;

  patch = replaceRequired(
    result,
    "    approvalRequired,\n    ceoEscalationOnly: approvalRequired,\n    createdAt: now(),",
    "    approvalRequired,\n    ceoEscalationOnly: approvalRequired,\n    approvalReason: approvalRequired ? (policy.reason || 'CEO approval required by canonical governance policy.') : null,\n    risk: policy.risk || 'UNKNOWN',\n    governance,\n    createdAt: now(),",
    'operation-governance-metadata'
  );
  result = patch.source;
  changed ||= patch.changed;

  patch = replaceRequired(
    result,
    "  const operation = makeOperation(clean, plan);\n  saveOperation(operation);\n\n  if (operation.approvalRequired) {",
    "  const operation = makeOperation(clean, plan);\n  saveOperation(operation);\n\n  if (operation.governance?.policy?.decision === 'DENY') {\n    const blocked = updateOperation(operation.id, {\n      status: 'BLOCKED',\n      blockedAt: now(),\n      error: operation.governance.policy.reason || 'Governance denied this operation.'\n    });\n    return {\n      ok: false,\n      status: 'GOVERNANCE_DENIED',\n      message: blocked.error,\n      operation: blocked,\n      enqueueResult: { ok: false, status: 'GOVERNANCE_DENIED', operationId: operation.id, taskId: null }\n    };\n  }\n\n  if (operation.approvalRequired) {",
    'deny-before-bridge'
  );
  result = patch.source;
  changed ||= patch.changed;

  const reconciliation = lines([
    "function runtimeApprovalTasks() {",
    "  try {",
    "    if (!fs.existsSync(TASK_QUEUE_FILE)) return [];",
    "    const text = fs.readFileSync(TASK_QUEUE_FILE, 'utf8').replace(/^\\uFEFF/, '').trim();",
    "    const tasks = text ? JSON.parse(text) : [];",
    "    if (!Array.isArray(tasks)) return [];",
    "    return tasks.filter(task =>",
    "      ['AWAITING_APPROVAL', 'AWAITING_CEO_APPROVAL', 'WAITING_FOR_CEO_APPROVAL']",
    "        .includes(String(task?.status || '').toUpperCase())",
    "    );",
    "  } catch {",
    "    return [];",
    "  }",
    "}",
    "",
    "function runtimeTaskSourceOperationId(task = {}) {",
    "  const payload = task.payload || {};",
    "  return payload.sourceOperationId || payload.operationId || payload.businessOperationId || null;",
    "}",
    "",
    "function reconcileRuntimeApprovals() {",
    "  const runtimeTasks = runtimeApprovalTasks();",
    "  if (!runtimeTasks.length) return { changed: 0, runtimePending: 0 };",
    "  const queue = queueState();",
    "  const byId = new Map(queue.operations.filter(Boolean).map(operation => [operation.id, operation]));",
    "  let changed = 0;",
    "",
    "  for (const task of runtimeTasks) {",
    "    const sourceOperationId = runtimeTaskSourceOperationId(task);",
    "    if (!sourceOperationId) continue;",
    "    const operation = byId.get(sourceOperationId);",
    "    if (!operation) continue;",
    "    const operationStatus = String(operation.status || '').toUpperCase();",
    "    if (['COMPLETED', 'REJECTED', 'CANCELLED', 'BLOCKED'].includes(operationStatus)) continue;",
    "",
    "    const policy = task.governance?.policy || task.payload?.governance?.policy || null;",
    "    const approval = task.governance?.approval || task.payload?.governance?.approval || null;",
    "    const reason = approval?.reason || policy?.reason || task.error || 'Worker runtime requires CEO approval.';",
    "",
    "    if (",
    "      operationStatus !== 'AWAITING_APPROVAL' ||",
    "      operation.runtimeTaskId !== task.id ||",
    "      operation.approvalReason !== reason",
    "    ) {",
    "      Object.assign(operation, {",
    "        status: 'AWAITING_APPROVAL',",
    "        approvalRequired: true,",
    "        ceoEscalationOnly: true,",
    "        approvalSource: 'WORKER_RUNTIME',",
    "        runtimeTaskId: task.id,",
    "        taskId: operation.taskId || task.id,",
    "        taskQueueStatus: 'AWAITING_APPROVAL',",
    "        approvalReason: reason,",
    "        risk: policy?.risk || operation.risk || 'UNKNOWN',",
    "        governance: task.governance || task.payload?.governance || operation.governance || null,",
    "        updatedAt: now()",
    "      });",
    "      changed += 1;",
    "    }",
    "  }",
    "",
    "  if (changed) {",
    "    queue.generatedAt = now();",
    "    queue.source = 'MILES_COMMAND_CENTER';",
    "    writeJson(QUEUE_FILE, queue);",
    "  }",
    "  return { changed, runtimePending: runtimeTasks.length };",
    "}"
  ]);

  if (!result.includes('function reconcileRuntimeApprovals()')) {
    if (!result.includes('function healthPayload() {')) {
      throw new Error('PATCH_ANCHOR_NOT_FOUND: runtime-reconciliation');
    }
    result = result.replace('function healthPayload() {', reconciliation + '\n\nfunction healthPayload() {');
    changed = true;
  }

  patch = replaceRequired(
    result,
    "function dashboardPayload() {\n  const operationSnapshot = dashboardOperationSnapshot();",
    "function dashboardPayload() {\n  reconcileRuntimeApprovals();\n  const operationSnapshot = dashboardOperationSnapshot();",
    'dashboard-reconcile'
  );
  result = patch.source;
  changed ||= patch.changed;

  patch = replaceRequired(
    result,
    "function operationResponse(operationId) {\n  return executiveResponses.getResponse(operationId);\n}",
    "function operationResponse(operationId) {\n  reconcileRuntimeApprovals();\n  return executiveResponses.getResponse(operationId);\n}",
    'mission-reconcile'
  );
  result = patch.source;
  changed ||= patch.changed;

  const approveFunction = lines([
    "function approveOperation(operationId, reason = '') {",
    "  reconcileRuntimeApprovals();",
    "  const queue = queueState();",
    "  const operation = queue.operations.find(item => item && item.id === operationId);",
    "  if (!operation) return { ok: false, status: 'NOT_FOUND', operationId };",
    "  if (!['AWAITING_APPROVAL', 'WAITING_FOR_CEO_APPROVAL', 'AWAITING_CEO_APPROVAL'].includes(String(operation.status || '').toUpperCase())) {",
    "    return { ok: false, status: 'INVALID_STATUS', operationId, currentStatus: operation.status };",
    "  }",
    "",
    "  const approvedAt = now();",
    "  const approval = {",
    "    approved: true,",
    "    approver: 'CEO',",
    "    approvedAt,",
    "    reason: reason || operation.approvalReason || ''",
    "  };",
    "  const governance = { ...(operation.governance || {}), approval };",
    "",
    "  const approved = updateOperation(operationId, {",
    "    status: operation.runtimeTaskId ? 'BRIDGED' : 'READY',",
    "    approvalDecision: 'APPROVED',",
    "    approvedBy: 'CEO',",
    "    approvedAt,",
    "    approvalReason: reason || operation.approvalReason || '',",
    "    approval,",
    "    governance,",
    "    taskQueueStatus: operation.runtimeTaskId ? 'QUEUED' : operation.taskQueueStatus",
    "  });",
    "",
    "  if (operation.runtimeTaskId) {",
    "    try {",
    "      const runtimeTask = typeof taskQueue.list === 'function'",
    "        ? taskQueue.list().find(item => item && item.id === operation.runtimeTaskId)",
    "        : null;",
    "      if (!runtimeTask) throw new Error('Runtime task not found: ' + operation.runtimeTaskId);",
    "      const runtimeGovernance = {",
    "        ...(runtimeTask.governance || runtimeTask.payload?.governance || {}),",
    "        approval",
    "      };",
    "      const payload = {",
    "        ...(runtimeTask.payload || {}),",
    "        approval,",
    "        governance: runtimeGovernance",
    "      };",
    "      taskQueue.update(operation.runtimeTaskId, {",
    "        status: 'QUEUED',",
    "        approval,",
    "        governance: runtimeGovernance,",
    "        payload,",
    "        error: null,",
    "        resumedFromApprovalAt: approvedAt",
    "      });",
    "      const resumed = updateOperation(operationId, {",
    "        status: 'BRIDGED',",
    "        taskQueueStatus: 'QUEUED',",
    "        runtimeApprovalResumedAt: approvedAt",
    "      });",
    "      return {",
    "        ok: true,",
    "        status: 'APPROVED_AND_RESUMED',",
    "        operation: resumed || approved,",
    "        enqueueResult: {",
    "          ok: true,",
    "          status: 'RUNTIME_TASK_RESUMED',",
    "          operationId,",
    "          taskId: operation.runtimeTaskId",
    "        }",
    "      };",
    "    } catch (error) {",
    "      updateOperation(operationId, { status: 'APPROVAL_RESUME_FAILED', error: error.message });",
    "      return { ok: false, status: 'APPROVAL_RESUME_FAILED', operationId, error: error.message };",
    "    }",
    "  }",
    "",
    "  try {",
    "    const enqueueResult = bridgeOperation(approved);",
    "    return {",
    "      ok: enqueueResult.ok,",
    "      status: enqueueResult.ok ? 'APPROVED_AND_BRIDGED' : 'APPROVED_BRIDGE_FAILED',",
    "      operation: enqueueResult.operation,",
    "      enqueueResult",
    "    };",
    "  } catch (error) {",
    "    updateOperation(operationId, { status: 'BRIDGE_FAILED', error: error.message });",
    "    return { ok: false, status: 'APPROVED_BRIDGE_FAILED', operationId, error: error.message };",
    "  }",
    "}"
  ]);

  patch = replaceBetween(
    result,
    "function approveOperation(operationId, reason = '') {",
    "function rejectOperation(operationId, reason = '') {",
    approveFunction,
    'approve-operation'
  );
  result = patch.source;
  changed ||= patch.changed;

  const rejectFunction = lines([
    "function rejectOperation(operationId, reason = '') {",
    "  reconcileRuntimeApprovals();",
    "  const existing = queueState().operations.find(item => item && item.id === operationId);",
    "  if (existing?.runtimeTaskId && typeof taskQueue.update === 'function') {",
    "    try {",
    "      taskQueue.update(existing.runtimeTaskId, {",
    "        status: 'REJECTED',",
    "        rejectedBy: 'CEO',",
    "        rejectedAt: now(),",
    "        rejectionReason: reason || ''",
    "      });",
    "    } catch {}",
    "  }",
    "  const operation = updateOperation(operationId, {",
    "    status: 'REJECTED',",
    "    approvalDecision: 'REJECTED',",
    "    rejectedBy: 'CEO',",
    "    rejectedAt: now(),",
    "    approvalReason: reason",
    "  });",
    "  return operation",
    "    ? { ok: true, status: 'REJECTED', operation }",
    "    : { ok: false, status: 'NOT_FOUND', operationId };",
    "}"
  ]);

  patch = replaceBetween(
    result,
    "function rejectOperation(operationId, reason = '') {",
    "const server = http.createServer(async (req, res) => {",
    rejectFunction,
    'reject-operation'
  );
  result = patch.source;
  changed ||= patch.changed;

  return { content: result, changed };
}

function patchCeoJs(source) {
  let result = source;
  let changed = false;

  const oldLink = '<a class="product-action secondary-action" href="/execution" target="_blank" rel="noopener">View Mission</a>';
  const newLink = '<a class="product-action secondary-action" href="/execution?operationId=${encodeURIComponent(operationId)}" target="_blank" rel="noopener">View Mission</a>';
  if (!result.includes(newLink)) {
    if (!result.includes(oldLink)) throw new Error('PATCH_ANCHOR_NOT_FOUND: view-mission-link');
    result = result.replace(oldLink, newLink);
    changed = true;
  }

  const oldAlert = 'alerts.unshift({ severity:"INFO", title:"Worker runtime approval backlog"';
  const newAlert = 'alerts.unshift({ severity:"WARNING", title:"Worker runtime approval backlog"';
  if (result.includes(oldAlert)) {
    result = result.replace(oldAlert, newAlert);
    changed = true;
  }

  return { content: result, changed };
}

function patchExecutionApp(source) {
  let result = source;
  let changed = false;

  const oldTail = lines([
    'setBadge("READY");',
    'elements.systemStatus.textContent = "Miles is ready";',
    'loadApprovalQueue();',
    'approvalRefreshTimer = setInterval(loadApprovalQueue, 5000);'
  ]);

  const newTail = lines([
    'const initialParams = new URLSearchParams(window.location.search);',
    'const initialOperationId = initialParams.get("operationId") || initialParams.get("missionId");',
    'if (initialOperationId) {',
    '  currentOperationId = initialOperationId;',
    '  setBadge("LOADING");',
    '  elements.systemStatus.textContent = "Loading selected mission";',
    '  startPolling(initialOperationId);',
    '} else {',
    '  setBadge("READY");',
    '  elements.systemStatus.textContent = "Miles is ready";',
    '}',
    'loadApprovalQueue();',
    'approvalRefreshTimer = setInterval(loadApprovalQueue, 5000);'
  ]);

  if (!result.includes(newTail)) {
    if (!result.includes(oldTail)) throw new Error('PATCH_ANCHOR_NOT_FOUND: execution-query-bootstrap');
    result = result.replace(oldTail, newTail);
    changed = true;
  }

  return { content: result, changed };
}

const targets = [
  ['SERVICES/digital_coo/MilesCommandCenter.js', patchCommandCenter],
  ['SERVICES/ceo_dashboard/public/ceo.js', patchCeoJs],
  ['SERVICES/digital_coo/public/app.js', patchExecutionApp]
];

const results = [];
for (const [rel, patcher] of targets) {
  const original = read(rel);
  const patched = patcher(original);
  results.push({ file: rel, changed: patched.changed });
  if (APPLY && patched.changed) {
    backup(rel);
    write(rel, patched.content);
  }
}

for (const result of results) {
  console.log(`${APPLY ? 'APPLY' : 'CHECK'} ${result.file}: ${result.changed ? 'CHANGE_REQUIRED' : 'ALREADY_FIXED'}`);
}

if (!APPLY) {
  console.log('DRY_RUN_ONLY=TRUE');
  console.log('Run with --apply after reviewing the results.');
} else {
  console.log(`BACKUP_DIR=${backupDir}`);
  console.log('REPAIR_APPLIED=TRUE');
}
