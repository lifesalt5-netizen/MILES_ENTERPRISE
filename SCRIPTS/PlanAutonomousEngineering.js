"use strict";

const path = require("path");
const AutonomousEngineeringPlanningService =
  require("../SERVICES/engineering/AutonomousEngineeringPlanningService");

function parseArguments(argv) {
  let objective = null;
  let persist = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--persist") {
      persist = true;
    } else if (value.startsWith("--objective=")) {
      objective = value.slice("--objective=".length);
    } else if (value === "--objective") {
      objective = argv[index + 1] || null;
      index += 1;
    }
  }

  return {
    objective:
      objective && objective.trim()
        ? objective.trim()
        : null,
    persist
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (!args.objective) {
    throw new Error(
      "Usage: node SCRIPTS/PlanAutonomousEngineering.js --objective=\"...\" [--persist]"
    );
  }

  const root =
    process.env.MILES_ROOT ||
    path.resolve(__dirname, "..");
  const service =
    new AutonomousEngineeringPlanningService({
      rootDir: root
    });
  const plan = service.createPlan({
    objective: args.objective
  });

  const result = {
    ok: true,
    mode: args.persist ? "PERSIST_PLAN" : "PLAN_ONLY",
    planId: plan.planId,
    planFingerprint: plan.planFingerprint,
    objective: plan.objective,
    repository: plan.repository,
    scope: plan.scope,
    risk: plan.risk,
    validation: plan.validation,
    authorization: plan.authorization,
    artifact: null
  };

  if (args.persist) {
    result.artifact = service.persistPlan(plan);
  }

  console.log(JSON.stringify(result, null, 2));

  if (!args.persist) {
    console.log(
      "\nPLAN ONLY. Re-run with --persist to retain the governed plan."
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
