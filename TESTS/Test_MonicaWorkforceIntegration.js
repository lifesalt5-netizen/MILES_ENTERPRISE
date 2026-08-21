"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const registryPath = path.join(root, "CONFIG", "WORKFORCE", "MILES_WORKFORCE_REGISTRY.json");
const profilePath = path.join(root, "CONFIG", "WORKFORCE", "MONICA_WORKFORCE_PROFILE.json");

assert.ok(fs.existsSync(registryPath), "canonical workforce registry must exist");
assert.ok(fs.existsSync(profilePath), "MONICA workforce profile must exist");

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
const employees = Array.isArray(registry.employees) ? registry.employees : [];
const monicas = employees.filter(e => String(e.id || e.name || "").toLowerCase() === "monica");

assert.strictEqual(monicas.length, 1, "MONICA must be registered exactly once in canonical workforce registry");
assert.strictEqual(monicas[0].name, "Monica");
assert.strictEqual(monicas[0].authority, "operational_recommendation_read_only");
assert.strictEqual(profile.governance.activationBlocked, true, "MONICA activation must remain blocked");
assert.ok(monicas[0].owns.includes("NET_NEW_ACQUISITION_SEGMENT_CENSUS"));

const workforce = require("../SERVICES/WorkforceService");
const byName = workforce.findByName("Monica");
assert.ok(byName, "WorkforceService must recognize MONICA by name");

const resolution = workforce.resolveBestWorker("NET_NEW_ACQUISITION_SEGMENT_CENSUS");
assert.strictEqual(resolution.ok, true, "WorkforceService must resolve MONICA census capability");
assert.ok(resolution.worker, "WorkforceService must return a worker");
assert.strictEqual(resolution.worker.employee, "Monica", "MONICA must own NET_NEW_ACQUISITION_SEGMENT_CENSUS");
assert.ok(resolution.worker.score >= 250, "MONICA census ownership should resolve as an exact declared capability");

console.log(JSON.stringify({
  ok: true,
  twin: "MONICA",
  registry: "PASS",
  workforceRecognition: "PASS",
  capability: "NET_NEW_ACQUISITION_SEGMENT_CENSUS",
  resolvedWorker: resolution.worker.employee,
  score: resolution.worker.score,
  mode: "DISCOVERY_ONLY",
  activationBlocked: true
}, null, 2));
