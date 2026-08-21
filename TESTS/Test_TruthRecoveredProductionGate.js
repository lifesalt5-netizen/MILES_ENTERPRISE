"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { run, parseArguments } = require("../SCRIPTS/RunTruthRecoveredProductionGate");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

class FakeIntake {
  constructor(options) { this.options = options; }
  build() {
    fs.mkdirSync(this.options.outputRoot, { recursive: true });
    fs.writeFileSync(path.join(this.options.outputRoot, "pending_verification.jsonl"), JSON.stringify({ email: "truth@example.com", verificationRequired: true, classification: "PENDING_VERIFICATION", segments: ["GSA"] }) + "\n");
    fs.writeFileSync(path.join(this.options.outputRoot, "manifest.json"), JSON.stringify({ ok: true, status: "TRUTH_CONTACT_VERIFICATION_INTAKE_PREPARED", conservation: { ok: true }, verificationRequired: true, summary: { verificationPending: 1 } }));
    return {
      ok: true,
      status: "TRUTH_CONTACT_VERIFICATION_INTAKE_PREPARED",
      intakeFingerprint: "I".repeat(64),
      summary: { recoveredRows: 2, verificationPending: 1, held: 1, blockerCounts: { NO_GOVERNED_OUTBOUND_SEGMENT: 1 } }
    };
  }
}

class FakeBatch {
  constructor(options) { this.options = options; }
  build({ creditLimit }) {
    const empty = fs.readFileSync(path.join(this.options.classificationRoot, "pending_verification.jsonl"), "utf8");
    assert.strictEqual(empty, "");
    fs.mkdirSync(this.options.outputRoot, { recursive: true });
    fs.writeFileSync(path.join(this.options.outputRoot, "millionverifier_batch.csv"), "email\ntruth@example.com\n");
    fs.writeFileSync(path.join(this.options.outputRoot, "manifest.json"), JSON.stringify({ ok: true, status: "BATCH_PREPARED", summary: { selectedForVerification: 1 }, conservation: { ok: true } }));
    return {
      ok: true,
      status: "BATCH_PREPARED",
      batchFingerprint: "B".repeat(64),
      summary: { canonicalPending: 0, selectedForVerification: Math.min(1, creditLimit), deferred: 0, duplicateOverlap: 0 },
      conservation: { ok: true }
    };
  }
}

let runnerCalls = 0;
class FakeRunner {
  async run({ creditBudget }) {
    runnerCalls += 1;
    return {
      ok: true,
      status: "VERIFICATION_AND_RECONCILIATION_COMPLETED",
      creditsUsed: 1,
      creditsRemaining: creditBudget - 1,
      externalVerificationRequested: true,
      reconciliationSummary: { sendReady: 1, riskyBlocked: 0, doNotMail: 0 }
    };
  }
}

(async function mainTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-truth-production-gate-"));
  const gateRoot = path.join(root, "gate");
  const options = { rootDir: root, gateRoot, IntakeService: FakeIntake, BatchService: FakeBatch, VerificationRunner: FakeRunner };

  const plan = await run({}, options);
  await test("default is plan-only", async () => assert.strictEqual(plan.mode, "PLAN_ONLY"));
  await test("plan writes nothing", async () => assert.strictEqual(fs.existsSync(gateRoot), false));
  await test("plan spends zero credits", async () => assert.strictEqual(plan.creditsUsed, 0));
  await test("prepare requires positive limit", async () => assert.rejects(() => run({ prepare: true, creditLimit: 0 }, options), /positive integer/));

  const prepared = await run({ prepare: true, creditLimit: 10 }, options);
  await test("prepare-only completes", async () => assert.strictEqual(prepared.status, "TRUTH_RECOVERED_BATCH_PREPARED"));
  await test("prepare uses truth-only batch", async () => assert.strictEqual(prepared.truthOnly, true));
  await test("prepare excludes canonical inventory", async () => assert.match(prepared.emptyCanonicalClassificationFingerprint, /^[A-F0-9]{64}$/));
  await test("prepare records recovered rows", async () => assert.strictEqual(prepared.recoveredRows, 2));
  await test("prepare records held blockers", async () => assert.strictEqual(prepared.blockerCounts.NO_GOVERNED_OUTBOUND_SEGMENT, 1));
  await test("prepare selects verification-pending only", async () => assert.strictEqual(prepared.selectedForVerification, 1));
  await test("prepare spends zero credits", async () => assert.strictEqual(prepared.creditsUsed, 0));
  await test("prepare makes no verification request", async () => assert.strictEqual(prepared.externalVerificationRequested, false));
  await test("prepare does not invoke paid runner", async () => assert.strictEqual(runnerCalls, 0));
  await test("prepare uploads no leads", async () => assert.strictEqual(prepared.leadsUploaded, false));
  await test("prepare sends no emails", async () => assert.strictEqual(prepared.emailsSent, false));
  await test("prepare changes no campaigns", async () => assert.strictEqual(prepared.campaignsChanged, false));

  const verified = await run({ verify: true, creditLimit: 3 }, options);
  await test("verify invokes guarded runner once", async () => assert.strictEqual(runnerCalls, 1));
  await test("verify reports completed status", async () => assert.strictEqual(verified.status, "VERIFICATION_AND_RECONCILIATION_COMPLETED"));
  await test("verify uses actual exact-batch credits", async () => assert.strictEqual(verified.creditsUsed, 1));
  await test("verify preserves remaining budget", async () => assert.strictEqual(verified.creditsRemaining, 2));
  await test("verify marks provider request", async () => assert.strictEqual(verified.externalVerificationRequested, true));
  await test("verify still uploads no leads", async () => assert.strictEqual(verified.leadsUploaded, false));
  await test("verify still sends no emails", async () => assert.strictEqual(verified.emailsSent, false));
  await test("verify still changes no campaigns", async () => assert.strictEqual(verified.campaignsChanged, false));
  await test("gate manifest exists", async () => assert.strictEqual(fs.existsSync(path.join(gateRoot, "manifest.json")), true));

  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { prepare: false, verify: false, creditLimit: 0, masterPath: null, recoveryDetailPath: null }));
  await test("CLI parses prepare", async () => assert.deepStrictEqual(parseArguments(["--prepare", "--credit-limit=51"]), { prepare: true, verify: false, creditLimit: 51, masterPath: null, recoveryDetailPath: null }));
  await test("CLI parses verify and paths", async () => assert.deepStrictEqual(parseArguments(["--verify", "--credit-limit=25", "--master=A.csv", "--recovery-detail=B.csv"]), { prepare: false, verify: true, creditLimit: 25, masterPath: "A.csv", recoveryDetailPath: "B.csv" }));

  console.log("TRUTH_RECOVERED_PRODUCTION_GATE_TEST_PASS " + passed + "/28");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
