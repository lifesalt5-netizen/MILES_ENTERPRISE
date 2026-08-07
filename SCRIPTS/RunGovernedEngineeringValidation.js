"use strict";

const path = require("path");
const GovernedEngineeringValidationService =
  require("../SERVICES/engineering/GovernedEngineeringValidationService");

function parseArguments(argv) {
  const result = {
    planPath: null,
    manifestPath: null,
    apply: false
  };
  for (const value of argv) {
    if (value === "--apply") {
      result.apply = true;
    } else if (value.startsWith("--plan=")) {
      result.planPath = path.resolve(value.slice(7));
    } else if (value.startsWith("--manifest=")) {
      result.manifestPath = path.resolve(value.slice(11));
    }
  }
  return result;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (!args.planPath || !args.manifestPath) {
    throw new Error(
      "Usage: node SCRIPTS/RunGovernedEngineeringValidation.js --plan=... --manifest=... [--apply]"
    );
  }
  const service = new GovernedEngineeringValidationService();
  const result = service.run(args);
  console.log(JSON.stringify(result, null, 2));
  if (!args.apply) {
    console.log(
      "\nPLAN ONLY. Re-run with --apply to execute the authorized validation commands."
    );
  } else if (!result.ok) {
    process.exitCode = 1;
  }
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = { parseArguments, main };

