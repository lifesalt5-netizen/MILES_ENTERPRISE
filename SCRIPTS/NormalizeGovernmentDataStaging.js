"use strict";

const path = require("path");
const GovernmentDataNormalizerService =
  require("../SERVICES/GovernmentDataNormalizerService");

const ROOT = process.env.MILES_ROOT || process.cwd();

function parseArgs(argv = []) {
  const args = {
    apply: false,
    samDatPath: null,
    outputRoot: null,
    runId: null,
    help: false
  };

  for (const value of argv) {
    if (value === "--apply") {
      args.apply = true;
    } else if (value === "--help" || value === "-h") {
      args.help = true;
    } else if (value.startsWith("--sam-dat=")) {
      args.samDatPath = value.slice("--sam-dat=".length);
    } else if (value.startsWith("--output-root=")) {
      args.outputRoot = value.slice("--output-root=".length);
    } else if (value.startsWith("--run-id=")) {
      args.runId = value.slice("--run-id=".length);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return args;
}

function helpText() {
  return [
    "Normalize the SAM Public V2 DAT inside government-data staging.",
    "",
    "Plan only (default):",
    "  node SCRIPTS/NormalizeGovernmentDataStaging.js --sam-dat=<path>",
    "",
    "Write normalized JSONL artifacts inside staging only:",
    "  node SCRIPTS/NormalizeGovernmentDataStaging.js --apply --sam-dat=<path>",
    "",
    "This step does not write to ORION, DATA/OUTBOUND, TaskQueue,",
    "Instantly, campaigns, or mailboxes. It does not authorize loading."
  ].join("\n");
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(helpText());
    return { ok: true, mode: "HELP" };
  }
  if (!args.samDatPath) {
    throw new Error("--sam-dat=<path> is required.");
  }

  const service = new GovernmentDataNormalizerService({
    root: ROOT
  });
  const options = {
    samDatPath: path.resolve(args.samDatPath),
    outputRoot: args.outputRoot
      ? path.resolve(args.outputRoot)
      : undefined,
    runId: args.runId || undefined
  };

  if (!args.apply) {
    const plan = service.plan(options);
    console.log(JSON.stringify(plan, null, 2));
    console.log(
      "\nPLAN ONLY. Re-run with --apply to write normalized artifacts inside staging."
    );
    return plan;
  }

  const result = await service.normalize(options);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
  return result;
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  helpText,
  run
};
