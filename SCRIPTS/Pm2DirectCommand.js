"use strict";

const { runPm2 } = require("./ReconcilePm2Process");

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: node SCRIPTS/Pm2DirectCommand.js <pm2 args...>");
  process.exit(2);
}

try {
  const result = runPm2(args, true);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.code;
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
