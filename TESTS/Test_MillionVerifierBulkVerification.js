"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require(
  "../SERVICES/MillionVerifierBulkVerificationService"
);
const cli = require(
  "../SCRIPTS/VerifyRecoveredEmailsWithMillionVerifier"
);

function fixture(root) {
  const runRoot = path.join(
    root,
    "DATA",
    "staging",
    "government_data",
    "email_recovery",
    "RECOVERY"
  );
  fs.mkdirSync(runRoot, { recursive: true });
  const candidatePath = path.join(
    runRoot,
    "gsa_email_reverification_candidates.jsonl"
  );
  const candidates = [
    {
      uei: "UEI-ONE",
      legalBusinessName: "ONE LLC",
      recoveredEmailMatch: {
        matchedBy: "UEI",
        guessedEmailsUsed: false,
        emails: [
          { email: "owner@one.com", authorityScore: 100 },
          { email: "info@one.com", authorityScore: 10 }
        ]
      }
    },
    {
      uei: "UEI-TWO",
      legalBusinessName: "TWO LLC",
      recoveredEmailMatch: {
        matchedBy: "UEI",
        guessedEmailsUsed: false,
        emails: [
          { email: "owner@one.com", authorityScore: 50 }
        ]
      }
    }
  ];
  fs.writeFileSync(
    candidatePath,
    `${candidates.map(JSON.stringify).join("\n")}\n`
  );
  fs.writeFileSync(
    path.join(runRoot, "manifest.json"),
    JSON.stringify({
      ok: true,
      status: "COMPLETED",
      generatedAt: "2026-07-28T01:00:00.000Z",
      artifacts: [{ filePath: candidatePath }]
    })
  );
  return candidatePath;
}

class FakeClient {
  constructor(credits = 20) {
    this.available = credits;
    this.uploads = 0;
    this.infoCalls = 0;
  }

  async credits() {
    return {
      credits: this.available,
      bulk_credits: this.available
    };
  }

  async upload(apiKey, csvPath) {
    assert.strictEqual(apiKey, "SECRET");
    const csv = fs.readFileSync(csvPath, "utf8");
    assert(csv.includes("owner@one.com"));
    assert(csv.includes("info@one.com"));
    assert.strictEqual(
      csv.match(/owner@one\.com/g).length,
      1
    );
    this.uploads += 1;
    return {
      file_id: "940",
      status: "in_progress",
      unique_emails: 2,
      total_rows: 2
    };
  }

  async fileInfo() {
    this.infoCalls += 1;
    if (this.infoCalls === 1) {
      return {
        status: "in_progress",
        percent: 50,
        estimated_time_sec: 1
      };
    }
    this.available -= 2;
    return {
      status: "finished",
      percent: 100,
      total_rows: 2,
      unique_emails: 2,
      ok: 1,
      invalid: 1,
      catch_all: 0,
      unknown: 0,
      disposable: 0
    };
  }

  async download(apiKey, fileId, filter) {
    assert.strictEqual(apiKey, "SECRET");
    assert.strictEqual(fileId, "940");
    if (filter === "ok") {
      return Buffer.from("email,result\nowner@one.com,ok\n");
    }
    return Buffer.from(
      "email,result\nowner@one.com,ok\ninfo@one.com,invalid\n"
    );
  }
}

async function run() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "millionverifier-")
  );
  const inputPath = fixture(root);
  const client = new FakeClient();
  const service = new Service({
    root,
    client,
    sleep: async () => {}
  });

  const plan = await service.plan({
    inputPath,
    apiKey: "SECRET"
  });
  assert.strictEqual(plan.uniqueEmailsToVerify, 2);
  assert.strictEqual(plan.recoveredEmailAssignments, 3);
  assert.strictEqual(plan.withinAuthorizedCreditCeiling, true);
  assert.strictEqual(plan.safety.externalVerificationUpload, false);

  await assert.rejects(
    () =>
      service.verify({
        inputPath,
        apiKey: "SECRET",
        authorizeCreditUse: false
      }),
    /not authorized/
  );

  const result = await service.verify({
    inputPath,
    apiKey: "SECRET",
    authorizeCreditUse: true,
    maxCredits: 2,
    pollIntervalMs: 1,
    runId: "TEST"
  });
  assert.strictEqual(result.status, "COMPLETED");
  assert.strictEqual(result.counts.uniqueEmailsSubmitted, 2);
  assert.strictEqual(result.counts.uniqueFreshOkEmails, 1);
  assert.strictEqual(result.counts.companiesWithFreshOkEmail, 2);
  assert.strictEqual(result.counts.freshOkAssignments, 2);
  assert.strictEqual(result.nextGate.catchAllRejected, true);
  assert.strictEqual(
    result.nextGate.operationalAuthorization,
    false
  );
  assert.strictEqual(client.uploads, 1);

  const verifiedPath = result.artifacts.find(item =>
    item.filePath.endsWith("gsa_freshly_verified_ok.jsonl")
  ).filePath;
  const output = fs.readFileSync(verifiedPath, "utf8");
  assert(output.includes('"result":"ok"'));
  assert(!output.includes("info@one.com"));

  const manifestText = fs.readFileSync(
    result.manifestPath,
    "utf8"
  );
  assert(!manifestText.includes("SECRET"));

  const reused = await service.verify({
    inputPath,
    apiKey: "SECRET",
    authorizeCreditUse: true,
    maxCredits: 2
  });
  assert.strictEqual(reused.reusedCompletedRun, true);
  assert.strictEqual(client.uploads, 1);

  const lowCreditRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "millionverifier-low-")
  );
  const lowInput = fixture(lowCreditRoot);
  const lowService = new Service({
    root: lowCreditRoot,
    client: new FakeClient(1),
    sleep: async () => {}
  });
  await assert.rejects(
    () =>
      lowService.verify({
        inputPath: lowInput,
        apiKey: "SECRET",
        authorizeCreditUse: true,
        maxCredits: 2,
        runId: "LOW"
      }),
    /credits/
  );

  assert.deepStrictEqual(
    cli.parseArgs([
      "--apply",
      "--authorize-credit-use",
      "--max-credits=7493"
    ]),
    {
      apply: true,
      authorizeCreditUse: true,
      inputPath: null,
      runId: null,
      maxCredits: 7493,
      pollIntervalMs: 10000,
      maxWaitMs: 7200000,
      help: false
    }
  );

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(lowCreditRoot, { recursive: true, force: true });
  console.log(
    "MILLIONVERIFIER_BULK_VERIFICATION_TEST_PASS 18/18"
  );
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
