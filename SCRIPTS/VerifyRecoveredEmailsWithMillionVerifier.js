"use strict";

const path = require("path");

function parseArgs(argv) {
  const options = {
    apply: false,
    authorizeCreditUse: false,
    inputPath: null,
    runId: null,
    maxCredits: 7493,
    pollIntervalMs: 10000,
    maxWaitMs: 7200000,
    help: false
  };
  for (const argument of argv) {
    if (argument === "--apply") options.apply = true;
    else if (argument === "--authorize-credit-use") {
      options.authorizeCreditUse = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument.startsWith("--input=")) {
      options.inputPath = argument.slice("--input=".length);
    } else if (argument.startsWith("--run-id=")) {
      options.runId = argument.slice("--run-id=".length);
    } else if (argument.startsWith("--max-credits=")) {
      options.maxCredits = Number(
        argument.slice("--max-credits=".length)
      );
    } else if (argument.startsWith("--poll-ms=")) {
      options.pollIntervalMs = Number(
        argument.slice("--poll-ms=".length)
      );
    } else if (argument.startsWith("--max-wait-ms=")) {
      options.maxWaitMs = Number(
        argument.slice("--max-wait-ms=".length)
      );
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node SCRIPTS/VerifyRecoveredEmailsWithMillionVerifier.js",
    "  node SCRIPTS/VerifyRecoveredEmailsWithMillionVerifier.js " +
      "--apply --authorize-credit-use",
    "",
    "Environment:",
    "  MILES_ROOT",
    "  MILLIONVERIFIER_API_KEY",
    "",
    "Safety:",
    "  Uses at most 7,493 existing verification credits.",
    "  Creates staging artifacts only.",
    "  Does not send email or modify campaigns/ORION/DATA/OUTBOUND."
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
    "../SERVICES/MillionVerifierBulkVerificationService"
  );
  const service = new Service({ root });
  const apiKey = process.env.MILLIONVERIFIER_API_KEY || "";
  if (!options.apply) {
    const plan = await service.plan({ ...options, apiKey });
    console.log(JSON.stringify(plan, null, 2));
    console.log(
      "\nPLAN ONLY. Re-run with --apply --authorize-credit-use " +
      "to submit the deduplicated list."
    );
    return plan;
  }
  const result = await service.verify({
    ...options,
    apiKey,
    onProgress(progress) {
      console.error(
        `[MILLIONVERIFIER] status=${progress.status} ` +
        `progress=${progress.percent}% ` +
        `estimatedSeconds=${progress.estimatedTimeSeconds}`
      );
    }
  });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  usage
};
