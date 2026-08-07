"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const GovernedCodeModificationService =
  require("../SERVICES/engineering/GovernedCodeModificationService");
const {
  sha256
} = require("../SERVICES/engineering/GovernedCodeModificationService");
const {
  parseArguments
} = require("../SCRIPTS/ApplyGovernedCodeChange");

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true
  });
  fs.writeFileSync(
    filePath,
    JSON.stringify(value, null, 2),
    "utf8"
  );
}

(() => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "miles-code-mod-")
  );
  const now = Date.parse(
    "2026-08-07T12:00:00.000Z"
  );
  const key =
    "TEST-ENGINEERING-APPROVAL-KEY-1234567890";
  const sourcePath = path.join(
    root,
    "SERVICES",
    "FixtureService.js"
  );
  const original =
    '"use strict";\nmodule.exports = "before";\n';
  const replacement =
    '"use strict";\nmodule.exports = "after";\n';

  fs.mkdirSync(path.dirname(sourcePath), {
    recursive: true
  });
  fs.writeFileSync(
    sourcePath,
    original,
    "utf8"
  );

  const graphPath = path.join(
    root,
    "DATA",
    "runtime",
    "engineering",
    "repository_dependency_graph.json"
  );
  const planPath = path.join(
    root,
    "plan.json"
  );
  const changesPath = path.join(
    root,
    "changes.json"
  );
  const approvalPath = path.join(
    root,
    "approval.json"
  );
  const fingerprint = "A".repeat(64);
  const plan = {
    ok: true,
    planId: "ENGINEERING-PLAN-AAAAAAAAAAAAAAAA",
    planFingerprint: "B".repeat(64),
    repository: {
      fingerprint
    },
    scope: {
      targets: [{
        id: "SERVICES/FixtureService.js"
      }]
    },
    authorization: {
      sourceWritesAuthorized: false
    }
  };
  const changeSet = {
    planId: plan.planId,
    repositoryFingerprint: fingerprint,
    changes: [{
      path: "SERVICES/FixtureService.js",
      operation: "REPLACE",
      beforeSha256: sha256(
        Buffer.from(original, "utf8")
      ),
      content: replacement
    }]
  };

  writeJson(graphPath, {
    ok: true,
    fingerprint,
    validation: { ok: true }
  });
  writeJson(planPath, plan);
  writeJson(changesPath, changeSet);

  const service =
    new GovernedCodeModificationService({
      rootDir: root,
      graphPath,
      approvalKey: key,
      now: () => now
    });
  const normalized =
    service.normalizeChangeSet(changeSet);
  const approval = service.createApproval({
    planId: plan.planId,
    planFingerprint: plan.planFingerprint,
    repositoryFingerprint: fingerprint,
    changeSetSha256:
      normalized.changeSetSha256,
    approvedFiles: [
      "SERVICES/FixtureService.js"
    ],
    approvedBy: "CEO",
    expiresInMs: 60000
  });
  writeJson(approvalPath, approval);

  test("governed modification service is constructable", () =>
    assert.strictEqual(
      service.service,
      "GOVERNED_CODE_MODIFICATION"
    ));

  test("change set is deterministically hashed", () =>
    assert.match(
      normalized.changeSetSha256,
      /^[A-F0-9]{64}$/
    ));

  test("approval is cryptographically signed", () =>
    assert.match(
      approval.signature,
      /^[A-F0-9]{64}$/
    ));

  test("preflight validates plan graph file and approval", () =>
    assert.strictEqual(
      service.preflight({
        planPath,
        changeSetPath: changesPath,
        approvalPath
      }).ok,
      true
    ));

  const preview = service.apply({
    planPath,
    changeSetPath: changesPath,
    approvalPath,
    apply: false
  });

  test("default mode is preview-only", () =>
    assert.strictEqual(
      preview.mode,
      "PREVIEW_ONLY"
    ));

  test("preview performs no source writes", () => {
    assert.strictEqual(
      preview.sourceWritesPerformed,
      false
    );
    assert.strictEqual(
      fs.readFileSync(sourcePath, "utf8"),
      original
    );
  });

  test("source outside plan scope fails closed", () => {
    const outside = {
      ...changeSet,
      changes: [{
        ...changeSet.changes[0],
        path: "SERVICES/Other.js"
      }]
    };
    assert.throws(
      () => service.validatePlan(
        plan,
        {
          ok: true,
          validation: { ok: true },
          fingerprint
        },
        service.normalizeChangeSet(outside)
      ),
      /SOURCE_NOT_IN_APPROVED_PLAN_SCOPE/
    );
  });

  test("path traversal fails closed", () =>
    assert.throws(
      () => service.normalizeChangeSet({
        ...changeSet,
        changes: [{
          ...changeSet.changes[0],
          path: "../outside.js"
        }]
      }),
      /SOURCE_PATH_NOT_ALLOWED/
    ));

  test("runtime data path fails closed", () =>
    assert.throws(
      () => service.normalizeChangeSet({
        ...changeSet,
        changes: [{
          ...changeSet.changes[0],
          path: "DATA/runtime/file.js"
        }]
      }),
      /SOURCE_PATH_NOT_ALLOWED/
    ));

  test("unsupported create operation fails closed", () =>
    assert.throws(
      () => service.normalizeChangeSet({
        ...changeSet,
        changes: [{
          ...changeSet.changes[0],
          operation: "CREATE"
        }]
      }),
      /SOURCE_OPERATION_NOT_ALLOWED/
    ));

  test("changed source hash fails closed", () => {
    fs.writeFileSync(sourcePath, "changed", "utf8");
    assert.throws(
      () => service.validateCurrentFiles(normalized),
      /SOURCE_CHANGED_SINCE_PLAN/
    );
    fs.writeFileSync(sourcePath, original, "utf8");
  });

  test("tampered approval signature fails closed", () => {
    const tamperedPath = path.join(root, "tampered.json");
    writeJson(tamperedPath, {
      ...approval,
      signature: "C".repeat(64)
    });
    assert.throws(
      () => service.preflight({
        planPath,
        changeSetPath: changesPath,
        approvalPath: tamperedPath
      }),
      /SIGNATURE_INVALID/
    );
  });

  test("expired approval fails closed", () => {
    const expiredService =
      new GovernedCodeModificationService({
        rootDir: root,
        graphPath,
        approvalKey: key,
        now: () => now + 120000
      });
    assert.throws(
      () => expiredService.preflight({
        planPath,
        changeSetPath: changesPath,
        approvalPath
      }),
      /APPROVAL_EXPIRED/
    );
  });

  test("wrong approval key fails closed", () => {
    const wrongKey =
      new GovernedCodeModificationService({
        rootDir: root,
        graphPath,
        approvalKey:
          "WRONG-ENGINEERING-APPROVAL-KEY-123456",
        now: () => now
      });
    assert.throws(
      () => wrongKey.preflight({
        planPath,
        changeSetPath: changesPath,
        approvalPath
      }),
      /SIGNATURE_INVALID/
    );
  });

  test("missing approval key fails closed", () => {
    const missingKey =
      new GovernedCodeModificationService({
        rootDir: root,
        graphPath,
        approvalKey: "",
        now: () => now
      });
    assert.throws(
      () => missingKey.createApproval({
        approvedFiles: []
      }),
      /APPROVAL_KEY_UNAVAILABLE/
    );
  });

  const applied = service.apply({
    planPath,
    changeSetPath: changesPath,
    approvalPath,
    apply: true
  });

  test("explicit apply performs the authorized replacement", () => {
    assert.strictEqual(applied.status, "APPLIED");
    assert.strictEqual(
      fs.readFileSync(sourcePath, "utf8"),
      replacement
    );
  });

  test("apply preserves a recoverable backup", () => {
    assert.strictEqual(
      fs.readFileSync(
        applied.files[0].backupPath,
        "utf8"
      ),
      original
    );
  });

  test("apply records an integrity manifest", () => {
    assert.strictEqual(
      fs.existsSync(applied.manifestPath),
      true
    );
    assert.match(
      applied.manifestSha256,
      /^[A-F0-9]{64}$/
    );
  });

  test("source modification does not authorize Git or deployment", () => {
    assert.strictEqual(
      applied.gitWritesPerformed,
      false
    );
    assert.strictEqual(
      applied.mergePerformed,
      false
    );
    assert.strictEqual(
      applied.deploymentPerformed,
      false
    );
  });

  test("CLI defaults to preview-only", () =>
    assert.deepStrictEqual(
      parseArguments([
        "--plan=C:/plan.json",
        "--changes=C:/changes.json",
        "--approval=C:/approval.json"
      ]),
      {
        planPath: path.resolve("C:/plan.json"),
        changeSetPath:
          path.resolve("C:/changes.json"),
        approvalPath:
          path.resolve("C:/approval.json"),
        apply: false
      }
    ));

  console.log(
    `GOVERNED_CODE_MODIFICATION_TEST_PASS ${passed}/20`
  );

  fs.rmSync(root, {
    recursive: true,
    force: true
  });
})();
