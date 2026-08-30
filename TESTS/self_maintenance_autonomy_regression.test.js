'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const planner = require('../SERVICES/CommandIntentPlannerService');
const dispatcher = require('../SERVICES/CapabilityDispatcherService');
const policyEngine = require('../SERVICES/governance/PolicyEngineService');

function taskFor(action, command) {
  return {
    type: action,
    action,
    provider: 'MILES',
    system: 'MILES',
    connector: 'MILES',
    title: command,
    command,
    objective: command,
    payload: {
      provider: 'MILES',
      system: 'MILES',
      connector: 'MILES',
      action,
      capability: action,
      command,
      objective: command,
      plan: {
        provider: 'MILES',
        system: 'MILES',
        connector: 'MILES',
        action,
        capability: action,
        workflow: action,
        intent: 'ENGINEERING',
        originalCommand: command,
        objective: command
      }
    }
  };
}

// Exact COO self-maintenance actions must route as self-maintenance, not generic business execution.
for (const action of [
  'SELF_MAINTENANCE',
  'SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS',
  'SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS'
]) {
  const plan = planner.plan({ command: `Miles, run ${action}.` });
  assert.strictEqual(plan.action, action, `${action} must remain explicit`);
  assert.strictEqual(plan.intent, 'ENGINEERING', `${action} must be engineering intent`);

  const route = dispatcher.resolve(taskFor(action, action), {
    action,
    capability: action,
    workflow: action,
    provider: 'MILES'
  });
  assert.strictEqual(route.resolved, true, `${action} must resolve`);
  assert.strictEqual(route.serviceName, 'SelfMaintenanceService', `${action} must route to SelfMaintenanceService`);
}

// Bounded self-maintenance must not require CEO approval simply because its structured action contains maintenance/reconcile semantics.
const auditPolicy = policyEngine.evaluate(
  taskFor(
    'SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS',
    'Audit the worker runtime approval backlog and report classifications.'
  ),
  { actor: 'MILES_SELF_MAINTENANCE', role: 'MILES' }
);
assert.strictEqual(auditPolicy.decision, 'ALLOW');
assert.strictEqual(auditPolicy.approvalRequired, false);
assert.strictEqual(auditPolicy.matches.governedSelfMaintenance, true);

const reconcilePolicy = policyEngine.evaluate(
  taskFor(
    'SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS',
    'Reconcile stale false runtime approval records using the bounded maintenance policy.'
  ),
  { actor: 'MILES_SELF_MAINTENANCE', role: 'MILES' }
);
assert.strictEqual(reconcilePolicy.decision, 'ALLOW');
assert.strictEqual(reconcilePolicy.approvalRequired, false);
assert.strictEqual(reconcilePolicy.matches.governedSelfMaintenance, true);

// Explicit protected CEO actions embedded in a maintenance request stay protected.
const protectedPolicy = policyEngine.evaluate(
  taskFor(
    'SELF_MAINTENANCE',
    'Delete production data.'
  ),
  { actor: 'MILES_SELF_MAINTENANCE', role: 'MILES' }
);
assert.strictEqual(protectedPolicy.decision, 'REQUIRE_APPROVAL');
assert.strictEqual(protectedPolicy.approvalRequired, true);
assert.strictEqual(protectedPolicy.matches.proseApprovalPattern, 'DELETE');

// Source guardrails: reconciliation may cancel only proven stale/terminal approvals and must never auto-approve/resume/delete.
const source = fs.readFileSync(
  path.join(__dirname, '..', 'SERVICES', 'SelfMaintenanceService.js'),
  'utf8'
);
assert(source.includes('onlyCancelledClassifications'));
assert(source.includes('STALE_FALSE_APPROVAL'));
assert(source.includes('TERMINAL_SOURCE'));
assert(source.includes('approvalsGranted: 0'));
assert(source.includes('tasksResumed: 0'));
assert(source.includes('tasksDeleted: 0'));
assert(source.includes('ORPHANED_NO_SOURCE_ID'));
assert(source.includes('ORPHANED_SOURCE_NOT_FOUND'));
assert(source.includes('CANONICAL_APPROVAL_REQUIRED'));

console.log('SELF_MAINTENANCE_AUTONOMY_REGRESSION_PASS');
