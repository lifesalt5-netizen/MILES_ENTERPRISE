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

const deployer = registry.get("DEPLOYER");
let unauthorizedBlocked = false;
try {
  deployer.execute({
    title: "Unauthorized deployment test",
    type: "DEPLOYER",
    authority: "AUTOMATIC_ENGINEERING"
  });
} catch (error) {
  unauthorizedBlocked =
    error && error.message === "DEPLOYMENT_AUTHORIZATION_REQUIRED";
}

if (!unauthorizedBlocked) {
  throw new Error("DEPLOYER did not fail closed without CEO deployment authorization.");
}

let unwiredBlocked = false;
try {
  deployer.execute({
    title: "Authorized deployment wiring test",
    type: "DEPLOYER",
    authorization: "CEO_DEPLOYMENT_APPROVED"
  });
} catch (error) {
  unwiredBlocked =
    error && error.message === "DEPLOYMENT_EXECUTION_NOT_WIRED";
}

if (!unwiredBlocked) {
  throw new Error("DEPLOYER did not fail closed while deployment execution remains unwired.");
}

console.log("WORKER_EXECUTION_BRIDGE_BOOTSTRAP_TEST_PASS 8/8");
console.log("DEPLOYER_FAIL_CLOSED_TEST_PASS 2/2");
