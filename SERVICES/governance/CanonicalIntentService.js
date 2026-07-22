"use strict";

/**
 * CanonicalIntentService
 *
 * Converts planner/provider action names into a canonical governance intent.
 *
 * Governance must evaluate what an operation will DO, not whether a protected
 * word happens to appear somewhere inside a method name or description.
 */

const CANONICAL_INTENTS = new Set([
  "READ",
  "LIST",
  "GET",
  "STATUS",
  "HEALTH",
  "VERIFY",
  "ANALYZE",
  "AUDIT",
  "REPORT",
  "DISCOVER",
  "SCORE",
  "REFRESH",
  "SYNC",
  "RECOMMEND",
  "PLAN",
  "TEST",

  "SEND",
  "PUBLISH",
  "POST",
  "SUBMIT",
  "DELETE",
  "REMOVE",
  "PURCHASE",
  "BUY",
  "SPEND",
  "PAY",
  "CANCEL",
  "DNS",
  "DOMAIN",
  "CREDENTIAL",
  "PASSWORD",
  "DEPLOY",
  "PRODUCTION",
  "LAUNCH",
  "RESUME",
  "PAUSE",
  "UPLOAD",
  "WRITE",
  "MODIFY",
  "UPDATE",
  "CREATE",
  "FORWARD",
  "REPLY",
  "CONTROLLED_WRITE",
  "FINANCIAL_COMMITMENT",
  "CLIENT_SUBMISSION"
]);

const PROTECTED_PREFIXES = new Map([
  ["SEND", "SEND"],
  ["PUBLISH", "PUBLISH"],
  ["POST", "POST"],
  ["SUBMIT", "SUBMIT"],
  ["DELETE", "DELETE"],
  ["REMOVE", "REMOVE"],
  ["PURCHASE", "PURCHASE"],
  ["BUY", "BUY"],
  ["SPEND", "SPEND"],
  ["PAY", "PAY"],
  ["CANCEL", "CANCEL"],
  ["DEPLOY", "DEPLOY"],
  ["LAUNCH", "LAUNCH"],
  ["RESUME", "RESUME"],
  ["PAUSE", "PAUSE"],
  ["UPLOAD", "UPLOAD"],
  ["WRITE", "WRITE"],
  ["MODIFY", "MODIFY"],
  ["UPDATE", "UPDATE"],
  ["CREATE", "CREATE"],
  ["FORWARD", "FORWARD"],
  ["REPLY", "REPLY"]
]);

function normalizeWords(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9_.]+/g, " ")
    .trim()
    .toUpperCase();
}

function compact(value) {
  return normalizeWords(value)
    .replace(/[^A-Z0-9]+/g, "");
}

function firstWord(value) {
  return normalizeWords(value)
    .split(/\s+/)
    .filter(Boolean)[0] || "";
}

function canonicalExplicit(value) {
  const normalized = normalizeWords(value)
    .replace(/\s+/g, "_");

  return CANONICAL_INTENTS.has(normalized)
    ? normalized
    : null;
}

