"use strict";

const assert = require("assert");
const path = require("path");
const { buildPlan } = require("./ReconcilePm2Process");

const target = path.resolve("SCRIPTS/StartMilesApi.js");
const other = path.resolve("OTHER/SomeApi.js");

function app(pm_id, name, script) {
  return { pm_id, name, pm2_env: { pm_exec_path: script, status: "online" }, pid: 1000 + pm_id };
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

console.log("ReconcilePm2Process unit tests PASS");
