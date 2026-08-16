"use strict";

const {
  MILES_ACTIONS,
  INSTANTLY_ACTIONS,
  ORION_ACTIONS,
  resolveConnectorAction,
  normalizeInstantlyAction,
  normalizeOrionAction
} = require("../CORE/ExecutionActionContracts");
const milesConnector = require("../CONNECTORS/MILES/connector");

function expect(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail ? ` :: ${JSON.stringify(detail)}` : ""}`);
  console.log(`[PASS] ${message}`);
}

const milesIntegrity = milesConnector.contractIntegrity();
expect(milesIntegrity.ok, "MILES action contract exactly matches real handler map", milesIntegrity);
expect(MILES_ACTIONS.includes("BUSINESS_EXECUTION"), "MILES business execution is explicitly supported");
expect(!resolveConnectorAction("MILES", "CHANGE_PRICING").supported, "unsupported MILES pricing action is rejected by contract");

expect(normalizeInstantlyAction("listCampaigns") === "listCampaigns", "Instantly native action resolves");
expect(normalizeInstantlyAction("LISTCAMPAIGNS") === "listCampaigns", "dispatcher-uppercase Instantly action resolves to executable form");
expect(normalizeInstantlyAction("INSTANTLY_LIST_CAMPAIGNS") === null, "unsupported synthetic Instantly action name is not silently accepted");
expect(INSTANTLY_ACTIONS.includes("activateCampaign"), "Instantly governed activation action is explicitly supported");

expect(normalizeOrionAction("ORION_OPPORTUNITIES") === "ORION_OPPORTUNITIES", "ORION canonical opportunity action resolves");
expect(normalizeOrionAction("search contractors") === "ORION_SEARCH_CONTRACTORS", "ORION natural search action resolves to executable form");
expect(ORION_ACTIONS.includes("ORION_SEARCH_CONTRACTORS"), "ORION contractor search is explicitly supported");
expect(!resolveConnectorAction("GOOGLE", "SEND_EMAIL").ephemeralConnectorAvailable, "unregistered ephemeral connector is rejected before TaskQueue");

console.log("=== EXECUTION ACTION CONTRACTS P0 PASS ===");
