"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const entrypoint = path.resolve(__dirname, "..", "StartAutonomousCOO.js");
const source = fs.readFileSync(entrypoint, "utf8");

assert.match(
  source,
  /CaptureCapacityProductionLoopService/,
  "Production Autonomous COO must load the Capture Capacity production lane."
);

assert.match(
  source,
  /new CaptureCapacityProductionLoopService\(\{[\s\S]*intervalMs,[\s\S]*enableExecution: execute/,
  "Capture Capacity production lane must share the COO cadence and execution governance."
);

assert.match(
  source,
  /const captureCapacityStart = captureCapacity\.start\(\)/,
  "Loop mode must start the Capture Capacity production lane."
);

assert.match(
  source,
  /const captureCapacityResult = await captureCapacity\.runOnce\(\)/,
  "One-cycle mode must execute one Capture Capacity production pass."
);

assert.match(
  source,
  /auto-activation=disabled/,
  "Production startup output must explicitly state that campaign auto-activation is disabled."
);

console.log("PASS capture_capacity_production_entrypoint_test");
