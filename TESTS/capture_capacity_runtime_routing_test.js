"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runtimeFile = path.resolve(__dirname, "..", "CORE", "Runtime", "MilesRuntime.js");
const source = fs.readFileSync(runtimeFile, "utf8");

assert.match(
  source,
  /CaptureCapacityAutonomousExecutionService/,
  "MilesRuntime must load the governed Capture Capacity executor."
);

assert.match(
  source,
  /workItem\.capability === "revenue\.capture_capacity_handoff"/,
  "Qualified Capture Capacity work must enter the direct governed revenue lane."
);

assert.match(
  source,
  /capability:\s*workItem\.capability \|\| null/,
  "Normal discovery work must preserve capability metadata into planning."
);

assert.match(
  source,
  /action:\s*workItem\.action \|\| null/,
  "Normal discovery work must preserve action metadata into planning."
);

assert.match(
  source,
  /workflowStatus:\s*"DIRECT_GOVERNED_REVENUE_EXECUTION"/,
  "Capture Capacity handoff must be auditable as direct governed revenue execution."
);

console.log("PASS capture_capacity_runtime_routing_test");
