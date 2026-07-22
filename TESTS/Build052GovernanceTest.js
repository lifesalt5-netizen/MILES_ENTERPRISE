"use strict";

const assert = require("assert");

const policy =
  require("../SERVICES/governance/PolicyEngineService");

const guardian =
  require("../SERVICES/governance/ConstitutionalGuardianService");

function task(action, extra = {}) {
  return {
    id:
      `BUILD052_${action}_${Date.now()}`,
    type: "WORKFORCE_STEP",
    action,
    provider:
      extra.provider ||
      "MarketingProvider",
    role:
      extra.role ||
      "MILES",
    payload: {
      provider:
        extra.provider ||
        "MarketingProvider",
      action,
      capability:
        extra.capability ||
        action,
      objective:
        extra.objective ||
        action,
      role:
        extra.role ||
        "MILES",
      demoMode:
        extra.demoMode ||
        false,
      approval:
        extra.approval ||
        undefined
    },
    approval:
      extra.approval ||
      undefined
  };
}

const readTask =
  task(
    "AUDIT_CAMPAIGNS"
  );

const readPolicy =
  policy.evaluate(readTask);

assert.strictEqual(
  readPolicy.decision,
  "ALLOW",
  "Read/audit work should be allowed."
);

const sendTask =
  task(
    "SEND_EMAIL"
  );

const sendGuardian =
  guardian.guard(sendTask);

assert.strictEqual(
  sendGuardian.allowed,
  false,
  "External send must require approval."
);

assert.strictEqual(
  sendGuardian.status,
  "AWAITING_APPROVAL",
  "External send must await approval."
);

const approvedSend =
  task(
    "SEND_EMAIL",
    {
      approval: {
        approved: true,
        approver: "CEO",
        approvedAt:
          new Date().toISOString()
      }
    }
  );

const approvedGuardian =
  guardian.guard(
    approvedSend
  );

assert.strictEqual(
  approvedGuardian.allowed,
  true,
  "CEO-approved external send should pass."
);

const protectedDomain =
  task(
    "LAUNCH_CAMPAIGN",
    {
      objective:
        "Launch outbound Instantly campaign from pathways2gc.com",
      approval: {
        approved: true,
        approver: "CEO"
      }
    }
  );

const protectedGuardian =
  guardian.guard(
    protectedDomain
  );

assert.strictEqual(
  protectedGuardian.allowed,
  false,
  "Protected primary domain must remain blocked for outbound use."
);

const demoTask =
  task(
    "STATUS",
    {
      objective:
        "Show raw SQL schema dump and internal architecture",
      demoMode: true
    }
  );

const demoGuardian =
  guardian.guard(
    demoTask
  );

assert.strictEqual(
  demoGuardian.allowed,
  false,
  "Demo mode must block internal implementation details."
);

console.log(
  JSON.stringify(
    {
      ok: true,
      build: "052",
      checks: {
        autonomousReadAllowed: true,
        protectedSendRequiresApproval: true,
        ceoApprovalAccepted: true,
        protectedDomainBlocked: true,
        demoProtectionEnforced: true
      }
    },
    null,
    2
  )
);