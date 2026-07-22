"use strict";

const fs = require("fs");
const path = require("path");

const dataAccess =
  require("./DataAccessPolicyService");
const demoProtection =
  require("./DemoProtectionService");
const audit =
  require("./GovernanceAuditService");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..", "..");

function readJson(name) {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        ROOT,
        "GOVERNANCE",
        name
      ),
      "utf8"
    )
  );
}

function textOf(task = {}) {
  const payload =
    task.payload ||
    {};

  const plan =
    payload.plan ||
    task.plan ||
    {};

  return [
    task.type,
    task.action,
    task.intent,
    task.workflow,
    task.provider,
    task.connector,
    payload.action,
    payload.capability,
    payload.objective,
    payload.command,
    payload.provider,
    payload.connector,
    plan.intent,
    plan.workflow,
    plan.action,
    plan.objective,
    plan.originalCommand
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

function matchPattern(text, patterns = []) {
  return patterns.find(pattern =>
    text.includes(
      String(pattern)
        .toUpperCase()
    )
  ) || null;
}

class PolicyEngineService {
  evaluate(task = {}, context = {}) {
    const constitution =
      readJson("constitution.json");

    const approvals =
      readJson("approval_matrix.json");

    const text =
      textOf(task);

    const neverAllowedPattern =
      matchPattern(
        text,
        approvals.neverAllowedPatterns
      );

    const protectedDomain =
      Object.keys(
        approvals.protectedAssets || {}
      ).find(asset =>
        text.includes(
          asset.toUpperCase()
        )
      ) || null;

    const outboundContext =
      /OUTBOUND|INSTANTLY|CAMPAIGN|SEND/
        .test(text);

    const approvalPattern =
      matchPattern(
        text,
        approvals.approvalPatterns
      );

    const autonomousPattern =
      matchPattern(
        text,
        approvals.autonomousPatterns
      );

    const data =
      dataAccess.evaluate({
        task,
        ...context
      });

    const demo =
      demoProtection.evaluate({
        task,
        ...context
      });

    let decision =
      "ALLOW";

    let approvalRequired =
      false;

    let risk =
      "LOW";

    let reason =
      "Read-only or low-risk action is authorized.";

    if (neverAllowedPattern) {
      decision = "DENY";
      risk = "CRITICAL";
      reason =
        `Constitutional prohibition matched: ${neverAllowedPattern}.`;
    } else if (
      protectedDomain &&
      outboundContext
    ) {
      decision = "DENY";
      risk = "CRITICAL";
      reason =
        approvals.protectedAssets[
          protectedDomain
        ].reason;
    } else if (!data.allowed) {
      decision = "DENY";
      risk = "HIGH";
      reason = data.reason;
    } else if (!demo.allowed) {
      decision = "DENY";
      risk = "HIGH";
      reason = demo.reason;
    } else if (approvalPattern) {
      decision =
        "REQUIRE_APPROVAL";
      approvalRequired = true;
      risk =
        /DELETE|SPEND|PAY|PURCHASE|BUY|DNS|DOMAIN|CREDENTIAL|DEPLOY|PRODUCTION/
          .test(approvalPattern)
          ? "CRITICAL"
          : "HIGH";
      reason =
        `CEO approval required for protected action: ${approvalPattern}.`;
    } else if (!autonomousPattern) {
      risk = "MEDIUM";
      reason =
        "Action is allowed but did not match an explicit autonomous pattern; enhanced auditing is required.";
    }

    const policy = {
      ok: true,
      evaluated: true,
      decision,
      allowed:
        decision !== "DENY",
      canExecute:
        decision === "ALLOW",
      approvalRequired,
      approver:
        approvalRequired
          ? approvals.defaultApprover
          : null,
      risk,
      reason,
      matches: {
        neverAllowedPattern,
        approvalPattern,
        autonomousPattern,
        protectedDomain
      },
      dataAccess: data,
      demoProtection: demo,
      constitutionVersion:
        constitution.version,
      policyVersion:
        approvals.version,
      evaluatedAt:
        new Date().toISOString()
    };

    audit.policyDecision(
      task,
      policy
    );

    return policy;
  }
}

module.exports =
  new PolicyEngineService();