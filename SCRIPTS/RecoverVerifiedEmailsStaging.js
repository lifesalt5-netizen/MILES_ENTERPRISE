"use strict";

const path = require("path");
const Service = require(
  "../SERVICES/GovernmentVerifiedEmailRecoveryService"
);

const ROOT = process.env.MILES_ROOT || process.cwd();

function parseArgs(argv = []) {
  const args = {
    apply: false,
    candidatesPath: null,
    searchRoots: [],
    outputRoot: null,
    runId: null,
    help: false
  };
  for (const value of argv) {
    if (value === "--apply") args.apply = true;
    else if (value === "--help" || value === "-h") args.help = true;
    else if (value.startsWith("--candidates=")) {
      args.candidatesPath = value.slice("--candidates=".length);
    } else if (value.startsWith("--search-root=")) {
      args.searchRoots.push(value.slice("--search-root=".length));
    } else if (value.startsWith("--output-root=")) {
      args.outputRoot = value.slice("--output-root=".length);
    } else if (value.startsWith("--run-id=")) {
      args.runId = value.slice("--run-id=".length);
    } else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      "Recover trusted historical verified emails into a staging-only reverification queue."
    );
    return { ok: true, mode: "HELP" };
  }
  const service = new Service({ root: ROOT });
  const options = {
    candidatesPath: args.candidatesPath
      ? path.resolve(args.candidatesPath)
      : undefined,
    searchRoots: args.searchRoots.map(value => path.resolve(value)),
    outputRoot: args.outputRoot
      ? path.resolve(args.outputRoot)
      : undefined,
    runId: args.runId || undefined
  };
  const result = args.apply
    ? await service.recover(options)
    : service.plan(options);
  console.log(JSON.stringify(result, null, 2));
  if (!args.apply) {
    console.log(
      "\nPLAN ONLY. Re-run with --apply to create the email reverification staging queue."
    );
  }
  return result;
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, run };
