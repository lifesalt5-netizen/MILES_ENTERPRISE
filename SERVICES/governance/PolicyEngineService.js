"use strict";

const fs = require("fs");
const path = require("path");

const dataAccess = require("./DataAccessPolicyService");
const demoProtection = require("./DemoProtectionService");
const audit = require("./GovernanceAuditService");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..", "..");
const QUALIFIED_REPLY_CATEGORIES = new Set([
  "INTERESTED",
  "MEETING_INTENT",
  "PRICING_QUESTION",
  "REFERRAL"
]);

function readJson(name) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "GOVERNANCE", name), "utf8").replace(/^\uFEFF/, "")
  );
}

function normalize(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function affirmativeProse(value) {
  let text = normalize(value);
  const negatedClause =
    /\b(?:DO\s+NOT|DON['’]T|NEVER|NOT\s+TO|WITHOUT)\b[\s\S]*?(?=\b(?:BUT|HOWEVER|THEN|YET)\b|[.;!?]|$)/g;
  text = text.replace(negatedClause, " ");
  return text.replace(/\s+/g, " ").trim();
}

function structuredTextOf(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};
  return normalize([
    task.type,
    task.action,
    task.intent,
    task.workflow,
    task.provider,
    task.connector,
    payload.action,
    payload.capability,
    payload.provider,
    payload.connector,
    plan.intent,
    plan.workflow,
    plan.action,
    plan.provider,
    plan.connector
  ].filter(Boolean).join(" "));
}

function proseTextOf(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};
  return normalize([
    task.title,
    task.objective,
    task.command,
    payload.objective,
    payload.command,
    payload.originalCommand,
    plan.objective,
    plan.originalCommand
  ].filter(Boolean).join(". "));
}

function matchPattern(text, patterns = []) {
  return patterns.find(pattern => text.includes(normalize(pattern))) || null;
}

function isGovernedQualifiedReply(task = {}) {
  const payload = task.payload || {};
  const action = normalize(payload.action || task.action || task.type);
  const capability = normalize(payload.capability || task.capability);
  const provider = normalize(payload.provider || task.provider || payload.connector || task.connector);
  const category = normalize(payload.category || payload.replyCategory || payload.classification?.category);
  const autonomy = payload.autonomy || {};
  const confidence = Number(autonomy.confidence ?? payload.confidence ?? 0);
  const replyId = String(payload.reply_to_uuid || payload.replyToUuid || "").trim();
  const sender = String(payload.eaccount || payload.sender_account || payload.senderAccount || "").trim();
  const bodyText = String(payload.body?.text || payload.body?.html || "").trim();
  const suppressed = Boolean(
    autonomy.suppressed ||
    payload.suppressed ||
    payload.globallySuppressed ||
    payload.optOut ||
    payload.unsubscribe
  );
  const source = normalize(payload.source || "");

  return (
    action === "REPLYTOEMAIL" &&
    capability === "INSTANTLY_SEND_REPLY" &&
    provider === "INSTANTLY" &&
    QUALIFIED_REPLY_CATEGORIES.has(category) &&
    autonomy.eligible === true &&
    confidence >= 0.9 &&
    Boolean(replyId) &&
    Boolean(sender) &&
    Boolean(bodyText) &&
    !suppressed &&
    source === "QUALIFIED_REPLIES"
  );
}

class PolicyEngineService {
  evaluate(task = {}, context = {}) {
    const constitution = readJson("constitution.json");
    const approvals = readJson("approval_matrix.json");

    const structured = structuredTextOf(task);
    const rawProse = proseTextOf(task);
    const affirmative = affirmativeProse(rawProse);
    const actionableText = normalize(`${structured} ${affirmative}`);

    const neverAllowedPattern = matchPattern(actionableText, approvals.neverAllowedPatterns);
    const protectedDomain = Object.keys(approvals.protectedAssets || {}).find(asset =>
      actionableText.includes(normalize(asset))
    ) || null;
    const outboundContext = /OUTBOUND|INSTANTLY|CAMPAIGN|SEND/.test(actionableText);

    const rawApprovalPattern =
      matchPattern(structured, approvals.approvalPatterns) ||
      matchPattern(affirmative, approvals.approvalPatterns);
    const governedQualifiedReply = isGovernedQualifiedReply(task);
    const approvalPattern =
      governedQualifiedReply && ["SEND", "REPLY"].includes(normalize(rawApprovalPattern))
        ? null
        : rawApprovalPattern;

    const autonomousPattern =
      governedQualifiedReply
        ? "GOVERNED_QUALIFIED_REPLY"
        : matchPattern(structured, approvals.autonomousPatterns) ||
          matchPattern(affirmative, approvals.autonomousPatterns);

    const data = dataAccess.evaluate({ task, ...context });
    const demo = demoProtection.evaluate({ task, ...context });

    let decision = "ALLOW";
    let approvalRequired = false;
    let risk = "LOW";
    let reason = governedQualifiedReply
      ? "Evidence-gated qualified prospect reply is authorized for autonomous execution through controlled-write governance."
      : "Read-only or low-risk action is authorized.";

    if (neverAllowedPattern) {
      decision = "DENY";
      risk = "CRITICAL";
      reason = `Constitutional prohibition matched: ${neverAllowedPattern}.`;
    } else if (protectedDomain && outboundContext) {
      decision = "DENY";
      risk = "CRITICAL";
      reason = approvals.protectedAssets[protectedDomain].reason;
    } else if (!data.allowed) {
      decision = "DENY";
      risk = "HIGH";
      reason = data.reason;
    } else if (!demo.allowed) {
      decision = "DENY";
      risk = "HIGH";
      reason = demo.reason;
    } else if (approvalPattern) {
      decision = "REQUIRE_APPROVAL";
      approvalRequired = true;
      risk = /DELETE|SPEND|PAY|PURCHASE|BUY|DNS|DOMAIN|CREDENTIAL|DEPLOY|PRODUCTION/
        .test(approvalPattern)
        ? "CRITICAL"
        : "HIGH";
      reason = `CEO approval required for protected action: ${approvalPattern}.`;
    } else if (!autonomousPattern) {
      risk = "MEDIUM";
      reason = "Action is allowed but did not match an explicit autonomous pattern; enhanced auditing is required.";
    }

    const policy = {
      ok: true,
      evaluated: true,
      decision,
      allowed: decision !== "DENY",
      canExecute: decision === "ALLOW",
      approvalRequired,
      approver: approvalRequired ? approvals.defaultApprover : null,
      risk,
      reason,
      matches: {
        neverAllowedPattern,
        approvalPattern,
        rawApprovalPattern,
        autonomousPattern,
        protectedDomain,
        governedQualifiedReply
      },
      interpretation: {
        structuredIntent: structured,
        affirmativeProse: affirmative,
        negationAware: true
      },
      dataAccess: data,
      demoProtection: demo,
      constitutionVersion: constitution.version,
      policyVersion: approvals.version,
      evaluatedAt: new Date().toISOString()
    };

    audit.policyDecision(task, policy);
    return policy;
  }
}

module.exports = new PolicyEngineService();
module.exports.isGovernedQualifiedReply = isGovernedQualifiedReply;
