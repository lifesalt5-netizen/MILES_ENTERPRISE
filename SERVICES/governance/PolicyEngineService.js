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

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchStructuredApprovalPattern(text, patterns = []) {
  const normalizedText = normalize(text);
  return patterns.find(pattern => {
    const token = normalize(pattern);
    if (!token) return false;
    const escaped = escapeRegExp(token);
    return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`).test(normalizedText);
  }) || null;
}

function explicitApprovalPattern(text, patterns = []) {
  const normalized = normalize(text)
    .replace(/^MILES\s*(?:[-—:]\s*)?/, "")
    .trim();

  if (!normalized) return null;

  for (const pattern of patterns) {
    const token = normalize(pattern);
    if (!token) continue;
    const escaped = escapeRegExp(token);

    // Prose is advisory evidence, not authoritative intent. Only treat a
    // protected verb appearing in prose as an approval request when the CEO
    // is actually issuing that verb as an imperative/request. This prevents
    // diagnostic narratives such as "why did this say BUY/SPEND/SUBMIT?"
    // from manufacturing approvals merely because those words are quoted.
    const direct = new RegExp(`^(?:(?:PLEASE|KINDLY)\\s+)?${escaped}\\b`);
    const request = new RegExp(`^(?:CAN|COULD|WOULD|WILL)\\s+YOU\\s+${escaped}\\b`);
    const intent = new RegExp(`^(?:I\\s+)?(?:WANT|NEED)\\s+(?:YOU\\s+)?TO\\s+${escaped}\\b`);
    const authorization = new RegExp(`^(?:GO\\s+AHEAD\\s+AND|PROCEED\\s+TO|YOU\\s+ARE\\s+AUTHORIZED\\s+TO)\\s+${escaped}\\b`);

    if (
      direct.test(normalized) ||
      request.test(normalized) ||
      intent.test(normalized) ||
      authorization.test(normalized)
    ) {
      return pattern;
    }
  }

  return null;
}

const GOVERNED_SELF_MAINTENANCE_ACTIONS = new Set([
  "SELF_MAINTENANCE",
  "SELF_MAINTENANCE_DIAGNOSE",
  "SELF_MAINTENANCE_PLAN",
  "SELF_MAINTENANCE_VALIDATE",
  "SELF_MAINTENANCE_REPORT",
  "SELF_MAINTENANCE_AUDIT_RUNTIME_APPROVALS",
  "SELF_MAINTENANCE_RECONCILE_RUNTIME_APPROVALS"
]);

function isGovernedSelfMaintenance(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};
  const action = normalize(task.action || payload.action || plan.action || task.type);
  const provider = normalize(task.provider || payload.provider || plan.provider || task.system || payload.system || plan.system);
  const system = normalize(task.system || payload.system || plan.system || "MILES");
  return GOVERNED_SELF_MAINTENANCE_ACTIONS.has(action) &&
    ["MILES", "SELFMAINTENANCESERVICE"].includes(provider) &&
    (system === "MILES" || provider === "MILES");
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

    const structuredApprovalPattern = matchStructuredApprovalPattern(structured, approvals.approvalPatterns);
    const proseApprovalPattern = explicitApprovalPattern(affirmative, approvals.approvalPatterns);
    const governedQualifiedReply = isGovernedQualifiedReply(task);
    const governedSelfMaintenance = isGovernedSelfMaintenance(task);
    const rawApprovalPattern = governedSelfMaintenance
      ? proseApprovalPattern
      : structuredApprovalPattern || proseApprovalPattern;
    const approvalPattern =
      governedQualifiedReply && ["SEND", "REPLY"].includes(normalize(rawApprovalPattern))
        ? null
        : rawApprovalPattern;

    const autonomousPattern =
      governedQualifiedReply
        ? "GOVERNED_QUALIFIED_REPLY"
        : governedSelfMaintenance
          ? "GOVERNED_SELF_MAINTENANCE"
          : matchPattern(structured, approvals.autonomousPatterns) ||
            matchPattern(affirmative, approvals.autonomousPatterns);

    const data = dataAccess.evaluate({ task, ...context });
    const demo = demoProtection.evaluate({ task, ...context });

    let decision = "ALLOW";
    let approvalRequired = false;
    let risk = "LOW";
    let reason = governedQualifiedReply
      ? "Evidence-gated qualified prospect reply is authorized for autonomous execution through controlled-write governance."
      : governedSelfMaintenance
        ? "Bounded MILES self-maintenance is authorized for autonomous execution; explicit protected CEO actions remain governed."
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
        structuredApprovalPattern,
        proseApprovalPattern,
        autonomousPattern,
        protectedDomain,
        governedQualifiedReply,
        governedSelfMaintenance
      },
      interpretation: {
        structuredIntent: structured,
        affirmativeProse: affirmative,
        proseApprovalRequiresExplicitIntent: true,
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
module.exports.isGovernedSelfMaintenance = isGovernedSelfMaintenance;
module.exports.explicitApprovalPattern = explicitApprovalPattern;
