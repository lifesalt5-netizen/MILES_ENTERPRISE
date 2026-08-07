"use strict";

const path = require("path");
const GovernedCodeModificationService =
  require("../SERVICES/engineering/GovernedCodeModificationService");

function parseArguments(argv) {
  const result = {
    planPath: null,
    changeSetPath: null,
    approvalPath: null,
    apply: false
  };

  for (const value of argv) {
    if (value === "--apply") {
      result.apply = true;
    } else if (value.startsWith("--plan=")) {
      result.planPath =
        path.resolve(value.slice("--plan=".length));
    } else if (value.startsWith("--changes=")) {
      result.changeSetPath =
        path.resolve(value.slice("--changes=".length));
    } else if (value.startsWith("--approval=")) {
      result.approvalPath =
        path.resolve(value.slice("--approval=".length));
    }
  }
  return result;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (
    !args.planPath ||
    !args.changeSetPath ||
    !args.approvalPath
  ) {
    throw new Error(
      "Usage: node SCRIPTS/ApplyGovernedCodeChange.js --plan=... --changes=... --approval=... [--apply]"
    );
  }

  const service =
    new GovernedCodeModificationService();
  const result = service.apply(args);
  console.log(JSON.stringify(result, null, 2));

  if (!args.apply) {
    console.log(
      "\nPREVIEW ONLY. Re-run with --apply to perform the authorized source replacement."
    );
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

module.exports = {
  parseArguments,
  main
};
