"use strict";

/*
==========================================================
 MILES OS
 BUILD_044 Runner
 Operation Execution Kernel
 Version: 1.0.0
==========================================================
*/

const path = require("path");

process.env.MILES_ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

const kernel = require("../SERVICES/operation_kernel/OperationExecutionKernel");

async function main() {
  const result = kernel.run();
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error("[BUILD_044] FAILED:", err);
  process.exit(1);
});