"use strict";

const assert = require("assert");
const path = require("path");
const { buildPlan } = require("./ReconcilePm2Process");

const target = path.resolve("SCRIPTS/StartMilesApi.js");
const other = path.resolve("OTHER/SomeApi.js");

function app(pm_id, name, script, args = []) {
  return { pm_id, name, pm2_env: { pm_exec_path: script, status: "online", args }, pid: 1000 + pm_id };
}

let plan = buildPlan([], "miles-api", target);
assert.equal(plan.namedCorrect, false);
assert.deepEqual(plan.deleteIds, []);

plan = buildPlan([app(1, "miles-api", target)], "miles-api", target);
assert.equal(plan.namedCorrect, true);
assert.deepEqual(plan.deleteIds, []);

plan = buildPlan([app(2, "old-api-name", target)], "miles-api", target);
assert.equal(plan.namedCorrect, false);
assert.deepEqual(plan.deleteIds, [2]);

plan = buildPlan([app(3, "miles-api", other), app(4, "old-api-name", target)], "miles-api", target);
assert.equal(plan.namedCorrect, false);
assert.deepEqual(plan.deleteIds.sort((a, b) => a - b), [3, 4]);

plan = buildPlan([app(5, "miles-autonomous-coo", path.resolve("StartAutonomousCOO.js"), [])], "miles-autonomous-coo", path.resolve("StartAutonomousCOO.js"), ["--loop"]);
assert.equal(plan.namedCorrect, false);
assert.deepEqual(plan.deleteIds, [5]);

plan = buildPlan([app(6, "miles-autonomous-coo", path.resolve("StartAutonomousCOO.js"), ["--loop"])], "miles-autonomous-coo", path.resolve("StartAutonomousCOO.js"), ["--loop"]);
assert.equal(plan.namedCorrect, true);
assert.deepEqual(plan.deleteIds, []);

console.log("ReconcilePm2Process unit tests PASS");
console.log("ReconcilePm2Process args tests PASS");
