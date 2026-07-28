"use strict";

const path = require("path");

function parseArgs(argv) {
  const options = {
    apply: false,
    legacyMasterPath: null,
    verifiedPath: null,
    allowlistPath: null,
    verificationReportPath: null,
    outputRoot: null,
    runId: null,
    help: false
  };
  for (const argument of argv) {
    if (argument === "--apply") options.apply = true;
    else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument.startsWith("--legacy-master=")) {
      options.legacyMasterPath =
        argument.slice("--legacy-master=".length);
    } else if (argument.startsWith("--verified=")) {
      options.verifiedPath = argument.slice("--verified=".length);
    } else if (argument.startsWith("--allowlist=")) {
      options.allowlistPath = argument.slice("--allowlist=".length);
    } else if (argument.startsWith("--verification-report=")) {
      options.verificationReportPath =
        argument.slice("--verification-report=".length);
    } else if (argument.startsWith("--output-root=")) {
      options.outputRoot = argument.slice("--output-root=".length);
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
    "  node SCRIPTS/ReconcileLegacySegmentsStaging.js",
    "  node SCRIPTS/ReconcileLegacySegmentsStaging.js --apply",
    "",
    "MILES automatically locates the latest completed verification run,",
    "the current GSA allowlist, and MASTER_DEDUPED_ALL_SEGMENTS.csv.",
    "",
    "Safety:",
    "  Staging only. It does not delete legacy files, import leads,",
    "  change ORION/DATA/OUTBOUND, or modify/send campaigns."
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
    "../SERVICES/LegacySegmentReconciliationService"
  );
  const service = new Service({ root });
  if (!options.apply) {
    const plan = service.plan(options);
    console.log(JSON.stringify(plan, null, 2));
    console.log(
      "\nPLAN ONLY. Re-run with --apply to create staging artifacts."
    );
    return plan;
  }
  const result = await service.reconcile(options);
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
