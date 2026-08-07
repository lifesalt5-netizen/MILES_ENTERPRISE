"use strict";

const path = require("path");
const GovernedGitHubWorkflowService =
  require("../SERVICES/engineering/GovernedGitHubWorkflowService");

function parseArguments(argv) {
  const result = {
    planPath: null,
    manifestPath: null,
    validationPath: null,
    persist: false
  };
  for (const value of argv) {
    if (value === "--persist") result.persist = true;
    else if (value.startsWith("--plan=")) result.planPath = path.resolve(value.slice(7));
    else if (value.startsWith("--manifest=")) result.manifestPath = path.resolve(value.slice(11));
    else if (value.startsWith("--validation=")) result.validationPath = path.resolve(value.slice(13));
  }
  return result;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (!args.planPath || !args.manifestPath || !args.validationPath) {
    throw new Error(
      "Usage: node SCRIPTS/PrepareGovernedGitHubWorkflow.js --plan=... --manifest=... --validation=... [--persist]"
    );
  }
  const service = new GovernedGitHubWorkflowService();
  const workflow = service.buildWorkflow(args);
  const result = args.persist
    ? { ...workflow, mode: "PERSIST", artifact: service.persistWorkflow(workflow) }
    : workflow;
  console.log(JSON.stringify(result, null, 2));
  if (!args.persist) {
    console.log("\nPLAN ONLY. Re-run with --persist to save the governed GitHub workflow handoff.");
  }
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = { parseArguments, main };

