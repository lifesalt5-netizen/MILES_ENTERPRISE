"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require(
  "../SERVICES/engineering/GovernedEngineeringValidationService"
);
const { sha256 } = require(
  "../SERVICES/engineering/GovernedEngineeringValidationService"
);
const { parseArguments } = require(
  "../SCRIPTS/RunGovernedEngineeringValidation"
);

let passed = 0;
function test(name, action) {
  action();
  passed += 1;
  console.log(`[PASS] ${name}`);
}
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

(function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-validation-"));
  const source = path.join(root, "SERVICES", "Fixture.js");
  const testFile = path.join(root, "TESTS", "Test_Fixture.js");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(source, 'module.exports = "after";\n');
  fs.writeFileSync(testFile, 'console.log("PASS");\n');

  const fingerprint = "A".repeat(64);
  const planPath = path.join(root, "plan.json");
  const graphPath = path.join(root, "graph.json");
  const manifestPath = path.join(root, "manifest.json");
  const plan = {
    ok: true,
    planId: "ENGINEERING-PLAN-ABCDEF0123456789",
    planFingerprint: "B".repeat(64),
    repository: { fingerprint },
    validation: {
      commands: [
        'node --check "SERVICES/Fixture.js"',
        'node "TESTS/Test_Fixture.js"'
      ]
    }
  };
  const manifest = {
    ok: true,
    service: "GOVERNED_CODE_MODIFICATION",
    status: "APPLIED",
    executionId: "CODE-MOD-ABCDEF0123456789",
    plan: {
      planId: plan.planId,
      planFingerprint: plan.planFingerprint
    },
    repositoryFingerprint: fingerprint,
    sourceWritesPerformed: true,
    gitWritesPerformed: false,
    mergePerformed: false,
    deploymentPerformed: false,
    files: [{
      path: "SERVICES/Fixture.js",
      afterSha256: sha256(fs.readFileSync(source))
    }]
  };
  writeJson(planPath, plan);
  writeJson(graphPath, {
    ok: true,
    validation: { ok: true },
    fingerprint
  });
  writeJson(manifestPath, manifest);

  const executions = [];
  const service = new Service({
    rootDir: root,
    graphPath,
    now: (() => {
      let value = Date.parse("2026-08-07T12:00:00Z");
      return () => (value += 5);
    })(),
    spawnImpl: (executable, args, options) => {
      executions.push({ executable, args, options });
      return { status: 0, stdout: "PASS\n", stderr: "" };
    }
  });

  test("validation service is constructable", () =>
    assert.strictEqual(service.service, "GOVERNED_ENGINEERING_VALIDATION"));
  const preflight = service.preflight({ planPath, manifestPath });
  test("preflight binds plan manifest and graph", () =>
    assert.strictEqual(preflight.ok, true));
  test("validation identity is deterministic", () =>
    assert.match(preflight.validationFingerprint, /^[A-F0-9]{64}$/));
  test("only plan commands are selected", () =>
    assert.strictEqual(preflight.commands.length, 2));
  test("modified source hash is verified before tests", () =>
    assert.strictEqual(preflight.files[0].actualSha256, manifest.files[0].afterSha256));

  const preview = service.run({ planPath, manifestPath, apply: false });
  test("default mode is plan-only", () =>
    assert.strictEqual(preview.mode, "PLAN_ONLY"));
  test("plan-only executes no commands", () =>
    assert.strictEqual(executions.length, 0));
  test("plan-only writes no evidence", () =>
    assert.strictEqual(preview.evidenceWritten, false));

  test("repository fingerprint mismatch fails closed", () => {
    writeJson(graphPath, { ok: true, validation: { ok: true }, fingerprint: "C".repeat(64) });
    assert.throws(() => service.preflight({ planPath, manifestPath }), /FINGERPRINT_MISMATCH/);
    writeJson(graphPath, { ok: true, validation: { ok: true }, fingerprint });
  });
  test("manifest plan mismatch fails closed", () => {
    writeJson(manifestPath, { ...manifest, plan: { ...manifest.plan, planId: "ENGINEERING-PLAN-0000000000000000" } });
    assert.throws(() => service.preflight({ planPath, manifestPath }), /MANIFEST_INVALID/);
    writeJson(manifestPath, manifest);
  });
  test("changed source hash fails closed", () => {
    fs.appendFileSync(source, "// changed\n");
    assert.throws(() => service.preflight({ planPath, manifestPath }), /HASH_MISMATCH/);
    fs.writeFileSync(source, 'module.exports = "after";\n');
  });
  test("shell metacharacters fail closed", () =>
    assert.throws(() => service.parseCommand('node "TESTS/Test_Fixture.js" & whoami'), /COMMAND_NOT_ALLOWED/));
  test("path traversal fails closed", () =>
    assert.throws(() => service.parseCommand('node "../outside.js"'), /PATH_NOT_ALLOWED/));
  test("unsupported executable fails closed", () =>
    assert.throws(() => service.parseCommand('powershell "TESTS/Test_Fixture.js"'), /COMMAND_NOT_ALLOWED/));
  test("duplicate validation command fails closed", () => {
    writeJson(planPath, { ...plan, validation: { commands: [plan.validation.commands[0], plan.validation.commands[0]] } });
    assert.throws(() => service.preflight({ planPath, manifestPath }), /DUPLICATE_VALIDATION_COMMAND/);
    writeJson(planPath, plan);
  });

  const applied = service.run({ planPath, manifestPath, apply: true });
  test("apply executes every authorized command", () =>
    assert.strictEqual(executions.length, 2));
  test("validation commands never use a shell", () =>
    assert.ok(executions.every(item => item.options.shell === false)));
  test("successful validation produces pass evidence", () =>
    assert.strictEqual(applied.status, "PASSED"));
  test("evidence is persisted with an integrity hash", () => {
    assert.strictEqual(fs.existsSync(applied.evidencePath), true);
    assert.match(applied.evidenceSha256, /^[A-F0-9]{64}$/);
  });
  test("validation grants no Git merge or deployment authority", () => {
    assert.strictEqual(applied.gitWritesPerformed, false);
    assert.strictEqual(applied.mergePerformed, false);
    assert.strictEqual(applied.deploymentPerformed, false);
  });
  test("CLI defaults to plan-only", () =>
    assert.deepStrictEqual(
      parseArguments(["--plan=C:/plan.json", "--manifest=C:/manifest.json"]),
      {
        planPath: path.resolve("C:/plan.json"),
        manifestPath: path.resolve("C:/manifest.json"),
        apply: false
      }
    ));

  console.log(`GOVERNED_ENGINEERING_VALIDATION_TEST_PASS ${passed}/21`);
  fs.rmSync(root, { recursive: true, force: true });
})();

