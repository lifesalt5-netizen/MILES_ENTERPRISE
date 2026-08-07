"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require(
  "../SERVICES/engineering/GovernedGitHubWorkflowService"
);
const { sha256, slugify } = require(
  "../SERVICES/engineering/GovernedGitHubWorkflowService"
);
const { parseArguments } = require(
  "../SCRIPTS/PrepareGovernedGitHubWorkflow"
);

let passed = 0;
function test(name, action) {
  action();
  passed += 1;
  console.log(`[PASS] ${name}`);
}
function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

(function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-github-"));
  fs.mkdirSync(path.join(root, "SERVICES"), { recursive: true });
  const sourcePath = path.join(root, "SERVICES", "Fixture.js");
  fs.writeFileSync(sourcePath, 'module.exports = "ready";\n');
  const fingerprint = "A".repeat(64);
  const plan = {
    ok: true,
    planId: "ENGINEERING-PLAN-ABCDEF0123456789",
    planFingerprint: "B".repeat(64),
    objective: "Add governed GitHub release workflow",
    repository: { fingerprint },
    scope: { targets: [{ id: "SERVICES/Fixture.js" }] }
  };
  const manifest = {
    ok: true,
    service: "GOVERNED_CODE_MODIFICATION",
    status: "APPLIED",
    executionId: "CODE-MOD-ABCDEF0123456789",
    plan: { planId: plan.planId, planFingerprint: plan.planFingerprint },
    repositoryFingerprint: fingerprint,
    sourceWritesPerformed: true,
    gitWritesPerformed: false,
    mergePerformed: false,
    deploymentPerformed: false,
    files: [{ path: "SERVICES/Fixture.js", afterSha256: sha256(fs.readFileSync(sourcePath)) }]
  };
  const validation = {
    ok: true,
    service: "GOVERNED_ENGINEERING_VALIDATION",
    status: "PASSED",
    validationId: "ENGINEERING-VALIDATION-ABCDEF0123456789",
    validationFingerprint: "C".repeat(64),
    plan: { planId: plan.planId, planFingerprint: plan.planFingerprint },
    repositoryFingerprint: fingerprint,
    modificationExecutionId: manifest.executionId,
    gitWritesPerformed: false,
    mergePerformed: false,
    deploymentPerformed: false
  };
  const planPath = path.join(root, "plan.json");
  const manifestPath = path.join(root, "manifest.json");
  const validationPath = path.join(root, "validation.json");
  writeJson(planPath, plan);
  writeJson(manifestPath, manifest);
  writeJson(validationPath, validation);
  const service = new Service({
    rootDir: root,
    generatedAt: () => "2026-08-07T12:00:00.000Z"
  });

  test("GitHub workflow service is constructable", () =>
    assert.strictEqual(service.service, "GOVERNED_GITHUB_WORKFLOW"));
  const workflow = service.buildWorkflow({ planPath, manifestPath, validationPath });
  test("validated evidence chain produces workflow", () => assert.strictEqual(workflow.ok, true));
  test("workflow identity is deterministic", () => assert.match(workflow.workflowFingerprint, /^[A-F0-9]{64}$/));
  test("branch is deterministic and scoped", () => assert.match(workflow.repository.branch, /^agent\/miles-/));
  test("only modified plan files are included", () => assert.deepStrictEqual(workflow.files.map(item => item.path), ["SERVICES/Fixture.js"]));
  test("source hash is reverified", () => assert.strictEqual(workflow.files[0].sha256, manifest.files[0].afterSha256));
  test("draft pull request is planned", () => assert.strictEqual(workflow.proposedGitHubActions[3].action, "OPEN_DRAFT_PULL_REQUEST"));
  test("Git writes remain unauthorized", () => assert.strictEqual(workflow.authorization.gitCommitAuthorized, false));
  test("merge remains unauthorized", () => assert.strictEqual(workflow.authorization.mergeAuthorized, false));
  test("deployment remains unauthorized", () => assert.strictEqual(workflow.authorization.deploymentAuthorized, false));
  test("artifact hashes are recorded", () => assert.match(workflow.integrity.validationArtifactSha256, /^[A-F0-9]{64}$/));
  test("slug generation removes unsafe characters", () => assert.strictEqual(slugify("Fix A/B & Deploy?"), "fix-a-b-deploy"));
  test("changed source fails closed", () => {
    fs.appendFileSync(sourcePath, "// changed\n");
    assert.throws(() => service.buildWorkflow({ planPath, manifestPath, validationPath }), /HASH_MISMATCH/);
    fs.writeFileSync(sourcePath, 'module.exports = "ready";\n');
  });
  test("file outside plan fails closed", () => {
    writeJson(manifestPath, { ...manifest, files: [{ ...manifest.files[0], path: "SERVICES/Other.js" }] });
    assert.throws(() => service.buildWorkflow({ planPath, manifestPath, validationPath }), /OUTSIDE_PLAN/);
    writeJson(manifestPath, manifest);
  });
  test("failed validation fails closed", () => {
    writeJson(validationPath, { ...validation, ok: false, status: "FAILED" });
    assert.throws(() => service.buildWorkflow({ planPath, manifestPath, validationPath }), /VALIDATION_INVALID/);
    writeJson(validationPath, validation);
  });
  test("mismatched validation fails closed", () => {
    writeJson(validationPath, { ...validation, modificationExecutionId: "OTHER" });
    assert.throws(() => service.buildWorkflow({ planPath, manifestPath, validationPath }), /VALIDATION_INVALID/);
    writeJson(validationPath, validation);
  });
  test("prior authority violation fails closed", () => {
    writeJson(validationPath, { ...validation, mergePerformed: true });
    assert.throws(() => service.buildWorkflow({ planPath, manifestPath, validationPath }), /AUTHORITY_BOUNDARY/);
    writeJson(validationPath, validation);
  });
  const artifact = service.persistWorkflow(workflow);
  test("explicit persistence writes workflow packet", () => assert.strictEqual(fs.existsSync(artifact.filePath), true));
  test("persisted workflow has integrity hash", () => assert.match(artifact.sha256, /^[A-F0-9]{64}$/));
  test("CLI defaults to plan-only", () =>
    assert.deepStrictEqual(
      parseArguments(["--plan=C:/p.json", "--manifest=C:/m.json", "--validation=C:/v.json"]),
      {
        planPath: path.resolve("C:/p.json"),
        manifestPath: path.resolve("C:/m.json"),
        validationPath: path.resolve("C:/v.json"),
        persist: false
      }
    ));

  console.log(`GOVERNED_GITHUB_WORKFLOW_TEST_PASS ${passed}/20`);
  fs.rmSync(root, { recursive: true, force: true });
})();

