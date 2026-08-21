"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Runner = require("../SERVICES/revenue/TruthRecoveredVerificationRunner");
const { parseArguments } = require("../SCRIPTS/RunTruthRecoveredVerification");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-truth-verify-runner-"));
  const configDir = path.join(root, "CONFIG");
  const batchRoot = path.join(root, "batch");
  const outputRoot = path.join(root, "run-output");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(batchRoot, { recursive: true });
  const rulesPath = path.join(configDir, "rules.json");
  fs.writeFileSync(rulesPath, JSON.stringify({
    authorizationEnv: "TEST_AUTH",
    authorizationToken: "ALLOW",
    apiBaseUrlEnv: "TEST_API_URL",
    apiKeyEnvNames: ["TEST_API_KEY"],
    timeoutSeconds: 10,
    acceptedResults: ["ok"],
    rejectedResults: ["invalid"],
    maxCreditBudget: 5,
    concurrency: 2
  }), "utf8");
  fs.writeFileSync(path.join(batchRoot, "millionverifier_batch.csv"),
    "email,verification_priority,priority_segment,segments,source_family,truth_uei\n" +
    "good@example.com,4,GSA,GSA,GOVERNMENT_CONTRACTOR_TRUTH_RECOVERY,U1\n" +
    "bad@example.com,5,VA,VA,GOVERNMENT_CONTRACTOR_TRUTH_RECOVERY,U2\n", "utf8");
  fs.writeFileSync(path.join(batchRoot, "manifest.json"), JSON.stringify({
    ok: true,
    status: "BATCH_PREPARED",
    batchFingerprint: "B".repeat(64),
    sourceTruthIntakeFingerprint: "T".repeat(64),
    summary: { selectedForVerification: 2 },
    conservation: { ok: true }
  }), "utf8");

  let providerCalls = 0;
  let reconciledReport = null;
  const verifyProvider = async email => {
    providerCalls += 1;
    return email.startsWith("good")
      ? { status: "COMPLETE", quality: "good", result: "ok", free: "no", role: "no" }
      : { status: "COMPLETE", quality: "bad", result: "invalid", free: "no", role: "no" };
  };
  const reconciliationFactory = () => ({
    reconcile({ reportPath }) {
      reconciledReport = fs.readFileSync(reportPath, "utf8");
      return {
        ok: true,
        reconciliationFingerprint: "R".repeat(64),
        summary: { sendReady: 1, riskyBlocked: 0, doNotMail: 1 }
      };
    }
  });

  const baseOptions = { rootDir: root, rulesPath, batchRoot, outputRoot, verifyProvider, reconciliationFactory, generatedAt: () => "2026-08-21T00:05:00-04:00" };
  const noAuthRunner = new Runner({ ...baseOptions, env: { TEST_API_URL: "https://example.invalid", TEST_API_KEY: "key" } });
  await test("default mode is plan-only", async () => assert.strictEqual((await noAuthRunner.run({})).mode, "PLAN_ONLY"));
  await test("plan spends zero credits", async () => assert.strictEqual((await noAuthRunner.run({})).creditsUsed, 0));
  const awaiting = await noAuthRunner.run({ apply: true, creditBudget: 2 });
  await test("missing authorization fails closed", async () => assert.strictEqual(awaiting.status, "AWAITING_APPROVAL"));
  await test("missing authorization makes no provider calls", async () => assert.strictEqual(providerCalls, 0));

  const env = { TEST_AUTH: "ALLOW", TEST_API_URL: "https://example.invalid", TEST_API_KEY: "key" };
  const runner = new Runner({ ...baseOptions, env });
  await test("zero budget is rejected", async () => assert.rejects(() => runner.run({ apply: true, creditBudget: 0 }), /positive integer/));
  await test("budget over governed max is rejected", async () => assert.rejects(() => runner.run({ apply: true, creditBudget: 6 }), /governed maximum/));
  await test("budget below batch size is rejected", async () => assert.rejects(() => runner.run({ apply: true, creditBudget: 1 }), /exceeds the explicit credit budget/));

  const result = await runner.run({ apply: true, creditBudget: 2 });
  await test("exact batch verifies", async () => assert.strictEqual(result.status, "VERIFICATION_AND_RECONCILIATION_COMPLETED"));
  await test("provider is called once per authorized email", async () => assert.strictEqual(providerCalls, 2));
  await test("credits used equals exact batch size", async () => assert.strictEqual(result.creditsUsed, 2));
  await test("credit budget is not exceeded", async () => assert.strictEqual(result.creditsRemaining, 0));
  await test("truth intake fingerprint is preserved", async () => assert.strictEqual(result.truthIntakeFingerprint, "T".repeat(64)));
  await test("reconciliation is invoked", async () => assert.ok(reconciledReport && reconciledReport.includes("good@example.com,good,ok")));
  await test("verification report includes invalid result", async () => assert.ok(reconciledReport.includes("bad@example.com,bad,invalid")));
  await test("provider write scope is verification only", async () => assert.strictEqual(result.providerWriteScope, "MILLIONVERIFIER_VERIFY_ONLY"));
  await test("no leads upload", async () => assert.strictEqual(result.leadsUploaded, false));
  await test("no email sends", async () => assert.strictEqual(result.emailsSent, false));
  await test("no campaigns change", async () => assert.strictEqual(result.campaignsChanged, false));
  await test("manifest is written", async () => assert.ok(fs.existsSync(result.manifestPath)));

  const missingKey = new Runner({ ...baseOptions, env: { TEST_AUTH: "ALLOW", TEST_API_URL: "https://example.invalid" } });
  await test("missing API key fails before provider call", async () => assert.rejects(() => missingKey.run({ apply: true, creditBudget: 2 }), /API key/));
  const missingUrl = new Runner({ ...baseOptions, env: { TEST_AUTH: "ALLOW", TEST_API_KEY: "key" } });
  await test("missing API base URL fails before provider call", async () => assert.rejects(() => missingUrl.run({ apply: true, creditBudget: 2 }), /TEST_API_URL/));
  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { apply: false, creditBudget: 0 }));
  await test("CLI parses explicit budget", async () => assert.deepStrictEqual(parseArguments(["--apply", "--credit-budget=51"]), { apply: true, creditBudget: 51 }));

  console.log("TRUTH_RECOVERED_VERIFICATION_RUNNER_TEST_PASS " + passed + "/23");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
