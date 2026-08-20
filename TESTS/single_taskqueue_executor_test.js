"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const entry = path.join(root, "StartAutonomousCOO.js");
const source = fs.readFileSync(entry, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /const\s+cooQueueExecution\s*=\s*false\s*;/.test(source),
  "Autonomous COO must explicitly disable direct TaskQueue execution."
);

assert(
  /enableExecution:\s*cooQueueExecution/.test(source),
  "AutonomousCOOLoopService must receive cooQueueExecution."
);

assert(
  /const\s+revenueExecution\s*=\s*boolFromEnv\("MILES_AUTONOMOUS_EXECUTE",\s*true\)/.test(source),
  "Revenue-sidecar execution governance must remain separately controlled."
);

assert(
  /enableExecution:\s*revenueExecution/.test(source),
  "Capture Capacity revenue execution must preserve the governed revenue flag."
);

console.log("SINGLE_TASKQUEUE_EXECUTOR_TEST: GREEN");
