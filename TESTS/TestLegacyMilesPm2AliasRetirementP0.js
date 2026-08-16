"use strict";

const path = require("path");
const assert = require("assert");
const {
  CANONICAL_NAMES,
  LEGACY_ALIASES,
  isInsideMilesRoot,
  buildLegacyRetirementPlan
} = require("../SCRIPTS/ReconcileMilesProductionSurfaces");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

function app(name, pmId, execPath, status = "online") {
  return {
    name,
    pm_id: pmId,
    pm2_env: { name, pm_exec_path: execPath, status }
  };
}

function main() {
  assert(LEGACY_ALIASES.has("miles-ui"));
  assert(LEGACY_ALIASES.has("miles-dashboard"));
  assert(!CANONICAL_NAMES.has("miles-ui"));
  assert(!CANONICAL_NAMES.has("miles-dashboard"));

  const legacyUi = path.join(ROOT, "StartMilesLegacy.js");
  const legacyDashboard = path.join(ROOT, "StartDashboardLegacy.js");
  const canonicalDashboard = path.join(ROOT, "StartExecutiveDashboard.js");
  const unrelatedInsideRoot = path.join(ROOT, "tools", "other-service.js");
  const outsideRoot = path.resolve(ROOT, "..", "OTHER_APP", "server.js");

  assert.strictEqual(isInsideMilesRoot(legacyUi), true);
  assert.strictEqual(isInsideMilesRoot(outsideRoot), false);

  const plan = buildLegacyRetirementPlan([
    app("miles-ui", 1, legacyUi),
    app("miles-dashboard", 2, legacyDashboard),
    app("miles-executive-dashboard", 3, canonicalDashboard),
    app("unrelated-app", 4, unrelatedInsideRoot),
    app("miles-dashboard", 5, outsideRoot)
  ]);

  assert.deepStrictEqual(plan.retire.map(x => x.pmId).sort((a,b)=>a-b), [1,2]);
  assert.deepStrictEqual(plan.preserve.map(x => x.pmId), [5]);
  assert.strictEqual(plan.preserve[0].reason, "outside_miles_root");

  console.log(JSON.stringify({
    ok: true,
    test: "LEGACY_MILES_PM2_ALIAS_RETIREMENT_P0",
    retiredIds: plan.retire.map(x => x.pmId),
    preservedOutsideRootIds: plan.preserve.map(x => x.pmId),
    unrelatedAppsUntouched: true,
    canonicalAppsUntouched: true
  }, null, 2));
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}
