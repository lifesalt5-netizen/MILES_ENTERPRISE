"use strict";

const fs = require("fs");
const path = require("path");
const {
  reconcile,
  runPm2,
  parsePm2Jlist,
  normalizePath
} = require("./ReconcilePm2Process");

const ROOT = process.env.MILES_ROOT || process.cwd();

const surfaces = [
  { name: "miles-api", script: "SCRIPTS/StartMilesApi.js", args: [] },
  { name: "miles-worker", script: "StartProductionSystem.js", args: [] },
  { name: "miles-command-center", script: "SERVICES/digital_coo/MilesCommandCenter.js", args: [] },
  { name: "miles-executive-dashboard", script: "StartExecutiveDashboard.js", args: [] },
  { name: "miles-desktop-ui", script: "StartMiles.js", args: [] },
  { name: "miles-autonomous-coo", script: "StartAutonomousCOO.js", args: ["--loop"] },
  { name: "p2gc-growth-demo", script: "StartP2GCGrowthBlueprintDemo.js", args: [] },
  { name: "p2gc-customer-delivery", script: "StartP2GCCustomerDelivery.js", args: [] }
];

const CANONICAL_NAMES = new Set(surfaces.map(item => item.name));
const LEGACY_ALIASES = new Set([
  "miles-ui",
  "miles-dashboard"
]);

function exists(relativePath) {
  return fs.existsSync(path.resolve(ROOT, relativePath));
}

function isInsideMilesRoot(execPath) {
  const root = normalizePath(ROOT);
  const target = normalizePath(execPath);
  if (!root || !target) return false;
  const separator = process.platform === "win32" ? "\\" : "/";
  return target === root || target.startsWith(`${root}${separator}`);
}

function buildLegacyRetirementPlan(apps) {
  const retire = [];
  const preserve = [];

  for (const app of Array.isArray(apps) ? apps : []) {
    const name = String(app?.name || app?.pm2_env?.name || "");
    if (!LEGACY_ALIASES.has(name) || CANONICAL_NAMES.has(name)) continue;

    const execPath = app?.pm2_env?.pm_exec_path || "";
    const record = {
      name,
      pmId: app?.pm_id,
      execPath,
      status: app?.pm2_env?.status || null
    };

    if (isInsideMilesRoot(execPath)) retire.push(record);
    else preserve.push({ ...record, reason: "outside_miles_root" });
  }

  return { retire, preserve };
}

function retireLegacyAliases() {
  const apps = parsePm2Jlist(runPm2(["jlist"]).stdout);
  const plan = buildLegacyRetirementPlan(apps);
  const retired = [];

  for (const item of plan.retire) {
    if (item.pmId === undefined || item.pmId === null) {
      throw new Error(`Legacy MILES PM2 alias ${item.name} has no pm_id and cannot be retired safely.`);
    }
    const result = runPm2(["delete", String(item.pmId)], true);
    if (result.code !== 0) {
      throw new Error(`Unable to retire legacy MILES PM2 alias ${item.name}#${item.pmId}: ${result.stderr || result.stdout}`.trim());
    }
    retired.push(item);
    console.log(`[LEGACY RETIRED] ${item.name}#${item.pmId} script=${item.execPath}`);
  }

  for (const item of plan.preserve) {
    console.log(`[LEGACY PRESERVED] ${item.name}#${item.pmId ?? "?"} script=${item.execPath || "unknown"} reason=${item.reason}`);
  }

  return { retired, preserved: plan.preserve };
}

function run(selected = null) {
  const wanted = selected && selected.length ? new Set(selected) : null;
  const legacy = retireLegacyAliases();
  const results = [];

  for (const item of surfaces) {
    if (wanted && !wanted.has(item.name)) continue;
    if (!exists(item.script)) throw new Error(`Missing production surface script: ${item.script}`);
    console.log(`=== RECONCILE ${item.name} ===`);
    results.push(reconcile(item.name, item.script, item.args));
  }

  console.log(JSON.stringify({ ok: true, legacy, surfaces: results }, null, 2));
  return { legacy, surfaces: results };
}

if (require.main === module) {
  try {
    const selected = process.argv.slice(2);
    run(selected);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = {
  surfaces,
  CANONICAL_NAMES,
  LEGACY_ALIASES,
  isInsideMilesRoot,
  buildLegacyRetirementPlan,
  retireLegacyAliases,
  run
};
