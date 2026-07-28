"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require(
  "../SERVICES/GovernmentDataGsaMatcherService"
);
const cli = require("../SCRIPTS/MatchGovernmentDataStaging");

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsa-match-"));
  const staging = path.join(
    root,
    "DATA",
    "staging",
    "government_data"
  );
  fs.mkdirSync(staging, { recursive: true });
  const allowlistPath = path.join(staging, "allowlist.json");
  const candidatesPath = path.join(staging, "candidates.jsonl");
  fs.writeFileSync(
    allowlistPath,
    JSON.stringify({
      uniqueSinCount: 2,
      uniqueNaics: ["541511", "541512"],
      offerings: [
        { sin: "54151S", naicsCodes: ["541511", "541512"] },
        { sin: "54151HACS", naicsCodes: ["541512"] }
      ]
    })
  );
  const rows = [
    {
      sourceLine: 1,
      uei: "ONE",
      lastUpdateDate: "2026-01-01",
      naicsCodes: ["541511"]
    },
    {
      sourceLine: 2,
      uei: "ONE",
      lastUpdateDate: "2026-02-01",
      naicsCodes: ["541512"]
    },
    {
      sourceLine: 3,
      uei: "TWO",
      lastUpdateDate: "2026-03-01",
      naicsCodes: ["722513"]
    },
    {
      sourceLine: 4,
      uei: "THREE",
      lastUpdateDate: "2026-04-01",
      naicsCodes: ["541511", "541512"]
    }
  ];
  fs.writeFileSync(
    candidatesPath,
    `${rows.map(JSON.stringify).join("\n")}\n`
  );

  const service = new Service({ root });
  const plan = service.plan({ candidatesPath, allowlistPath });
  assert.strictEqual(plan.mode, "PLAN_ONLY");
  assert.strictEqual(plan.currentGsaNaicsCount, 2);
  assert.strictEqual(plan.safety.operationalWritesAllowed, false);

  const result = await service.match({
    candidatesPath,
    allowlistPath,
    runId: "TEST"
  });
  assert.strictEqual(result.counts.candidatesProcessed, 4);
  assert.strictEqual(result.counts.gsaMatchedInput, 3);
  assert.strictEqual(result.counts.deduplicatedWinners, 2);
  assert.strictEqual(result.counts.duplicateLosers, 1);
  assert.strictEqual(result.counts.noCurrentGsaNaics, 1);
  assert.strictEqual(result.counts.verifiedEmailReady, 0);

  const matchedFile = result.artifacts.find(item =>
    item.filePath.endsWith(
      "sam_gsa_matched_deduped_pre_email.jsonl"
    )
  ).filePath;
  const matched = fs
    .readFileSync(matchedFile, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.strictEqual(matched.length, 2);
  const one = matched.find(row => row.uei === "ONE");
  assert.strictEqual(one.sourceLine, 2);
  assert.deepStrictEqual(one.gsaEligibility.matchedSins, [
    "54151HACS",
    "54151S"
  ]);
  assert.strictEqual(
    one.verifiedEmailGate.operationallyEligible,
    false
  );
  assert.deepStrictEqual(
    cli.parseArgs([
      "--apply",
      "--candidates=a",
      "--allowlist=b"
    ]),
    {
      apply: true,
      candidatesPath: "a",
      allowlistPath: "b",
      outputRoot: null,
      runId: null,
      help: false
    }
  );
  fs.rmSync(root, { recursive: true, force: true });
  console.log("GOVERNMENT_DATA_GSA_MATCHER_TEST_PASS 14/14");
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
