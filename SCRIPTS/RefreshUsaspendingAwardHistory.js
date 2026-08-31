"use strict";

const path = require("path");

function parseArgs(argv) {
  const options = {
    apply: false,
    startDate: null,
    endDate: null,
    runId: null,
    help: false
  };
  for (const argument of argv) {
    if (argument === "--apply") options.apply = true;
    else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument.startsWith("--start=")) {
      options.startDate = argument.slice("--start=".length);
    } else if (argument.startsWith("--end=")) {
      options.endDate = argument.slice("--end=".length);
    } else if (argument.startsWith("--run-id=")) {
      options.runId = argument.slice("--run-id=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node SCRIPTS/RefreshUsaspendingAwardHistory.js",
    "  node SCRIPTS/RefreshUsaspendingAwardHistory.js --apply",
    "",
    "Defaults:",
    "  --start=2026-02-01",
    "  --end=current date",
    "",
    "Safety:",
    "  Downloads contract/IDV prime and subaward history into staging.",
    "  Does not write ORION or the operational award dataset."
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const root = path.resolve(
    process.env.MILES_ROOT || path.join(__dirname, "..")
  );
  const Service = require(
    "../SERVICES/UsaspendingAwardHistoryStagingService"
  );
  const service = new Service({ root });
  if (!options.apply) {
    const plan = service.plan(options);
    console.log(JSON.stringify(plan, null, 2));
    console.log(
      "\nPLAN ONLY. Re-run with --apply to download into staging."
    );
    return plan;
  }
  const result = await service.refresh(options);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, usage };
