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

function patchCommandCenter(source) {
  let result = source;
  let changed = false;

  let patch = replaceRequired(
    result,
    "const taskQueue = require('../../CORE/TaskQueue');\n",
    "const taskQueue = require('../../CORE/TaskQueue');\nconst policyEngine = require('../governance/PolicyEngineService');\n",
    'policy-engine-import'
  );
  result = patch.source; changed ||= patch.changed;

  const legacyBlock = `function requiresCEOApproval(command, plan = {}) {\n  const text = String(command || '').toLowerCase().replace(/\\s+/g, ' ').trim();\n  const action = String(plan.action || '').toUpperCase();\n  const protectedActions = new Set([\n    'CHANGE_PRICING',\n    'PRICING_CHANGE',\n    'SEND_PROPOSAL',\n    'SUBMIT_PROPOSAL',\n    'SIGN_AGREEMENT',\n    'SIGN_CONTRACT',\n    'HIRE',\n    'FIRE',\n    'DELETE_PRODUCTION_DATA',\n    'MAKE_FINANCIAL_COMMITMENT'\n  ]);\n  if (protectedActions.has(action)) return true;\n  return [\n    /\\b(change|set|increase|decrease|discount|override)\\s+(our\\s+)?pricing\\b/,\n    /\\b(send|submit|deliver)\\s+(the\\s+|a\\s+)?(final\\s+)?proposal\\b/,\n    /\\b(sign|execute)\\s+(the\\s+|a\\s+|an\\s+)?(agreement|contract|legal document)\\b/,\n    /\\b(hire|fire|terminate)\\s+(an?\\s+|the\\s+)?(employee|contractor|staff|person|worker)\\b/,\n    /\\b(delete|drop|destroy|purge)\\s+(production\\s+)?(database|records?|data|campaign|account|repository|repo)\\b/,\n    /\\b(make|approve|authorize|commit|spend|purchase|pay)\\b.{0,60}\\b(financial commitment|payment|expense|purchase|spend|budget)\\b/\n  ].some(pattern => pattern.test(text));\n}\n`;

  const unifiedBlock = `function legacyRequiresCEOApproval(command, plan = {}) {\n  const text = String(command || '').toLowerCase().replace(/\\s+/g, ' ').trim();\n  const action = String(plan.action || '').toUpperCase();\n  const protectedActions = new Set([\n    'CHANGE_PRICING', 'PRICING_CHANGE', 'SEND_PROPOSAL', 'SUBMIT_PROPOSAL',\n    'SIGN_AGREEMENT', 'SIGN_CONTRACT', 'HIRE', 'FIRE',\n    'DELETE_PRODUCTION_DATA', 'MAKE_FINANCIAL_COMMITMENT'\n  ]);\n  if (protectedActions.has(action)) return true;\n  return [\n    /\\b(change|set|increase|decrease|discount|override)\\s+(our\\s+)?pricing\\b/,\n    /\\b(send|submit|deliver)\\s+(the\\s+|a\\s+)?(final\\s+)?proposal\\b/,\n    /\\b(sign|execute)\\s+(the\\s+|a\\s+|an\\s+)?(agreement|contract|legal document)\\b/,\n    /\\b(hire|fire|terminate)\\s+(an?\\s+|the\\s+)?(employee|contractor|staff|person|worker)\\b/,\n    /\\b(delete|drop|destroy|purge)\\s+(production\\s+)?(database|records?|data|campaign|account|repository|repo)\\b/,\n    /\\b(make|approve|authorize|commit|spend|purchase|pay)\\b.{0,60}\\b(financial commitment|payment|expense|purchase|spend|budget)\\b/\n  ].some(pattern => pattern.test(text));\n}\n\nfunction governanceForCommand(command, plan = {}) {\n  const provider = normalizeProvider(plan.provider || 'MILES');\n  const action = plan.action || plan.capability || 'BUSINESS_EXECUTION';\n  const capability = plan.capability || action;\n  const taskLike = {\n    type: action, action, provider, connector: plan.connector || provider,\n    intent: plan.intent || null, workflow: plan.workflow || null,\n    title: String(command || '').slice(0, 160), command, objective: plan.objective || command,\n    payload: {\n      provider, connector: plan.connector || provider, action, capability,\n      intent: plan.intent || null, workflow: plan.workflow || null,\n      command, objective: plan.objective || command,\n      plan: { ...plan, provider, connector: plan.connector || provider, action, capability, originalCommand: plan.originalCommand || command, objective: plan.objective || command }\n    }\n  };\n  try {\n    return policyEngine.evaluate(taskLike, { actor: 'MILES_COMMAND_CENTER', role: 'MILES' });\n  } catch (error) {\n    return { ok: false, evaluated: false, decision: 'ALLOW', approvalRequired: legacyRequiresCEOApproval(command, plan), approver: 'CEO', risk: 'UNKNOWN', reason: \\`Command-center governance evaluation failed: \\${error.message}\\`, evaluationError: error.message };\n  }\n}\n`;

  patch = replaceRequired(result, legacyBlock, unifiedBlock, 'unified-approval-policy');
  result = patch.source; changed ||= patch.changed;

  patch = replaceRequired(
    result,
    "  const action = plan.action || plan.capability || 'BUSINESS_EXECUTION';\n  const approvalRequired = requiresCEOApproval(command, plan);\n\n  return {\n",
    "  const action = plan.action || plan.capability || 'BUSINESS_EXECUTION';\n  const policy = governanceForCommand(command, plan);\n  const approvalRequired = legacyRequiresCEOApproval(command, plan) || policy.approvalRequired === true;\n  const governance = { policy, approval: { approved: false, approver: policy.approver || 'CEO', approvedAt: null } };\n\n  return {\n",
    'make-operation-policy'
  );
  result = patch.source; changed ||= patch.changed;

  patch = replaceRequired(
    result,
    "    approvalRequired,\n    ceoEscalationOnly: approvalRequired,\n",
    "    approvalRequired,\n    ceoEscalationOnly: approvalRequired,\n    approvalReason: approvalRequired ? (policy.reason || 'CEO approval required by canonical governance policy.') : null,\n    risk: policy.risk || 'UNKNOWN',\n    governance,\n",
    'operation-governance-metadata'
  );
  result = patch.source; changed ||= patch.changed;

  patch = replaceRequired(
    result,
    "  const operation = makeOperation(clean, plan);\n  saveOperation(operation);\n\n  if (operation.approvalRequired) {\n",
    "  const operation = makeOperation(clean, plan);\n  saveOperation(operation);\n\n  if (operation.governance?.policy?.decision === 'DENY') {\n    const blocked = updateOperation(operation.id, { status: 'BLOCKED', blockedAt: now(), error: operation.governance.policy.reason || 'Governance denied this operation.' });\n    return { ok: false, status: 'GOVERNANCE_DENIED', message: blocked.error, operation: blocked, enqueueResult: { ok: false, status: 'GOVERNANCE_DENIED', operationId: operation.id, taskId: null } };\n  }\n\n  if (operation.approvalRequired) {\n",
    'deny-before-bridge'
  );
  result = patch.source; changed ||= patch.changed;

  const healthAnchor = "function healthPayload() {\n";
  const reconcileBlock = `function runtimeApprovalTasks() {\n  try {\n    if (!fs.existsSync(TASK_QUEUE_FILE)) return [];\n    const text = fs.readFileSync(TASK_QUEUE_FILE, 'utf8').replace(/^\\uFEFF/, '').trim();\n    const tasks = text ? JSON.parse(text) : [];\n    if (!Array.isArray(tasks)) return [];\n    return tasks.filter(task => ['AWAITING_APPROVAL', 'AWAITING_CEO_APPROVAL'].includes(String(task?.status || '').toUpperCase()));\n  } catch { return []; }\n}\n\nfunction runtimeTaskSourceOperationId(task = {}) {\n  const payload = task.payload || {};\n  return payload.sourceOperationId || payload.operationId || payload.businessOperationId || null;\n}\n\nfunction reconcileRuntimeApprovals() {\n  const runtimeTasks = runtimeApprovalTasks();\n  if (!runtimeTasks.length) return { changed: 0, runtimePending: 0 };\n  const queue = queueState();\n  const byId = new Map(queue.operations.filter(Boolean).map(operation => [operation.id, operation]));\n  let changed = 0;\n  for (const task of runtimeTasks) {\n    const sourceOperationId = runtimeTaskSourceOperationId(task);\n    if (!sourceOperationId) continue;\n    const operation = byId.get(sourceOperationId);\n    if (!operation) continue;\n    const operationStatus = String(operation.status || '').toUpperCase();\n    if (['COMPLETED', 'REJECTED', 'CANCELLED', 'BLOCKED'].includes(operationStatus)) continue;\n    const policy = task.governance?.policy || task.payload?.governance?.policy || null;\n    const approval = task.governance?.approval || task.payload?.governance?.approval || null;\n    const reason = approval?.reason || policy?.reason || task.error || 'Worker runtime requires CEO approval.';\n    if (operationStatus !== 'AWAITING_APPROVAL' || operation.runtimeTaskId !== task.id || operation.approvalReason !== reason) {\n      Object.assign(operation, { status: 'AWAITING_APPROVAL', approvalRequired: true, ceoEscalationOnly: true, approvalSource: 'WORKER_RUNTIME', runtimeTaskId: task.id, taskId: operation.taskId || task.id, taskQueueStatus: 'AWAITING_APPROVAL', approvalReason: reason, risk: policy?.risk || operation.risk || 'UNKNOWN', governance: task.governance || task.payload?.governance || operation.governance || null, updatedAt: now() });\n      changed += 1;\n    }\n  }\n  if (changed) { queue.generatedAt = now(); queue.source = 'MILES_COMMAND_CENTER'; writeJson(QUEUE_FILE, queue); }\n  return { changed, runtimePending: runtimeTasks.length };\n}\n\n`;
  if (!result.includes('function reconcileRuntimeApprovals()')) {
    if (!result.includes(healthAnchor)) throw new Error('PATCH_ANCHOR_NOT_FOUND: runtime-reconciliation');
    result = result.replace(healthAnchor, reconcileBlock + healthAnchor);
    changed = true;
  }

  patch = replaceRequired(result, "function dashboardPayload() {\n  const operationSnapshot = dashboardOperationSnapshot();", "function dashboardPayload() {\n  reconcileRuntimeApprovals();\n  const operationSnapshot = dashboardOperationSnapshot();", 'dashboard-reconcile');
  result = patch.source; changed ||= patch.changed;

  patch = replaceRequired(result, "function operationResponse(operationId) {\n  return executiveResponses.getResponse(operationId);\n}", "function operationResponse(operationId) {\n  reconcileRuntimeApprovals();\n  return executiveResponses.getResponse(operationId);\n}", 'mission-reconcile');
  result = patch.source; changed ||= patch.changed;

  const approveStart = result.indexOf("function approveOperation(operationId, reason = '') {");
  const rejectStart = result.indexOf("\nfunction rejectOperation(operationId, reason = '') {", approveStart);
  if (approveStart < 0 || rejectStart < 0) throw new Error('PATCH_ANCHOR_NOT_FOUND: approveOperation');
  if (!result.slice(approveStart, rejectStart).includes('APPROVED_AND_RESUMED')) {
    const replacement = `function approveOperation(operationId, reason = '') {\n  reconcileRuntimeApprovals();\n  const queue = queueState();\n  const operation = queue.operations.find(item => item && item.id === operationId);\n  if (!operation) return { ok: false, status: 'NOT_FOUND', operationId };\n  if (!['AWAITING_APPROVAL', 'WAITING_FOR_CEO_APPROVAL', 'AWAITING_CEO_APPROVAL'].includes(String(operation.status || '').toUpperCase())) return { ok: false, status: 'INVALID_STATUS', operationId, currentStatus: operation.status };\n  const approvedAt = now();\n  const approval = { approved: true, approver: 'CEO', approvedAt, reason: reason || operation.approvalReason || '' };\n  const governance = { ...(operation.governance || {}), approval };\n  const approved = updateOperation(operationId, { status: operation.runtimeTaskId ? 'BRIDGED' : 'READY', approvalDecision: 'APPROVED', approvedBy: 'CEO', approvedAt, approvalReason: reason || operation.approvalReason || '', approval, governance, taskQueueStatus: operation.runtimeTaskId ? 'QUEUED' : operation.taskQueueStatus });\n  if (operation.runtimeTaskId) {\n    try {\n      const runtimeTask = typeof taskQueue.list === 'function' ? taskQueue.list().find(item => item && item.id === operation.runtimeTaskId) : null;\n      if (!runtimeTask) throw new Error(\\`Runtime task not found: \\${operation.runtimeTaskId}\\`);\n      const runtimeGovernance = { ...(runtimeTask.governance || runtimeTask.payload?.governance || {}), approval };\n      const payload = { ...(runtimeTask.payload || {}), approval, governance: runtimeGovernance };\n      taskQueue.update(operation.runtimeTaskId, { status: 'QUEUED', approval, governance: runtimeGovernance, payload, error: null, resumedFromApprovalAt: approvedAt });\n      const resumed = updateOperation(operationId, { status: 'BRIDGED', taskQueueStatus: 'QUEUED', runtimeApprovalResumedAt: approvedAt });\n      return { ok: true, status: 'APPROVED_AND_RESUMED', operation: resumed || approved, enqueueResult: { ok: true, status: 'RUNTIME_TASK_RESUMED', operationId, taskId: operation.runtimeTaskId } };\n    } catch (error) {\n      updateOperation(operationId, { status: 'APPROVAL_RESUME_FAILED', error: error.message });\n      return { ok: false, status: 'APPROVAL_RESUME_FAILED', operationId, error: error.message };\n    }\n  }\n  try {\n    const enqueueResult = bridgeOperation(approved);\n    return { ok: enqueueResult.ok, status: enqueueResult.ok ? 'APPROVED_AND_BRIDGED' : 'APPROVED_BRIDGE_FAILED', operation: enqueueResult.operation, enqueueResult };\n  } catch (error) {\n    updateOperation(operationId, { status: 'BRIDGE_FAILED', error: error.message });\n    return { ok: false, status: 'APPROVED_BRIDGE_FAILED', operationId, error: error.message };\n  }\n}\n`;
    result = result.slice(0, approveStart) + replacement + result.slice(rejectStart);
    changed = true;
  }

  patch = replaceRequired(result, "function rejectOperation(operationId, reason = '') {\n  const operation = updateOperation(operationId, {", "function rejectOperation(operationId, reason = '') {\n  reconcileRuntimeApprovals();\n  const existing = queueState().operations.find(item => item && item.id === operationId);\n  if (existing?.runtimeTaskId && typeof taskQueue.update === 'function') {\n    try { taskQueue.update(existing.runtimeTaskId, { status: 'REJECTED', rejectedBy: 'CEO', rejectedAt: now(), rejectionReason: reason || '' }); } catch {}\n  }\n  const operation = updateOperation(operationId, {", 'reject-runtime-task');
  result = patch.source; changed ||= patch.changed;

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
  if (result.includes(oldAlert)) { result = result.replace(oldAlert, newAlert); changed = true; }
  return { content: result, changed };
}

