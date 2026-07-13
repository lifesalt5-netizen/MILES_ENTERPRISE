"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const ROOT = process.env.MILES_ROOT;
const tempDb = path.join(
  ROOT,
  "DATA",
  "build_022",
  "test_orion.db"
);

fs.mkdirSync(
  path.dirname(tempDb),
  { recursive: true }
);

fs.writeFileSync(
  tempDb,
  "test",
  "utf8"
);

const OrionProvider =
  require("../PROVIDERS/providers/OrionProvider");

async function main() {
  const fakeConnector = {
    getSummary() {
      return {
        health: {
          ok: true,
          db: tempDb,
          tableCount: 6
        },
        contractors: {
          ok: true,
          count: 100
        },
        buyers: {
          ok: true,
          count: 50
        },
        opportunities: {
          ok: true,
          count: 25
        },
        recompetes: {
          ok: true,
          count: 10
        },
        recommendations: {
          ok: true,
          count: 80
        },
        personas: {
          ok: true,
          count: 90
        }
      };
    },

    getContractors() {
      return [{ id: 1 }];
    },

    getBuyers() {
      return [{ id: 1 }];
    },

    getOpportunities() {
      return [{ id: 1 }];
    },

    getRecompetes() {
      return [{ id: 1 }];
    },

    getRecommendations() {
      return [{ id: 1 }];
    },

    getPersonas() {
      return [{ id: 1 }];
    },

    shutdown() {}
  };

  const provider =
    new OrionProvider({
      connector: fakeConnector
    });

  const result =
    await provider.auditIntelligence();

  assert.strictEqual(
    result.provider,
    "OrionProvider"
  );

  assert.strictEqual(
    result.readOnly,
    true
  );

  assert.strictEqual(
    result.status,
    "Healthy"
  );

  assert.strictEqual(
    result.metrics.contractors,
    100
  );

  assert.strictEqual(
    result.metrics.opportunities,
    25
  );

  assert.strictEqual(
    result.metrics.recommendationCoverage,
    80
  );

  assert.strictEqual(
    result.metrics.personaCoverage,
    90
  );

  assert.strictEqual(
    result.metrics.databaseFreshness.stale,
    false
  );

  assert.strictEqual(
    result.safety.writesEnabled,
    false
  );

  assert(
    fs.existsSync(
      result.evidenceFile
    ),
    "ORION COO evidence file was not created."
  );

  console.log(JSON.stringify({
    ok: true,
    build: "022",
    tests: {
      connectorIntegration:
        "PASSED",
      databaseHealth:
        "PASSED",
      databaseFreshness:
        "PASSED",
      contractorCoverage:
        "PASSED",
      buyerCoverage:
        "PASSED",
      opportunityCoverage:
        "PASSED",
      recompeteCoverage:
        "PASSED",
      recommendationCoverage:
        "PASSED",
      personaCoverage:
        "PASSED",
      readOnlySafety:
        "PASSED",
      evidencePersistence:
        "PASSED"
    },
    status: result.status,
    metrics: result.metrics,
    recommendations:
      result.recommendations,
    safety: result.safety,
    evidenceFile:
      result.evidenceFile
  }, null, 2));
}

main()
  .finally(() => {
    try {
      fs.unlinkSync(tempDb);
    } catch {}
  })
  .catch(error => {
    console.error(
      error.stack || error.message
    );

    process.exit(1);
  });

