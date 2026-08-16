"use strict";

const fs = require("fs");
const path = require("path");
const { reconcile } = require("./ReconcilePm2Process");

const ROOT = process.env.MILES_ROOT || process.cwd();

const surfaces = [
  { name: "miles-api", script: "SCRIPTS/StartMilesApi.js", args: [] },
  { name: "miles-worker", script: "StartProductionSystem.js", args: [] },
  { name: "miles-command-center", script: "SERVICES/digital_coo/MilesCommandCenter.js", args: [] },
  { name: "miles-executive-dashboard", script: "StartExecutiveDashboard.js", args: [] },
  { name: "miles-desktop-ui", script: "StartMiles.js", args: [] },
  { name: "miles-autonomous-coo", script: "StartAutonomousCOO.js", args: ["--loop"] },
  { name: "p2gc-growth-demo", script: "StartP2GCGrowthBlueprintDemo.js", args: [] }
];

function exists(relativePath) {
  return fs.existsSync(path.resolve(ROOT, relativePath));
}

function run(selected = null) {
  const wanted = selected && selected.length ? new Set(selected) : null;
  const results = [];
  for (const item of surfaces) {
    if (wanted && !wanted.has(item.name)) continue;
    if (!exists(item.script)) throw new Error(`Missing production surface script: ${item.script}`);
    console.log(`=== RECONCILE ${item.name} ===`);
    results.push(reconcile(item.name, item.script, item.args));
  }
  console.log(JSON.stringify({ ok: true, surfaces: results }, null, 2));
  return results;
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

module.exports = { surfaces, run };
