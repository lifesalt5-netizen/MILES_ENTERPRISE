"use strict";

const { runPm2 } = require("./ReconcilePm2Process");

const args = process.argv.slice(2);
if (!args.length) {
  console.log("Usage: node SCRIPTS/Pm2DirectCommand.js <pm2 args...>");
  process.exit(2);
}

try {
  const result = runPm2(args, true);
  if (result.stdout) process.stdout.write(result.stdout);
  // PM2 uses stderr for warnings such as "No process found" even when the
  // condition is expected during idempotent cleanup. Route captured PM2
  // diagnostics through stdout so Windows PowerShell does not turn harmless
  // native stderr into a terminating NativeCommandError. The real PM2 exit
  // code is preserved below and remains the source of truth.
  if (result.stderr) process.stdout.write(result.stderr);
  process.exitCode = result.code;
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
