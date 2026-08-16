"use strict";

/*
  MILES Enterprise
  Canonical execution action contracts.

  Purpose:
  - One dependency-free source of truth for actions executable by the
    ephemeral connector path.
  - Shared by connector implementations, capability routing, and CEO
    command preflight so an action cannot be called supported in one layer
    and then fail as unknown in another.
*/

const MILES_ACTIONS = Object.freeze([
  "BUSINESS_EXECUTION",
  "PROVIDER_AUTHORITY",
  "PROVIDER_AUTHORITY_REGISTRY",
  "PROVIDER_SYNC",
  "PROVIDER_SYNCHRONIZATION",
  "INSTANTLY_LIVE",
  "CONTROLLED_WRITE",
  "BUILD_CAPABILITY",
  "CAPABILITY_BUILD",
  "AUTONOMOUS_CAPABILITY_BUILD",
  "REPOSITORY_SEARCH",
  "CODE_WRITER_CAPABILITY_AUDIT",
  "REPOSITORY_EVIDENCE_REPORT"
]);

const INSTANTLY_ACTIONS = Object.freeze([
  "healthCheck",
  "getConfiguration",
  "listCampaigns",
  "getCampaign",
  "getCampaignAnalytics",
  "getCampaignAnalyticsOverview",
  "getCampaignDailyAnalytics",
  "getCampaignStepsAnalytics",
  "listAccounts",
  "testAccountVitals",
  "getWarmupAnalytics",
  "getDailyAccountAnalytics",
  "listLeads",
  "createLead",
  "createCampaign",
  "updateCampaign",
  "pauseCampaign",
  "activateCampaign",
  "resumeCampaign",
  "startCampaign",
  "deleteCampaign"
]);

const ORION_ACTIONS = Object.freeze([
  "ORION_HEALTH",
  "ORION_TABLES",
  "ORION_SUMMARY",
  "ORION_CONTRACTORS",
  "ORION_BUYERS",
  "ORION_OPPORTUNITIES",
  "ORION_RECOMPETES",
  "ORION_RECOMMENDATIONS",
  "ORION_PERSONAS",
  "ORION_SEARCH_CONTRACTORS"
]);

const EPHEMERAL_CONNECTORS = Object.freeze(["MILES", "INSTANTLY", "ORION"]);

function normalizeToken(value) {
  return String(value || "").trim().toUpperCase();
}

function compactToken(value) {
  return normalizeToken(value).replace(/[^A-Z0-9]/g, "");
}

const INSTANTLY_BY_COMPACT = new Map(
  INSTANTLY_ACTIONS.map(action => [compactToken(action), action])
);

function normalizeMilesAction(value) {
  const action = normalizeToken(value);
  return MILES_ACTIONS.includes(action) ? action : null;
}

function normalizeInstantlyAction(value) {
  const compact = compactToken(value);
  if (compact === "HEALTH") return "healthCheck";
  return INSTANTLY_BY_COMPACT.get(compact) || null;
}

function normalizeOrionAction(value) {
  const raw = String(value || "").trim();
  const upper = normalizeToken(raw);
  if (ORION_ACTIONS.includes(upper)) return upper;

  const text = raw.toLowerCase();
  if (!text) return null;
  if (text.includes("health") || text.includes("system health")) return "ORION_HEALTH";
  if (text.includes("summary") || text.includes("executive")) return "ORION_SUMMARY";
  if (text.includes("table")) return "ORION_TABLES";
  if (text.includes("search") && text.includes("contractor")) return "ORION_SEARCH_CONTRACTORS";
  if (text.includes("contractor")) return "ORION_CONTRACTORS";
  if (text.includes("buyer")) return "ORION_BUYERS";
  if (text.includes("opportunit")) return "ORION_OPPORTUNITIES";
  if (text.includes("recompete")) return "ORION_RECOMPETES";
  if (text.includes("recommend")) return "ORION_RECOMMENDATIONS";
  if (text.includes("persona")) return "ORION_PERSONAS";
  return null;
}

function supportedActionsFor(connector) {
  switch (normalizeToken(connector)) {
    case "MILES": return [...MILES_ACTIONS];
    case "INSTANTLY": return [...INSTANTLY_ACTIONS];
    case "ORION": return [...ORION_ACTIONS];
    default: return [];
  }
}

function resolveConnectorAction(connector, action) {
  const normalizedConnector = normalizeToken(connector);
  let canonicalAction = null;

  if (normalizedConnector === "MILES") canonicalAction = normalizeMilesAction(action);
  else if (normalizedConnector === "INSTANTLY") canonicalAction = normalizeInstantlyAction(action);
  else if (normalizedConnector === "ORION") canonicalAction = normalizeOrionAction(action);

  return {
    connector: normalizedConnector || null,
    requestedAction: action || null,
    canonicalAction,
    supported: Boolean(canonicalAction),
    ephemeralConnectorAvailable: EPHEMERAL_CONNECTORS.includes(normalizedConnector),
    supportedActions: supportedActionsFor(normalizedConnector)
  };
}

module.exports = {
  MILES_ACTIONS,
  INSTANTLY_ACTIONS,
  ORION_ACTIONS,
  EPHEMERAL_CONNECTORS,
  normalizeMilesAction,
  normalizeInstantlyAction,
  normalizeOrionAction,
  supportedActionsFor,
  resolveConnectorAction
};
