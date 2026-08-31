"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require(
  "../SERVICES/GovernmentVerifiedEmailRecoveryService"
);
const cli = require("../SCRIPTS/RecoverVerifiedEmailsStaging");

async function run() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "email-recovery-")
  );
  const staging = path.join(
    root,
    "DATA",
    "staging",
    "government_data"
  );
  const matchRun = path.join(staging, "gsa_matching", "MATCH");
  const sources = path.join(root, "verified_sources");
  fs.mkdirSync(matchRun, { recursive: true });
  fs.mkdirSync(sources, { recursive: true });

  const candidatePath = path.join(
    matchRun,
    "sam_gsa_matched_deduped_pre_email.jsonl"
  );
  const candidates = [
    {
      uei: "UEI-ONE",
      cageCode: "CAGE1",
      legalBusinessName: "ONE LLC",
      websiteDomain: "one.com",
      physicalAddress: { state: "FL", postalCode: "33701" }
    },
    {
      uei: "UEI-TWO",
      cageCode: "CAGE2",
      legalBusinessName: "TWO LLC",
      websiteDomain: "two.com",
      physicalAddress: { state: "FL", postalCode: "33702" }
    }
  ];
  fs.writeFileSync(
    candidatePath,
    `${candidates.map(JSON.stringify).join("\n")}\n`
  );
  fs.writeFileSync(
    path.join(matchRun, "manifest.json"),
    JSON.stringify({
      ok: true,
      status: "COMPLETED",
      generatedAt: "2026-07-28T00:00:00.000Z",
      artifacts: [{ filePath: candidatePath }]
    })
  );
  fs.writeFileSync(
    path.join(sources, "SBS_VALIDATED_EMAIL_TARGETS.csv"),
    [
      "company,email,uei,title",
      'One LLC,"owner@one.com",UEI-ONE,President',
      'Two LLC,"contact@two.org",UEI-TWO,Owner',
      'Two LLC,"noreply@two.com",UEI-TWO,Owner'
    ].join("\n")
  );

  const service = new Service({ root });
  const plan = service.plan({
    candidatesPath: candidatePath,
    searchRoots: [sources]
  });
  assert.strictEqual(plan.trustedCsvFilesFound, 1);
  assert.strictEqual(plan.safety.operationalWritesAllowed, false);

  const result = await service.recover({
    candidatesPath: candidatePath,
    searchRoots: [sources],
    runId: "TEST"
  });
  assert.strictEqual(result.counts.candidatesProcessed, 2);
  assert.strictEqual(
    result.counts.candidatesWithRecoveredEmail,
    1
  );
  assert.strictEqual(
    result.counts.candidatesWithoutRecoveredEmail,
    1
  );
  assert.strictEqual(result.counts.freshVerifiedEmailReady, 0);
  assert.strictEqual(
    result.sourceCounts.rejectionReasons
      .BLOCKED_INSTITUTIONAL_DOMAIN,
    1
  );
  assert.strictEqual(
    result.sourceCounts.rejectionReasons
      .BLOCKED_NON_BUYER_MAILBOX,
    1
  );

  const recoveredPath = result.artifacts.find(item =>
    item.filePath.endsWith(
      "gsa_email_reverification_candidates.jsonl"
    )
  ).filePath;
  const recovered = JSON.parse(
    fs.readFileSync(recoveredPath, "utf8").trim()
  );
  assert.strictEqual(
    recovered.recoveredEmailMatch.emails[0].email,
    "owner@one.com"
  );
  assert.strictEqual(
    recovered.recoveredEmailMatch.guessedEmailsUsed,
    false
  );
  assert.strictEqual(
    recovered.verifiedEmailGate.operationallyEligible,
    false
  );

  assert.deepStrictEqual(
    cli.parseArgs(["--apply", "--search-root=x"]),
    {
      apply: true,
      candidatesPath: null,
      searchRoots: ["x"],
      outputRoot: null,
      runId: null,
      help: false
    }
  );

  fs.rmSync(root, { recursive: true, force: true });
  console.log("GOVERNMENT_VERIFIED_EMAIL_RECOVERY_TEST_PASS 13/13");
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
