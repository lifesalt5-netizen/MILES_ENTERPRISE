"use strict";

const fs = require("fs");
const path = require("path");
const GovernedCodeModificationService =
  require("../SERVICES/engineering/GovernedCodeModificationService");

function parseArguments(argv) {
  const result = {
    planPath: null,
    changeSetPath: null,
    outputPath: null,
    approvedBy: "CEO",
    expiresMinutes: 15,
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
    } else if (value.startsWith("--output=")) {
      result.outputPath =
        path.resolve(value.slice("--output=".length));
    } else if (value.startsWith("--approved-by=")) {
      result.approvedBy =
        value.slice("--approved-by=".length);
    } else if (value.startsWith("--expires-minutes=")) {
      result.expiresMinutes = Number(
        value.slice("--expires-minutes=".length)
      );
    }
  }
  return result;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (
    !args.planPath ||
    !args.changeSetPath ||
    !args.outputPath
  ) {
    throw new Error(
      "Usage: node SCRIPTS/AuthorizeGovernedCodeChange.js --plan=... --changes=... --output=... [--apply]"
    );
  }

  const service =
    new GovernedCodeModificationService();
  const plan = service.readJson(
    args.planPath,
    "ENGINEERING_PLAN"
  );
  const graph = service.readJson(
    service.graphPath,
    "REPOSITORY_GRAPH"
  );
  const rawChangeSet = service.readJson(
    args.changeSetPath,
    "CHANGE_SET"
  );
  const changeSet =
    service.normalizeChangeSet(rawChangeSet);

  service.validatePlan(
    plan,
    graph,
    changeSet
  );
  service.validateCurrentFiles(changeSet);

  const approval = service.createApproval({
    planId: plan.planId,
    planFingerprint: plan.planFingerprint,
    repositoryFingerprint:
      changeSet.repositoryFingerprint,
    changeSetSha256:
      changeSet.changeSetSha256,
    approvedFiles:
      changeSet.changes.map(change => change.path),
    approvedBy: args.approvedBy,
    expiresInMs:
      args.expiresMinutes * 60 * 1000
  });

  const result = {
    ok: true,
    mode:
      args.apply
        ? "APPROVAL_WRITTEN"
        : "APPROVAL_PREVIEW",
    planId: approval.planId,
    changeSetSha256:
      approval.changeSetSha256,
    approvedFiles:
      approval.approvedFiles,
    approvedBy:
      approval.approvedBy,
    issuedAt:
      approval.issuedAt,
    expiresAt:
      approval.expiresAt,
    outputPath:
      args.apply
        ? args.outputPath
        : null
  };

  if (args.apply) {
    fs.mkdirSync(
      path.dirname(args.outputPath),
      { recursive: true }
    );
    service.atomicWrite(
      args.outputPath,
      JSON.stringify(approval, null, 2)
    );
  }

  console.log(JSON.stringify(result, null, 2));

  if (!args.apply) {
    console.log(
      "\nAPPROVAL PREVIEW ONLY. Re-run with --apply for explicit CEO authorization."
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
