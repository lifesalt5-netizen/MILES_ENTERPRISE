"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

function run() {
  const root = path.resolve(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "StartAutonomousCOO.js"), "utf8");

  assert(source.includes('require("./SERVICES/revenue/WinBackProductionLoopService")'), "production entrypoint must import Win-Back sidecar");
  assert(source.includes("new WinBackProductionLoopService"), "production entrypoint must instantiate Win-Back sidecar");
  assert(source.includes("P2GC_WINBACK_DISCOVERY_INTERVAL_MS"), "Win-Back cadence must be independently configurable");
  assert(source.includes("winBack.start()"), "loop mode must start Win-Back recovery");
  assert(source.includes("await winBack.runOnce()"), "one-shot production mode must execute Win-Back recovery");
  assert(source.includes("winBack.stop()"), "production shutdown must stop Win-Back sidecar");
  assert(source.includes("Instantly-mutation=disabled; auto-activation=disabled"), "startup log must disclose no-mutation/no-activation policy");
  assert(source.includes("DATA/runtime/revenue/winback/production_lane_latest.json"), "production output must expose Win-Back artifact path");

  process.stdout.write("PASS winback_production_entrypoint_test\n");
}

run();
