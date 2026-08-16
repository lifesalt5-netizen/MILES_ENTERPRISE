"use strict";

const {
  MILES_ACTIONS,
  INSTANTLY_ACTIONS,
  ORION_ACTIONS
} = require("../CORE/ExecutionActionContracts");

const miles = require("../CONNECTORS/MILES/connector");
const instantly = require("../CONNECTORS/INSTANTLY/connector");
const orion = require("../CONNECTORS/ORION/connector");

function expect(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail ? ` :: ${JSON.stringify(detail)}` : ""}`);
  console.log(`[PASS] ${message}`);
}

function sameSet(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

const milesIntegrity = miles.contractIntegrity();
expect(milesIntegrity.ok, "MILES connector handler map matches canonical action contract", milesIntegrity);
expect(sameSet(miles.supportedActions, MILES_ACTIONS), "MILES runtime connector advertises canonical actions");
expect(miles.canExecuteAction("BUSINESS_EXECUTION") === true, "MILES BUSINESS_EXECUTION handler is executable");
expect(miles.canExecuteAction("CHANGE_PRICING") === false, "MILES unsupported pricing action remains non-executable");

expect(sameSet(instantly.supportedActions, INSTANTLY_ACTIONS), "Instantly runtime connector advertises canonical actions");
expect(instantly.canExecuteAction("listCampaigns") === true, "Instantly native listCampaigns is executable");
expect(instantly.canExecuteAction("LISTCAMPAIGNS") === true, "Instantly dispatcher-uppercase action is executable");
expect(instantly.canExecuteAction("UNKNOWN_ACTION") === false, "Instantly unknown action remains non-executable");

expect(sameSet(orion.supportedActions, ORION_ACTIONS), "ORION runtime connector advertises canonical actions");
expect(orion.canExecuteAction("ORION_OPPORTUNITIES") === true, "ORION opportunity action is executable");
expect(orion.canExecuteAction("search contractors") === true, "ORION contractor search normalization is executable");
expect(orion.canExecuteAction("ORION_UNKNOWN_ACTION") === false, "ORION unknown action remains non-executable");

console.log("=== CONNECTOR ACTION CONTRACT RUNTIME P0 PASS ===");
