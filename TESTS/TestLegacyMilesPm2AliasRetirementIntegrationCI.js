"use strict";

const fs = require("fs");
const path = require("path");
const { runPm2, parsePm2Jlist } = require("../SCRIPTS/ReconcilePm2Process");
const { retireLegacyAliases } = require("../SCRIPTS/ReconcileMilesProductionSurfaces");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const LEGACY_NAME = "miles-dashboard";
const UNRELATED_NAME = "miles-legacy-preserve-test";
const legacyFixture = path.join(ROOT, "SCRIPTS", "pm2-legacy-dashboard-fixture.js");
const unrelatedFixture = path.join(ROOT, "SCRIPTS", "pm2-unrelated-preserve-fixture.js");

function apps() {
  return parsePm2Jlist(runPm2(["jlist"]).stdout);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function cleanup() {
  runPm2(["delete", LEGACY_NAME], true);
  runPm2(["delete", UNRELATED_NAME], true);
  try { fs.unlinkSync(legacyFixture); } catch {}
  try { fs.unlinkSync(unrelatedFixture); } catch {}
}

try {
  cleanup();
  const fixtureBody = '"use strict";\nsetInterval(() => {}, 1000);\n';
  fs.writeFileSync(legacyFixture, fixtureBody, "utf8");
  fs.writeFileSync(unrelatedFixture, fixtureBody, "utf8");

  const legacyStart = runPm2(["start", legacyFixture, "--name", LEGACY_NAME], true);
  if (legacyStart.code !== 0) throw new Error(`Unable to create legacy dashboard fixture: ${legacyStart.stderr || legacyStart.stdout}`);
  const unrelatedStart = runPm2(["start", unrelatedFixture, "--name", UNRELATED_NAME], true);
  if (unrelatedStart.code !== 0) throw new Error(`Unable to create unrelated fixture: ${unrelatedStart.stderr || unrelatedStart.stdout}`);

  const before = apps();
  assert(before.some(app => app.name === LEGACY_NAME), "Legacy miles-dashboard fixture did not start.");
  assert(before.some(app => app.name === UNRELATED_NAME), "Unrelated PM2 fixture did not start.");

  const result = retireLegacyAliases();
  const after = apps();

  assert(result.retired.some(item => item.name === LEGACY_NAME), "Legacy miles-dashboard was not reported retired.");
  assert(!after.some(app => app.name === LEGACY_NAME), "Legacy miles-dashboard still exists after retirement.");
  assert(after.some(app => app.name === UNRELATED_NAME), "Unrelated PM2 app was incorrectly removed.");

  console.log(JSON.stringify({
    ok: true,
    test: "LEGACY_MILES_PM2_ALIAS_RETIREMENT_INTEGRATION_CI",
    legacyRetired: true,
    unrelatedPreserved: true
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
