"use strict";

const assert = require("assert");
const path = require("path");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const {
  BusinessExecutionEngineService
} = require(
  "../SERVICES/BusinessExecutionEngineService"
);

function actionList(steps) {
  return steps.map(step => step.action);
}

function run() {
  const engine = new BusinessExecutionEngineService({
    providerAuthority: {},
    providerSync: {},
    instantlyLive: {},
    controlledWrite: {},
    businessOperationsBridge: {}
  });

  const safeSteps = engine.defaultSteps({
    objective: "Audit campaign and mailbox state.",
    payload: {
      dryRun: true
    }
  });

  assert.deepStrictEqual(
    actionList(safeSteps),
    [
      "PROVIDER_AUTHORITY",
      "PROVIDER_SYNC",
      "INSTANTLY_LIVE",
      "BUSINESS_EXECUTION"
    ],
    "Read-only/default work must not append CONTROLLED_WRITE."
  );

  const explicitWriteSteps = engine.defaultSteps({
    objective: "Stage an external campaign change.",
    payload: {
      requiresControlledWrite: true
    }
  });

  assert.deepStrictEqual(
    actionList(explicitWriteSteps),
    [
      "PROVIDER_AUTHORITY",
      "PROVIDER_SYNC",
      "INSTANTLY_LIVE",
      "BUSINESS_EXECUTION",
      "CONTROLLED_WRITE"
    ],
    "Explicit protected-write work must retain CONTROLLED_WRITE."
  );

  const approvalSteps = engine.defaultSteps({
    objective: "Stage protected work for approval.",
    plan: {
      requiresApproval: true
    }
  });

  assert.strictEqual(
    approvalSteps.at(-1).action,
    "CONTROLLED_WRITE",
    "Explicit approval metadata must preserve the approval gate."
  );

  console.log(
    "PASS: CONTROLLED_WRITE is conditional and legitimate approval gates remain intact."
  );
}

run();
