"use strict";

const path = require("path");
const CurrentPhaseRevenueStatusService = require("./SERVICES/revenue/CurrentPhaseRevenueStatusService");

function main() {
  const rootDir = path.resolve(process.env.MILES_ROOT || __dirname);
  const service = new CurrentPhaseRevenueStatusService({ rootDir });
  const result = service.execute({ writeReport: true });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
