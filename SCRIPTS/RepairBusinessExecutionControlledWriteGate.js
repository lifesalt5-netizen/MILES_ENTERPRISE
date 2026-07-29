"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const TARGET = path.join(
  ROOT,
  "SERVICES",
  "BusinessExecutionEngineService.js"
);

const CALL_BEFORE = `: this.defaultSteps(
            normalized.objective
          );`;

const CALL_AFTER = `: this.defaultSteps(
            normalized
          );`;

const METHOD_BEFORE = `  defaultSteps(objective) {
    return [
      {
        step: 1,
        provider: "MILES",
        connector: "MILES",
        capability:
          "PROVIDER_AUTHORITY",
        action:
          "PROVIDER_AUTHORITY",
        objective:
          "Verify provider authority, credentials, and write permissions."
      },
      {
        step: 2,
        provider: "MILES",
        connector: "MILES",
        capability:
          "PROVIDER_SYNC",
        action:
          "PROVIDER_SYNC",
        objective:
          "Synchronize provider and operating state."
      },
      {
        step: 3,
        provider: "MILES",
        connector: "MILES",
        capability:
          "INSTANTLY_LIVE",
        action:
          "INSTANTLY_LIVE",
        objective:
          "Perform live Instantly operating assessment."
      },
      {
        step: 4,
        provider: "MILES",
        connector: "MILES",
        capability:
          "BUSINESS_EXECUTION",
        action:
          "BUSINESS_EXECUTION",
        objective:
          objective ||
          "Execute the authorized business objective."
      },
      {
        step: 5,
        provider: "MILES",
        connector: "MILES",
        capability:
          "CONTROLLED_WRITE",
        action:
          "CONTROLLED_WRITE",
        objective:
          "Stage protected external changes for approval."
      }
    ];
  }`;

const METHOD_AFTER = `  defaultSteps(task = {}) {
    const plan =
      task.plan ||
      {};

    const payload =
      task.payload ||
      {};

    const requiresControlledWrite =
      plan.requiresControlledWrite === true ||
      plan.requiresApproval === true ||
      plan.stageOnly === true ||
      payload.requiresControlledWrite === true ||
      payload.requiresApproval === true ||
      payload.stageOnly === true ||
      task.requiresControlledWrite === true ||
      task.requiresApproval === true ||
      task.stageOnly === true;

    const steps = [
      {
        step: 1,
        provider: "MILES",
        connector: "MILES",
        capability:
          "PROVIDER_AUTHORITY",
        action:
          "PROVIDER_AUTHORITY",
        objective:
          "Verify provider authority, credentials, and write permissions."
      },
      {
        step: 2,
        provider: "MILES",
        connector: "MILES",
        capability:
          "PROVIDER_SYNC",
        action:
          "PROVIDER_SYNC",
        objective:
          "Synchronize provider and operating state."
      },
      {
        step: 3,
        provider: "MILES",
        connector: "MILES",
        capability:
          "INSTANTLY_LIVE",
        action:
          "INSTANTLY_LIVE",
        objective:
          "Perform live Instantly operating assessment."
      },
      {
        step: 4,
        provider: "MILES",
        connector: "MILES",
        capability:
          "BUSINESS_EXECUTION",
        action:
          "BUSINESS_EXECUTION",
        objective:
          task.objective ||
          "Execute the authorized business objective."
      }
    ];

    if (requiresControlledWrite) {
      steps.push({
        step: 5,
        provider: "MILES",
        connector: "MILES",
        capability:
          "CONTROLLED_WRITE",
        action:
          "CONTROLLED_WRITE",
        objective:
          "Stage protected external changes for approval."
      });
    }

    return steps;
  }`;

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);

  if (first < 0) {
    if (source.includes(after)) {
      return {
        source,
        changed: false,
        alreadyApplied: true
      };
    }

    throw new Error(
      `${label}: expected source block was not found.`
    );
  }

  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(
      `${label}: expected source block occurs more than once.`
    );
  }

  return {
    source:
      source.slice(0, first) +
      after +
      source.slice(first + before.length),
    changed: true,
    alreadyApplied: false
  };
}

function main() {
  if (!fs.existsSync(TARGET)) {
    throw new Error(`Target file not found: ${TARGET}`);
  }

  const original = fs.readFileSync(TARGET, "utf8");

  const callResult = replaceExactlyOnce(
    original,
    CALL_BEFORE,
    CALL_AFTER,
    "defaultSteps call"
  );

  const methodResult = replaceExactlyOnce(
    callResult.source,
    METHOD_BEFORE,
    METHOD_AFTER,
    "defaultSteps method"
  );

  const changed =
    callResult.changed ||
    methodResult.changed;

  if (!changed) {
    console.log(
      "Controlled-write gate repair is already applied."
    );
    return;
  }

  const backup = `${TARGET}.bak_controlled_write_gate`;

  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, original, "utf8");
  }

  fs.writeFileSync(
    TARGET,
    methodResult.source,
    "utf8"
  );

  console.log(
    "Applied conditional CONTROLLED_WRITE gate."
  );
  console.log(`Backup: ${backup}`);
  console.log(`Updated: ${TARGET}`);
}

main();
