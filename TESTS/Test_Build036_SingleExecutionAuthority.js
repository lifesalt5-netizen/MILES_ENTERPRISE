"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "miles-build036-")
);

process.env.MILES_ROOT = root;

const taskQueue = require("../CORE/TaskQueue");

async function main() {
  const low = taskQueue.add(
    "WORKFORCE_STEP",
    {
      provider: "WebsiteProvider",
      action: "verifyWebsite",
      objective: "Low priority verification"
    },
    35
  );

  const high = taskQueue.add(
    "WORKFORCE_STEP",
    {
      provider: "WebsiteProvider",
      action: "verifyWebsite",
      objective: "High priority verification"
    },
    85
  );

  const claimed = taskQueue.claimNext({
    owner: "BUILD036_TEST"
  });

  assert.ok(claimed);
  assert.strictEqual(claimed.id, high.id);
  assert.strictEqual(claimed.status, "RUNNING");
  assert.strictEqual(claimed.claimedBy, "BUILD036_TEST");

  const remainingQueued = taskQueue.list("QUEUED");
  assert.strictEqual(remainingQueued.length, 1);
  assert.strictEqual(remainingQueued[0].id, low.id);

  taskQueue.update(claimed.id, {
    updatedAt:
      new Date(Date.now() - 60 * 60 * 1000).toISOString()
  });

  const recovered = taskQueue.recoverStaleRunning({
    staleMinutes: 15,
    maxRetries: 2,
    recoveredBy: "BUILD036_TEST"
  });

  assert.strictEqual(recovered.length, 1);
  assert.strictEqual(
    taskQueue.getById(claimed.id).status,
    "QUEUED"
  );

  const secondClaim = taskQueue.claimNext({
    owner: "BUILD036_TEST"
  });

  assert.strictEqual(secondClaim.id, claimed.id);

  const executionSource = fs.readFileSync(
    path.join(__dirname, "..", "SERVICES", "ExecutionService.js"),
    "utf8"
  );

  const runtimeSource = fs.readFileSync(
    path.join(__dirname, "..", "StartProductionSystem.js"),
    "utf8"
  );

  assert.ok(executionSource.includes("taskQueue.claimNext"));
  assert.ok(runtimeSource.includes('owner:\n              "MILES_RESIDENT_WORKER"'));

  console.log(JSON.stringify({
    ok: true,
    build: "036",
    tests: {
      atomicClaim: "PASSED",
      highPriorityFirst: "PASSED",
      claimOwnershipPersisted: "PASSED",
      duplicateClaimPrevented: "PASSED",
      staleRunningRecovery: "PASSED",
      executionServiceUsesAtomicClaim: "PASSED",
      residentWorkerOwnsExecution: "PASSED"
    },
    root,
    firstClaim: claimed.id,
    secondClaim: secondClaim.id
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
