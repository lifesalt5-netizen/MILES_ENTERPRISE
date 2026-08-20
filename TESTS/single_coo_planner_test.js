"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const worker = fs.readFileSync(path.join(root, "WORKERS", "cooWorker.js"), "utf8");
const entry = fs.readFileSync(path.join(root, "StartAutonomousCOO.js"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  !/require\(["']\.\.\/SERVICES\/AutonomousCOOLoopService["']\)/.test(worker),
  "cooWorker must not instantiate AutonomousCOOLoopService."
);

assert(
  !/\.runOnce\s*\(/.test(worker) && !/\.runCycle\s*\(/.test(worker),
  "cooWorker must not execute a COO planning cycle."
);

assert(
  /COO_PLANNING_DELEGATED/.test(worker),
  "cooWorker must preserve an explicit delegated COO_RESULT contract."
);

assert(
  /new AutonomousCOOLoopService\s*\(/.test(entry),
  "StartAutonomousCOO must remain the dedicated COO planner entrypoint."
);

console.log("SINGLE_COO_PLANNER_TEST: GREEN");
