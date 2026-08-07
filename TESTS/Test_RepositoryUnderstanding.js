"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const RepositoryUnderstandingService =
  require("../SERVICES/engineering/RepositoryUnderstandingService");
const {
  parseArguments
} = require("../SCRIPTS/BuildRepositoryDependencyGraph");

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

(() => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "miles-repository-map-")
  );

  try {
    write(root, "package.json", JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      scripts: { start: "node StartFixture.js" },
      dependencies: { axios: "1.0.0" }
    }));

    write(
      root,
      "StartFixture.js",
      [
        'const core = require("./CORE/A");',
        'const axios = require("axios");',
        'require("./missing");',
        'module.exports = core;'
      ].join("\n")
    );
    write(root, "CORE/A.js", 'module.exports = require("../SERVICES/B");');
    write(root, "SERVICES/B.js", 'module.exports = require("../CORE/A");');
    write(root, "SERVICES/index.js", 'module.exports = require("./B");');
    write(root, "TESTS/Test_Fixture.js", 'require("../StartFixture");');
    write(root, "DATA/ignored.js", "throw new Error('must not scan');");
    write(root, "node_modules/pkg/index.js", "module.exports = {};");

    const generatedAt = "2026-08-07T00:00:00.000Z";
    const outputFile = path.join(
      root,
      "DATA",
      "runtime",
      "engineering",
      "graph.json"
    );
    const service = new RepositoryUnderstandingService({
      rootDir: root,
      outputFile,
      generatedAt: () => generatedAt
    });
    const graph = service.buildGraph();

    test("repository graph validates", () =>
      assert.strictEqual(graph.ok, true));

    test("runtime data and node_modules are excluded", () => {
      assert.ok(!graph.nodes.some(node => node.id.startsWith("DATA/")));
      assert.ok(!graph.nodes.some(node => node.id.startsWith("node_modules/")));
    });

    test("root startup file is classified as entry point", () => {
      assert.deepStrictEqual(graph.entryPoints, ["StartFixture.js"]);
      assert.strictEqual(
        graph.nodes.find(node => node.id === "StartFixture.js").type,
        "ENTRY_POINT"
      );
    });

    test("core service and test files are classified", () => {
      assert.strictEqual(
        graph.nodes.find(node => node.id === "CORE/A.js").type,
        "CORE"
      );
      assert.strictEqual(
        graph.nodes.find(node => node.id === "SERVICES/B.js").type,
        "SERVICE"
      );
      assert.strictEqual(
        graph.nodes.find(node => node.id === "TESTS/Test_Fixture.js").type,
        "TEST"
      );
    });

    test("relative imports resolve without explicit extension", () =>
      assert.ok(graph.edges.some(edge =>
        edge.from === "StartFixture.js" &&
        edge.to === "CORE/A.js"
      )));

    test("internal dependency edges reference real nodes", () =>
      assert.strictEqual(graph.validation.invalidEdges, 0));

    test("external packages are inventoried", () =>
      assert.deepStrictEqual(graph.externalPackages, ["axios"]));

    test("missing relative import is preserved as a gap", () =>
      assert.deepStrictEqual(
        graph.unresolvedRelativeImports,
        [{
          from: "StartFixture.js",
          specifier: "./missing"
        }]
      ));

    test("dependency cycles are detected", () =>
      assert.ok(graph.dependencyCycles.some(cycle =>
        cycle.includes("CORE/A.js") &&
        cycle.includes("SERVICES/B.js")
      )));

    test("package scripts and dependencies are inventoried", () => {
      assert.strictEqual(
        graph.packageMetadata.scripts.start,
        "node StartFixture.js"
      );
      assert.deepStrictEqual(
        graph.packageMetadata.declaredPackages,
        ["axios"]
      );
    });

    test("graph fingerprint is deterministic", () => {
      const second = service.buildGraph();
      assert.strictEqual(second.fingerprint, graph.fingerprint);
    });

    test("plan arguments default to no writes", () =>
      assert.deepStrictEqual(
        parseArguments([]),
        { apply: false, output: null }
      ));

    test("apply flag and explicit output are parsed", () =>
      assert.deepStrictEqual(
        parseArguments([
          "--apply",
          "--output=C:/temp/graph.json"
        ]),
        {
          apply: true,
          output: "C:/temp/graph.json"
        }
      ));

    test("no artifact exists before apply", () =>
      assert.strictEqual(fs.existsSync(outputFile), false));

    const artifact = service.writeGraph(graph);

    test("validated graph is persisted with integrity evidence", () => {
      assert.strictEqual(artifact.ok, true);
      assert.strictEqual(fs.existsSync(outputFile), true);
      assert.strictEqual(artifact.fingerprint, graph.fingerprint);
      assert.match(artifact.sha256, /^[A-F0-9]{64}$/);
    });

    const persisted = JSON.parse(
      fs.readFileSync(outputFile, "utf8")
    );

    test("persisted graph preserves validation and summary", () => {
      assert.strictEqual(persisted.validation.ok, true);
      assert.strictEqual(
        persisted.summary.sourceFiles,
        graph.summary.sourceFiles
      );
    });

    console.log(
      `REPOSITORY_UNDERSTANDING_TEST_PASS ${passed}/16`
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
