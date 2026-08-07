"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const AutonomousEngineeringPlanningService =
  require("../SERVICES/engineering/AutonomousEngineeringPlanningService");
const {
  parseArguments
} = require("../SCRIPTS/PlanAutonomousEngineering");

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

function graphFixture(root) {
  const graphPath = path.join(
    root,
    "DATA",
    "runtime",
    "engineering",
    "repository_dependency_graph.json"
  );
  fs.mkdirSync(path.dirname(graphPath), {
    recursive: true
  });
  fs.writeFileSync(graphPath, JSON.stringify({
    ok: true,
    root,
    fingerprint:
      "A".repeat(64),
    summary: {
      sourceFiles: 4,
      internalDependencies: 3
    },
    validation: {
      ok: true
    },
    packageMetadata: {
      scripts: {
        test: "node TESTS/Test_Runtime.js"
      }
    },
    nodes: [
      {
        id: "StartProductionSystem.js",
        type: "ENTRY_POINT",
        dependencies: [
          "SERVICES/RuntimeHealthService.js"
        ]
      },
      {
        id: "SERVICES/RuntimeHealthService.js",
        type: "SERVICE",
        dependencies: []
      },
      {
        id: "CORE/RuntimeRegistry.js",
        type: "CORE",
        dependencies: [
          "SERVICES/RuntimeHealthService.js"
        ]
      },
      {
        id: "TESTS/Test_RuntimeHealth.js",
        type: "TEST",
        dependencies: [
          "SERVICES/RuntimeHealthService.js"
        ]
      }
    ],
    edges: [
      {
        from: "StartProductionSystem.js",
        to: "SERVICES/RuntimeHealthService.js",
        specifier: "./SERVICES/RuntimeHealthService"
      },
      {
        from: "CORE/RuntimeRegistry.js",
        to: "SERVICES/RuntimeHealthService.js",
        specifier: "../SERVICES/RuntimeHealthService"
      },
      {
        from: "TESTS/Test_RuntimeHealth.js",
        to: "SERVICES/RuntimeHealthService.js",
        specifier: "../SERVICES/RuntimeHealthService"
      }
    ],
    unresolvedRelativeImports: [
      {
        from: "SERVICES/RuntimeHealthService.js",
        specifier: "./optional"
      }
    ],
    dependencyCycles: []
  }, null, 2), "utf8");

  return graphPath;
}

(() => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "miles-engineering-plan-")
  );

  try {
    const graphPath = graphFixture(root);
    const generatedAt =
      "2026-08-07T00:00:00.000Z";
    const service =
      new AutonomousEngineeringPlanningService({
        rootDir: root,
        graphPath,
        generatedAt: () => generatedAt
      });

    const plan = service.createPlan({
      objective:
        "Improve runtime health validation and evidence"
    });

    test("governed engineering plan validates", () =>
      assert.strictEqual(plan.ok, true));

    test("plan is bound to repository fingerprint", () =>
      assert.strictEqual(
        plan.repository.fingerprint,
        "A".repeat(64)
      ));

    test("objective produces deterministic target files", () =>
      assert.strictEqual(
        plan.scope.targets[0].id,
        "SERVICES/RuntimeHealthService.js"
      ));

    test("target selection records matching evidence", () =>
      assert.ok(
        plan.scope.targets[0].matches.includes("runtime")
      ));

    test("reverse dependency impact is calculated", () =>
      assert.ok(plan.scope.impacted.some(item =>
        item.id === "StartProductionSystem.js"
      )));

    test("affected tests are selected", () =>
      assert.deepStrictEqual(
        plan.validation.affectedTests,
        ["TESTS/Test_RuntimeHealth.js"]
      ));

    test("syntax validation is planned", () =>
      assert.ok(plan.validation.syntax.some(command =>
        command.includes(
          "SERVICES/RuntimeHealthService.js"
        )
      )));

    test("unresolved target dependencies raise risk", () =>
      assert.strictEqual(plan.risk.level, "MEDIUM"));

    test("production acceptance is required for non-low risk", () =>
      assert.strictEqual(
        plan.risk.productionAcceptanceRequired,
        true
      ));

    test("source writes remain unauthorized", () =>
      assert.strictEqual(
        plan.authorization.sourceWritesAuthorized,
        false
      ));

    test("merge and deployment remain separately unauthorized", () => {
      assert.strictEqual(
        plan.authorization.mergeAuthorized,
        false
      );
      assert.strictEqual(
        plan.authorization.deploymentAuthorized,
        false
      );
    });

    test("implementation phase is blocked pending authorization", () =>
      assert.strictEqual(
        plan.phases[1].status,
        "BLOCKED_PENDING_AUTHORIZATION"
      ));

    test("plan identity is deterministic", () => {
      const second = service.createPlan({
        objective:
          "Improve runtime health validation and evidence"
      });
      assert.strictEqual(
        second.planFingerprint,
        plan.planFingerprint
      );
      assert.strictEqual(second.planId, plan.planId);
    });

    test("missing repository graph fails closed", () => {
      const missing =
        new AutonomousEngineeringPlanningService({
          rootDir: root,
          graphPath: path.join(root, "missing.json")
        });
      assert.throws(
        () => missing.createPlan({
          objective: "Improve runtime health validation"
        }),
        /AUTHORITATIVE_REPOSITORY_GRAPH_MISSING/
      );
    });

    test("invalid repository graph fails closed", () => {
      fs.writeFileSync(
        graphPath,
        JSON.stringify({
          ok: false,
          validation: { ok: false }
        }),
        "utf8"
      );
      assert.throws(
        () => service.createPlan({
          objective: "Improve runtime health validation"
        }),
        /FAILED_VALIDATION/
      );
      graphFixture(root);
    });

    test("short objective is rejected", () =>
      assert.throws(
        () => service.createPlan({
          objective: "fix it"
        }),
        /ENGINEERING_OBJECTIVE_REQUIRED/
      ));

    test("CLI defaults to plan-only", () =>
      assert.deepStrictEqual(
        parseArguments([
          "--objective=Improve runtime health"
        ]),
        {
          objective: "Improve runtime health",
          persist: false
        }
      ));

    test("CLI persist flag is explicit", () =>
      assert.deepStrictEqual(
        parseArguments([
          "--objective",
          "Improve runtime health",
          "--persist"
        ]),
        {
          objective: "Improve runtime health",
          persist: true
        }
      ));

    assert.strictEqual(
      fs.existsSync(
        path.join(
          root,
          "DATA",
          "runtime",
          "engineering",
          "plans"
        )
      ),
      false
    );

    const artifact = service.persistPlan(plan);

    test("validated plan persists with integrity evidence", () => {
      assert.strictEqual(artifact.ok, true);
      assert.strictEqual(
        fs.existsSync(artifact.filePath),
        true
      );
      assert.match(artifact.sha256, /^[A-F0-9]{64}$/);
      assert.strictEqual(
        artifact.planFingerprint,
        plan.planFingerprint
      );
    });

    const saved = JSON.parse(
      fs.readFileSync(artifact.filePath, "utf8")
    );

    test("persisted plan remains non-authorizing", () => {
      assert.strictEqual(
        saved.authorization.sourceWritesAuthorized,
        false
      );
      assert.strictEqual(
        saved.authorization.mergeAuthorized,
        false
      );
    });

    console.log(
      `AUTONOMOUS_ENGINEERING_PLANNING_TEST_PASS ${passed}/20`
    );
  } finally {
    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  }
})();
