"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const GovernmentDataStagingService =
  require("../SERVICES/GovernmentDataStagingService");
const {
  parseArgs,
  contentTypeAllowed
} = require("../SCRIPTS/RefreshGovernmentDataStaging");

const policy = require(
  "../CONFIG/GOVERNMENT_DATA/source_refresh_policy.json"
);

const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "miles-govdata-stage-")
);

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

try {
  const service = new GovernmentDataStagingService({
    root: tempRoot,
    stagingRoot: path.join(tempRoot, "stage"),
    policy,
    policyPath: path.join(
      tempRoot,
      "unused-source-refresh-policy.json"
    )
  });

  test("default plan selects the three enabled phase-one sources", () => {
    const plan = service.plan();
    assert.strictEqual(plan.mode, "PLAN_ONLY");
    assert.deepStrictEqual(
      plan.sources.map(source => source.id),
      [
        "sam_public_entities",
        "sam_public_exclusions",
        "gsa_mas_catalog"
      ]
    );
  });

  test("plan is fail-closed for operational writes", () => {
    const plan = service.plan();
    assert.strictEqual(
      plan.safety.operationalWritesAllowed,
      false
    );
    assert.strictEqual(plan.safety.orionDatabaseWrites, false);
    assert.strictEqual(plan.safety.instantlyWrites, false);
    assert.strictEqual(plan.safety.campaignWrites, false);
  });

  test("unknown source is rejected", () => {
    assert.throws(
      () => service.plan(["not_a_source"]),
      /Unknown government-data source/
    );
  });

  test("disabled phase-two source cannot be selected", () => {
    assert.throws(
      () => service.plan(["va_fss"]),
      /not enabled/
    );
  });

  test("paths outside staging are rejected", () => {
    assert.throws(
      () =>
        service.assertStagingPath(
          path.join(tempRoot, "ORION.db")
        ),
      /Operational write blocked/
    );
  });

  test("staged artifact is hashed and recorded", () => {
    service.beginRun(
      ["gsa_mas_catalog"],
      new Date("2026-07-27T22:45:00.000Z")
    );

    const source = service.resolveSources(
      ["gsa_mas_catalog"]
    )[0];
    const artifactPath = service.artifactPath(
      source.id,
      source.extension
    );
    const contents = "<html><body>GSA MAS</body></html>";
    fs.writeFileSync(artifactPath, contents, "utf8");

    const artifact = service.recordArtifact(
      source,
      artifactPath,
      {
        contentType: "text/html",
        sourceDate: "Sun, 27 Jul 2026 00:00:00 GMT"
      }
    );

    const expected = crypto
      .createHash("sha256")
      .update(contents)
      .digest("hex")
      .toUpperCase();

    assert.strictEqual(artifact.sha256, expected);
    assert.strictEqual(artifact.bytes, Buffer.byteLength(contents));
    assert.strictEqual(artifact.contentType, "text/html");
  });

  test("completed manifest contains no operational authorization", () => {
    const completed = service.complete(
      new Date("2026-07-27T22:46:00.000Z")
    );
    const manifest = JSON.parse(
      fs.readFileSync(completed.manifestPath, "utf8")
    );

    assert.strictEqual(manifest.status, "COMPLETED");
    assert.strictEqual(manifest.mode, "STAGING_ONLY");
    assert.strictEqual(
      manifest.safety.operationalWritesAllowed,
      false
    );
    assert.strictEqual(manifest.artifacts.length, 1);
  });

  test("CLI defaults to plan-only", () => {
    const args = parseArgs([]);
    assert.strictEqual(args.apply, false);
    assert.strictEqual(args.sources, null);
  });

  test("CLI source selection is parsed", () => {
    const args = parseArgs([
      "--apply",
      "--sources=sam_public_entities,gsa_mas_catalog"
    ]);
    assert.strictEqual(args.apply, true);
    assert.deepStrictEqual(args.sources, [
      "sam_public_entities",
      "gsa_mas_catalog"
    ]);
  });

  test("content-type validation accepts source contract", () => {
    const source = policy.sources.sam_public_entities;
    assert.strictEqual(
      contentTypeAllowed(
        source,
        "application/zip; charset=binary"
      ),
      true
    );
    assert.strictEqual(
      contentTypeAllowed(source, "application/json"),
      false
    );
  });

  console.log(
    `GOVERNMENT_DATA_STAGING_TEST_PASS ${passed}/${passed}`
  );
} finally {
  fs.rmSync(tempRoot, {
    recursive: true,
    force: true
  });
}
