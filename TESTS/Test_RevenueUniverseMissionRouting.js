"use strict";

const assert = require("assert");
const planner = require("../SERVICES/BusinessWorkPlannerService");
const connector = require("../CONNECTORS/MILES/connector");
const contracts = require("../CORE/ExecutionActionContracts");

async function main() {
  const b12 = await planner.plan({
    objective: "MILES EXECUTION ORDER — RECONCILE B12 LEAD UNIVERSE VS CURRENT 26K MASTER. Reconstruct the historical B12 prospect universe, compare it with the current master, recover valid companies, re-enrich missing contacts, rebuild campaign-ready inventory, and execute the audit, recovery, and controls now."
  });
  assert.strictEqual(b12.mode, "REVENUE_UNIVERSE_RECONCILIATION");
  assert.strictEqual(b12.revenueUniverseMission, true);
  assert.strictEqual(b12.governmentDataMission, false);
  assert.strictEqual(b12.workPackageCount, 1);
  assert.strictEqual(b12.workPackages[0].action, "REVENUE_UNIVERSE_RECONCILIATION");
  assert.strictEqual(b12.workPackages[0].connector, "MILES");
  assert.strictEqual(b12.workPackages[0].activationPolicy, "STAGING_ONLY_NO_AUTO_SEND_NO_SUPPRESSION_OVERRIDE");

  const fullUniverse = await planner.plan({
    objective: "Reconcile all 361,873 contractor entities into the P2GC revenue lifecycle. Every contractor must have a documented commercial disposition and next-action state. Do not limit lead generation to the existing ~26K master. Treat that file as one current outbound subset of the larger contractor universe. Build a continuous qualification, enrichment, verification, prioritization, outreach pipeline from the full 361,873-account database. Produce exact counts showing how all 361,873 contractors are distributed and identify the immediately recoverable addressable market. Execute the reconciliation and revenue-lifecycle build."
  });
  assert.strictEqual(fullUniverse.mode, "REVENUE_UNIVERSE_RECONCILIATION");
  assert.strictEqual(fullUniverse.revenueUniverseMission, true);
  assert.strictEqual(fullUniverse.governmentDataMission, false);
  assert.strictEqual(fullUniverse.workPackages[0].action, "REVENUE_UNIVERSE_RECONCILIATION");
  assert.notStrictEqual(fullUniverse.workPackages[0].action, "GSA_DATA_EXECUTION");

  const gsa = await planner.plan({
    objective: "Refresh and reconcile the GSA holder dataset and awarded SIN master from current government data sources."
  });
  assert.strictEqual(gsa.mode, "GOVERNMENT_DATA_EXECUTION");
  assert.strictEqual(gsa.revenueUniverseMission, false);
  assert.strictEqual(gsa.governmentDataMission, true);
  assert.strictEqual(gsa.workPackages[0].action, "GSA_DATA_EXECUTION");

  assert.ok(contracts.MILES_ACTIONS.includes("REVENUE_UNIVERSE_RECONCILIATION"));
  assert.strictEqual(connector.canExecuteAction("REVENUE_UNIVERSE_RECONCILIATION"), true);
  assert.deepStrictEqual(connector.contractIntegrity(), { ok: true, missingHandlers: [], undeclaredHandlers: [] });

  console.log("REVENUE_UNIVERSE_MISSION_ROUTING_TEST: GREEN");
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
