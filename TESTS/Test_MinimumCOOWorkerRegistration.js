"use strict";

const fs = require("fs");
const path = require("path");
const WorkerExecutionBridge = require("../SERVICES/WorkerExecutionBridge");
const registry = require("../SERVICES/WorkerRegistry");

const required = ["SELF_DEVELOPMENT", "ARCHITECT", "BUILDER"];
const bridge = new WorkerExecutionBridge();
const registration = bridge.ensureWorkersRegistered();

const missing = required.filter(type => !registry.get(type));
const invalid = required.filter(type => {
  const worker = registry.get(type);
  return !worker || typeof worker.execute !== "function";
});

const result = {
  ok: missing.length === 0 && invalid.length === 0,
  gate: "MINIMUM_COO_WORKER_REGISTRATION",
  required,
  registered: registry.list(),
  missing,
  invalid,
  registration
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
