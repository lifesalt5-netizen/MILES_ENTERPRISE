"use strict";

try {
  require("dotenv").config();
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}

const RevenueOperationsInventorySyncService =
  require("../SERVICES/revenue/RevenueOperationsInventorySyncService");

function parseArguments(argv) {
  return { apply: argv.includes("--apply"), live: argv.includes("--live") };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const result = await new RevenueOperationsInventorySyncService().sync(args);
  console.log(JSON.stringify(result, null, 2));
  if (!args.apply) console.log("\nPLAN ONLY. Re-run with --apply --live to synchronize internal revenue inventories.");
  if (result.ok !== true) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArguments, main };

