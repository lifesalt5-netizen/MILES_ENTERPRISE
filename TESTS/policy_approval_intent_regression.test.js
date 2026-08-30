'use strict';

const assert = require('assert');
const policyEngine = require('../SERVICES/governance/PolicyEngineService');

function task(command, action = 'BUSINESS_EXECUTION') {
  return {
    type: action,
    action,
    provider: 'MILES',
    connector: 'MILES',
    command,
    objective: command,
    payload: {
      action,
      capability: action,
      provider: 'MILES',
      connector: 'MILES',
      command,
      objective: command,
      plan: {
        action,
        capability: action,
        provider: 'MILES',
        connector: 'MILES',
        originalCommand: command,
        objective: command
      }
    }
  };
}

const narrativeCases = [
  'MILES — STOP and repair the Command Center mission/approval routing defect. Determine why the old mission was labeled protected action SUBMIT and confirm the approve click does not create a duplicate task.',
  'MILES — good, the DeLune correction mission is accepted. Investigate why worker-runtime marked this as SPEND; do not spend money or change any account.',
  'MILES — DeLune exposed a material problem in the demo. Explain why the earlier policy said BUY when the text only discussed buying agencies and procurement history.',
  'Audit the approval routing. The prior screen said CEO approval required for protected action DELETE. Do not delete anything.'
];

for (const command of narrativeCases) {
  const policy = policyEngine.evaluate(task(command), { actor: 'TEST', role: 'MILES' });
  assert.notEqual(policy.decision, 'REQUIRE_APPROVAL', `Narrative text created false approval: ${command}`);
  assert.equal(policy.approvalRequired, false, `Narrative text set approvalRequired: ${command}`);
  assert.equal(policy.matches.proseApprovalPattern, null, `Narrative prose matched protected verb: ${command}`);
}

const explicitCases = [
  ['Send the final proposal to the customer.', 'SEND'],
  ['Please delete the production records.', 'DELETE'],
  ['Can you publish this post?', 'PUBLISH'],
  ['I want you to spend the approved budget.', 'SPEND'],
  ['Go ahead and buy the domain.', 'BUY']
];

for (const [command, expected] of explicitCases) {
  const policy = policyEngine.evaluate(task(command), { actor: 'TEST', role: 'MILES' });
  assert.equal(policy.decision, 'REQUIRE_APPROVAL', `Explicit protected request was not gated: ${command}`);
  assert.equal(policy.approvalRequired, true, `Explicit protected request missing approvalRequired: ${command}`);
  assert.equal(String(policy.matches.approvalPattern).toUpperCase(), expected, `Wrong protected action for: ${command}`);
}

const structured = policyEngine.evaluate(task('Review this operation.', 'DELETE_PRODUCTION_DATA'), { actor: 'TEST', role: 'MILES' });
assert.equal(structured.decision, 'REQUIRE_APPROVAL');
assert.equal(structured.approvalRequired, true);
assert.equal(String(structured.matches.structuredApprovalPattern).toUpperCase(), 'DELETE');

console.log('POLICY_APPROVAL_INTENT_REGRESSION=PASS');
