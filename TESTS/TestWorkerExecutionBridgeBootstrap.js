"use strict";

const WorkerExecutionBridge = require("../SERVICES/WorkerExecutionBridge");
const registry = require("../SERVICES/WorkerRegistry");

const expected = [
  "SELF_DEVELOPMENT",
  "ARCHITECT",
  "BUILDER",
  "VALIDATOR",
  "TESTER",
  "DEPLOYER",
  "RECOVERY",
  "ATLAS"
];

const bridge = new WorkerExecutionBridge();

if (!bridge) {
  throw new Error("WorkerExecutionBridge failed to construct.");
}

for (const name of expected) {
  const worker = registry.get(name);

  if (!worker) {
    throw new Error(`Worker not registered by bridge bootstrap: ${name}`);
  }

  if (typeof worker.execute !== "function") {
    throw new Error(`Worker does not expose execute(): ${name}`);
  }
}

console.log("WORKER_EXECUTION_BRIDGE_BOOTSTRAP_TEST_PASS 8/8");