function patchExecutionApp(source) {
  let result = source;
  let changed = false;
  const oldTail = 'setBadge("READY");\nelements.systemStatus.textContent = "Miles is ready";\nloadApprovalQueue();\napprovalRefreshTimer = setInterval(loadApprovalQueue, 5000);';
  const newTail = 'const initialOperationId = new URLSearchParams(window.location.search).get("operationId") || new URLSearchParams(window.location.search).get("missionId");\nif (initialOperationId) {\n  currentOperationId = initialOperationId;\n  setBadge("LOADING");\n  elements.systemStatus.textContent = "Loading selected mission";\n  startPolling(initialOperationId);\n} else {\n  setBadge("READY");\n  elements.systemStatus.textContent = "Miles is ready";\n}\nloadApprovalQueue();\napprovalRefreshTimer = setInterval(loadApprovalQueue, 5000);';
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

for (const result of results) console.log(`${APPLY ? 'APPLY' : 'CHECK'} ${result.file}: ${result.changed ? 'CHANGE_REQUIRED' : 'ALREADY_FIXED'}`);

if (!APPLY) {
  console.log('DRY_RUN_ONLY=TRUE');
  console.log('Run with --apply after reviewing the results.');
} else {
  console.log(`BACKUP_DIR=${backupDir}`);
  console.log('REPAIR_APPLIED=TRUE');
}