function classifyAction(action) {
  const normalized = normalizeWords(action);
  const compacted = compact(action);
  const first = firstWord(action);

  if (!normalized) {
    return null;
  }

  const explicit = canonicalExplicit(action);

  if (explicit) {
    return {
      intent: explicit,
      source: "explicit_action",
      confidence: 1
    };
  }

  /*
   * Exact semantic exceptions.
   *
   * These names contain protected words but are intelligence/reporting
   * operations rather than protected business actions.
   */

  if (
    compacted === "GENERATEEXECUTIVEUPDATE" ||
    compacted === "CREATEEXECUTIVEUPDATE" ||
    compacted === "BUILDEXECUTIVEUPDATE" ||
    compacted === "PRODUCEEXECUTIVEUPDATE"
  ) {
    return {
      intent: "REPORT",
      source: "semantic_exception",
      confidence: 1
    };
  }

  if (
    compacted === "IDENTIFYPAUSEDCAMPAIGNS" ||
    compacted === "FINDPAUSEDCAMPAIGNS" ||
    compacted === "DISCOVERPAUSEDCAMPAIGNS"
  ) {
    return {
      intent: "DISCOVER",
      source: "semantic_exception",
      confidence: 1
    };
  }

  if (
    compacted === "RECOMMENDRESUMEORHOLD" ||
    compacted === "RECOMMENDPAUSEORRESUME"
  ) {
    return {
      intent: "RECOMMEND",
      source: "semantic_exception",
      confidence: 1
    };
  }

  /*
   * Read-only and analytical prefixes take precedence over protected words
   * that may appear later in a method name.
   */

  if (first === "READ") {
    return { intent: "READ", source: "action_prefix", confidence: 0.98 };
  }

  if (first === "LIST") {
    return { intent: "LIST", source: "action_prefix", confidence: 0.98 };
  }

  if (first === "GET") {
    return { intent: "GET", source: "action_prefix", confidence: 0.98 };
  }

  if (first === "CHECK") {
    return {
      intent: normalized.includes("STATUS") ? "STATUS" : "VERIFY",
      source: "action_prefix",
      confidence: 0.95
    };
  }

  if (first === "STATUS") {
    return { intent: "STATUS", source: "action_prefix", confidence: 0.98 };
  }

  if (first === "HEALTH") {
    return { intent: "HEALTH", source: "action_prefix", confidence: 0.98 };
  }

  if (first === "VERIFY" || first === "VALIDATE") {
    return { intent: "VERIFY", source: "action_prefix", confidence: 0.98 };
  }

  if (first === "EVALUATE" || first === "ASSESS") {
    return { intent: "ANALYZE", source: "action_prefix", confidence: 0.98 };
  }

  if (first === "ANALYZE") {
    return { intent: "ANALYZE", source: "action_prefix", confidence: 0.98 };
  }

  if (first === "AUDIT") {
    return { intent: "AUDIT", source: "action_prefix", confidence: 0.98 };
  }

  if (
    first === "GENERATE" ||
    first === "PRODUCE" ||
    first === "SUMMARIZE"
  ) {
    if (
      normalized.includes("REPORT") ||
      normalized.includes("SUMMARY") ||
      normalized.includes("EXECUTIVE") ||
      normalized.includes("BRIEF") ||
      normalized.includes("UPDATE")
    ) {
      return {
        intent: "REPORT",
        source: "action_prefix",
        confidence: 0.95
      };
    }
  }

  if (first === "REPORT") {
    return { intent: "REPORT", source: "action_prefix", confidence: 0.98 };
  }

  if (
    first === "IDENTIFY" ||
    first === "FIND" ||
    first === "DISCOVER"
  ) {
    return {
      intent: "DISCOVER",
      source: "action_prefix",
      confidence: 0.98
    };
  }

  if (first === "SCORE" || first === "RANK") {
    return { intent: "SCORE", source: "action_prefix", confidence: 0.98 };
  }

  if (first === "REFRESH") {
    return { intent: "REFRESH", source: "action_prefix", confidence: 0.98 };
  }

  if (first === "SYNC" || first === "SYNCHRONIZE") {
    return { intent: "SYNC", source: "action_prefix", confidence: 0.98 };
  }

  if (first === "RECOMMEND" || first === "ADVISE") {
    return {
      intent: "RECOMMEND",
      source: "action_prefix",
      confidence: 0.98
    };
  }

  if (
    first === "PLAN" ||
    first === "ROUTE" ||
    first === "SCHEDULE"
  ) {
    return { intent: "PLAN", source: "action_prefix", confidence: 0.95 };
  }

  if (first === "TEST" || first === "PROBE") {
    return { intent: "TEST", source: "action_prefix", confidence: 0.98 };
  }

  /*
   * Protected actions are recognized only when the protected verb is the
   * actual leading operation.
   */

  if (PROTECTED_PREFIXES.has(first)) {
    return {
      intent: PROTECTED_PREFIXES.get(first),
      source: "protected_action_prefix",
      confidence: 0.99
    };
  }

  return null;
}

function getTaskParts(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};

  const explicitGovernanceIntent =
    task.governanceIntent ||
    payload.governanceIntent ||
    plan.governanceIntent ||
    null;

  const action =
    payload.action ||
    task.action ||
    plan.action ||
    null;

  const capability =
    payload.capability ||
    task.capability ||
    plan.capability ||
    null;

  const contextualCommand =
    payload.command ||
    plan.originalCommand ||
    payload.objective ||
    plan.objective ||
    task.command ||
    task.objective ||
    null;

  return {
    explicitGovernanceIntent,
    action,
    capability,
    contextualCommand
  };
}

class CanonicalIntentService {
  resolve(task = {}) {
    const parts = getTaskParts(task);

    const explicit =
      canonicalExplicit(parts.explicitGovernanceIntent);

    if (explicit) {
      return {
        intent: explicit,
        source: "governance_intent",
        confidence: 1,
        rawAction: parts.action,
        normalizedAction: normalizeWords(parts.action),
        capability: parts.capability
      };
    }

    const actionResult =
      classifyAction(parts.action);

    if (actionResult) {
      return {
        ...actionResult,
        rawAction: parts.action,
        normalizedAction: normalizeWords(parts.action),
        capability: parts.capability
      };
    }

    /*
     * Capability is used only when the action itself was not classifiable.
     */

    const capabilityResult =
      classifyAction(parts.capability);

    if (capabilityResult) {
      return {
        ...capabilityResult,
        source: "capability",
        rawAction: parts.action,
        normalizedAction: normalizeWords(parts.action),
        capability: parts.capability
      };
    }

    /*
     * Human command fallback is used only when structured metadata did not
     * produce an intent.
     */

    const commandResult =
      classifyAction(parts.contextualCommand);

    if (commandResult) {
      return {
        ...commandResult,
        source: "context_fallback",
        confidence: Math.min(commandResult.confidence, 0.75),
        rawAction: parts.action,
        normalizedAction: normalizeWords(parts.action),
        capability: parts.capability
      };
    }

    return {
      intent: "UNKNOWN",
      source: "unresolved",
      confidence: 0,
      rawAction: parts.action,
      normalizedAction: normalizeWords(parts.action),
      capability: parts.capability
    };
  }

  normalizeWords(value) {
    return normalizeWords(value);
  }

  classifyAction(value) {
    return classifyAction(value);
  }
}

module.exports = new CanonicalIntentService();
