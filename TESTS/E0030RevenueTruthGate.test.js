"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const AutonomousRevenueClosureLoop =
  require("../SERVICES/AutonomousRevenueClosureLoop");

async function main() {
  const loop = new AutonomousRevenueClosureLoop();

  const fixture = {
    executiveState: {
      business: {
        deals: [
          {
            id: "BUILD-E010",
            company: "BUILD E010 TEST COMPANY",
            email: "build-test@example.com",
            value: 7500,
            probability: 0.6,
            score: 80,
            source: "BUILD_E010_TEST"
          },
          {
            id: "UNKNOWN",
            name: "Unknown Target",
            value: 0,
            probability: 0.25,
            score: 25,
            source: "COO_PIPELINE"
          },
          {
            id: "REAL-001",
            company: "Real Prospect LLC",
            contactName: "Jordan Smith",
            email: "jordan@realprospect.com",
            value: 5000,
            probability: 0.7,
            score: 75,
            source: "INSTANTLY_POSITIVE_REPLY"
          }
        ],
        opportunities: Array.from(
          { length: 100 },
          (_, index) => ({
            id: `OPP-${index + 1}`
          })
        ),
        proposals: [],
        campaigns: [],
        segments: [],
        payments: []
      }
    }
  };

  const result = await loop.run(fixture);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.version, "E003.0");
  assert.strictEqual(result.metrics.pipelineRecords, 3);
  assert.strictEqual(result.metrics.lifecycleOpportunities, 100);
  assert.strictEqual(result.results.qualified.length, 1);
  assert.strictEqual(result.results.rejected.length, 2);
  assert.strictEqual(result.results.actions.length, 1);
  assert.strictEqual(
    result.results.qualified[0].company,
    "Real Prospect LLC"
  );
  assert.strictEqual(
    result.results.actions[0].action,
    "SEND_FOLLOWUP"
  );
  assert.strictEqual(
    result.results.actions[0].status,
    "PROPOSED"
  );
  assert.strictEqual(
    result.goal.weeklyMinimum,
    10000
  );
  assert.strictEqual(
    result.goal.annualTarget,
    1000000
  );

  const currentDealsPath = path.join(
    __dirname,
    "..",
    "DATA",
    "runtime",
    "latest_deals.json"
  );

  const currentDeals = JSON.parse(
    fs.readFileSync(currentDealsPath, "utf8")
  );

  const currentResult = await loop.run({
    executiveState: {
      business: {
        deals: currentDeals.deals || []
      }
    }
  });

  for (
    const qualified of currentResult.results.qualified
  ) {
    assert.ok(qualified.target);
    assert.ok(qualified.value > 0);
    assert.ok(
      !/\b(build|fixture|synthetic|test)\b/i.test(
        [
          qualified.target,
          qualified.source,
          qualified.email
        ].join(" ")
      )
    );
  }

  console.log(
    "E003.0 REVENUE TRUTH GATE: PASS"
  );
  console.log(
    JSON.stringify(
      {
        fixtureQualified:
          result.results.qualified.length,
        fixtureRejected:
          result.results.rejected.length,
        fixtureActions:
          result.results.actions.length,
        currentQualified:
          currentResult.results.qualified.length,
        currentRejected:
          currentResult.results.rejected.length,
        weeklyTarget:
          result.goal.weeklyMinimum,
        annualTarget:
          result.goal.annualTarget
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});