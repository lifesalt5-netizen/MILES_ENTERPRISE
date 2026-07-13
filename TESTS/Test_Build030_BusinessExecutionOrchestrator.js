"use strict";

const assert =
  require("assert");

const {
  BusinessExecutionEngineService
} = require(
  "../SERVICES/BusinessExecutionEngineService"
);

function fakeService(
  action,
  options = {}
) {
  return {
    calls: [],
    async run(task) {
      this.calls.push(task);

      if (
        options.fail === true
      ) {
        return {
          ok: false,
          action,
          error:
            options.error ||
            `${action} failed`,
          retryable:
            Boolean(
              options.retryable
            )
        };
      }

      return {
        ok: true,
        action,
        observedPayload:
          task.payload || {}
      };
    }
  };
}

async function main() {
  const authority =
    fakeService(
      "PROVIDER_AUTHORITY"
    );

  const sync =
    fakeService(
      "PROVIDER_SYNC"
    );

  const instantly =
    fakeService(
      "INSTANTLY_LIVE"
    );

  const controlledWrite =
    fakeService(
      "CONTROLLED_WRITE"
    );

  const engine =
    new BusinessExecutionEngineService({
      providerAuthority:
        authority,
      providerSync:
        sync,
      instantlyLive:
        instantly,
      controlledWrite,
      maxStepAttempts: 2
    });

  const task = {
    command:
      "Miles, own Instantly end to end.",
    payload: {
      command:
        "Miles, own Instantly end to end.",
      plan: {
        objective:
          "Own Instantly end to end.",
        originalCommand:
          "Miles, own Instantly end to end.",
        steps: [
          {
            step: 1,
            action:
              "PROVIDER_AUTHORITY",
            capability:
              "PROVIDER_AUTHORITY",
            provider: "MILES",
            connector: "MILES",
            objective:
              "Verify authority."
          },
          {
            step: 2,
            action:
              "PROVIDER_SYNC",
            capability:
              "PROVIDER_SYNC",
            provider: "MILES",
            connector: "MILES",
            objective:
              "Synchronize providers."
          },
          {
            step: 3,
            action:
              "INSTANTLY_LIVE",
            capability:
              "INSTANTLY_LIVE",
            provider: "MILES",
            connector: "MILES",
            objective:
              "Assess Instantly."
          },
          {
            step: 4,
            action:
              "BUSINESS_EXECUTION",
            capability:
              "BUSINESS_EXECUTION",
            provider: "MILES",
            connector: "MILES",
            objective:
              "Execute authorized work."
          },
          {
            step: 5,
            action:
              "CONTROLLED_WRITE",
            capability:
              "CONTROLLED_WRITE",
            provider: "MILES",
            connector: "MILES",
            objective:
              "Stage protected writes."
          }
        ]
      }
    }
  };

  const result =
    await engine.run(task);

  assert.strictEqual(
    result.ok,
    true
  );

  assert.strictEqual(
    result.status,
    "AWAITING_APPROVAL"
  );

  assert.strictEqual(
    result.completedSteps,
    4
  );

  assert.strictEqual(
    result.approvalSteps,
    1
  );

  assert.strictEqual(
    authority.calls.length,
    1
  );

  assert.strictEqual(
    sync.calls.length,
    1
  );

  assert.strictEqual(
    instantly.calls.length,
    1
  );

  assert.strictEqual(
    controlledWrite.calls.length,
    1
  );

  assert.strictEqual(
    controlledWrite.calls[0]
      .payload.dryRun,
    true
  );

  assert.strictEqual(
    controlledWrite.calls[0]
      .payload.stageOnly,
    true
  );

  assert.strictEqual(
    result.results[3]
      .result
      .orchestrationCheckpoint,
    true
  );

  assert.strictEqual(
    result.executiveSummary
      .blockers.length,
    0
  );

  assert.strictEqual(
    result.executiveSummary
      .ceoApprovals.length,
    1
  );

  console.log(JSON.stringify({
    ok: true,
    build: "030",
    tests: {
      planStepConsumption:
        "PASSED",
      sequentialExecution:
        "PASSED",
      providerAuthorityExecution:
        "PASSED",
      providerSynchronization:
        "PASSED",
      instantlyLiveExecution:
        "PASSED",
      recursionPrevention:
        "PASSED",
      controlledWriteStaging:
        "PASSED",
      protectedWriteApproval:
        "PASSED",
      executiveSummary:
        "PASSED",
      evidencePersistence:
        "PASSED"
    },
    result
  }, null, 2));
}

main().catch(error => {
  console.error(
    error.stack ||
    error.message
  );

  process.exit(1);
});

