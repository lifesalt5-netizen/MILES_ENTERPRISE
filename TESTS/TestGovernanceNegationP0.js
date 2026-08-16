"use strict";

const assert = require("assert");
const policy = require("../SERVICES/governance/PolicyEngineService");
const guardian = require("../SERVICES/governance/ConstitutionalGuardianService");

function task(action, command, extra = {}) {
  return {
    id: `GOV_NEG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: action,
    action,
    provider: extra.provider || "MILES",
    connector: extra.connector || "MILES",
    payload: {
      action,
      provider: extra.provider || "MILES",
      connector: extra.connector || "MILES",
      command,
      objective: command,
      plan: {
        ok: true,
        intent: extra.intent || "EXECUTIVE_MISSION",
        workflow: extra.workflow || "EXECUTIVE_MISSION_PLANNING",
        action,
        provider: extra.provider || "MILES",
        connector: extra.connector || "MILES",
        objective: command,
        originalCommand: command
      },
      approval: extra.approval
    },
    approval: extra.approval
  };
}

const readOnlyCommand =
  "Review the current P2GC revenue pipeline and report the top 3 actions that should be taken next. Read-only acceptance test. Do not send email, modify campaigns, or change external systems.";

const readOnly = task("BUSINESS_EXECUTION", readOnlyCommand);
const readOnlyPolicy = policy.evaluate(readOnly);
assert.strictEqual(readOnlyPolicy.decision, "ALLOW", "Negated SEND/MODIFY prose must not require approval.");
assert.strictEqual(readOnlyPolicy.approvalRequired, false, "Read-only executive review must remain autonomous.");
assert.strictEqual(guardian.guard(readOnly).allowed, true, "Read-only executive review must pass the constitutional guardian.");

const actualSend = task("SEND_EMAIL", "Send the customer the final email now.", { provider: "INSTANTLY", connector: "INSTANTLY" });
const sendGuardian = guardian.guard(actualSend);
assert.strictEqual(sendGuardian.allowed, false, "Affirmative SEND must still require approval.");
assert.strictEqual(sendGuardian.status, "AWAITING_APPROVAL", "Affirmative SEND must await CEO approval.");

const contrast = task(
  "BUSINESS_EXECUTION",
  "Do not send email, but publish the final report externally."
);
const contrastPolicy = policy.evaluate(contrast);
assert.strictEqual(contrastPolicy.decision, "REQUIRE_APPROVAL", "A protected action after BUT must still require approval.");
assert.strictEqual(contrastPolicy.matches.approvalPattern, "PUBLISH");

const protectedNegated = task(
  "STATUS",
  "Audit outbound configuration. Do not send campaigns from pathways2gc.com. Report the current status only."
);
const protectedNegatedPolicy = policy.evaluate(protectedNegated);
assert.notStrictEqual(protectedNegatedPolicy.decision, "DENY", "A prohibition against protected-domain sending must not be interpreted as outbound use.");

const protectedActual = task(
  "LAUNCH_CAMPAIGN",
  "Launch an outbound Instantly campaign from pathways2gc.com.",
  { provider: "INSTANTLY", connector: "INSTANTLY" }
);
const protectedActualPolicy = policy.evaluate(protectedActual);
assert.strictEqual(protectedActualPolicy.decision, "DENY", "Actual protected-domain outbound use must remain denied.");

console.log(JSON.stringify({
  ok: true,
  test: "GOVERNANCE_NEGATION_P0",
  checks: {
    negatedProtectedVerbsAllowed: true,
    affirmativeSendRequiresApproval: true,
    contrastBoundaryPreserved: true,
    protectedDomainNegationUnderstood: true,
    protectedDomainActualUseDenied: true
  }
}, null, 2));
