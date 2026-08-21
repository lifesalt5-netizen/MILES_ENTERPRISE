"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const TruthIntakeService = require("../SERVICES/revenue/GovernmentContractorTruthVerificationIntakeService");
const VerificationBatchService = require("../SERVICES/revenue/RevenueEmailVerificationBatchService");
const VerificationRunner = require("../SERVICES/revenue/TruthRecoveredVerificationRunner");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }

function parseArguments(argv) {
  const limitArg = argv.find(value => value.startsWith("--credit-limit="));
  const masterArg = argv.find(value => value.startsWith("--master="));
  const recoveryArg = argv.find(value => value.startsWith("--recovery-detail="));
  return {
    prepare: argv.includes("--prepare"),
    verify: argv.includes("--verify"),
    creditLimit: limitArg ? Number(limitArg.slice("--credit-limit=".length)) : 0,
    masterPath: masterArg ? masterArg.slice("--master=".length) : null,
    recoveryDetailPath: recoveryArg ? recoveryArg.slice("--recovery-detail=".length) : null
  };
}

function ensurePositiveLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("A positive integer --credit-limit is required for prepare/verify.");
  return limit;
}

function writeEmptyClassification(root) {
  fs.mkdirSync(root, { recursive: true });
  const pendingPath = path.join(root, "pending_verification.jsonl");
  const manifestPath = path.join(root, "manifest.json");
  fs.writeFileSync(pendingPath, "", "utf8");
  const manifest = {
    ok: true,
    status: "CLASSIFIED",
    summary: { pendingVerification: 0 },
    conservation: { ok: true },
    classificationFingerprint: sha256("TRUTH_RECOVERED_ONLY_EMPTY_CANONICAL")
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return { pendingPath, manifestPath, classificationFingerprint: manifest.classificationFingerprint };
}

async function run(input = {}, options = {}) {
  const rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, ".."));
  const gateRoot = options.gateRoot || path.join(rootDir, "DATA", "runtime", "revenue", "truth_recovered_production_gate");
  const truthIntakeRoot = path.join(gateRoot, "truth_intake");
  const classificationRoot = path.join(gateRoot, "empty_canonical_classification");
  const batchRoot = path.join(gateRoot, "verification_batch");
  const verifyRoot = path.join(gateRoot, "verification_run");

  if (input.prepare !== true && input.verify !== true) {
    return {
      ok: true,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      gateRoot,
      truthOnly: true,
      creditsUsed: 0,
      externalVerificationRequested: false,
      leadsUploaded: false,
      emailsSent: false,
      campaignsChanged: false
    };
  }

  const creditLimit = ensurePositiveLimit(input.creditLimit);
  const Intake = options.IntakeService || TruthIntakeService;
  const Batch = options.BatchService || VerificationBatchService;
  const Runner = options.VerificationRunner || VerificationRunner;

  const intake = new Intake({
    rootDir,
    masterPath: input.masterPath || undefined,
    recoveryDetailPath: input.recoveryDetailPath || undefined,
    outputRoot: truthIntakeRoot
  }).build({ apply: true });
  if (intake.ok !== true || intake.status !== "TRUTH_CONTACT_VERIFICATION_INTAKE_PREPARED") {
    throw new Error("Truth recovered intake did not complete safely.");
  }

  const emptyClassification = writeEmptyClassification(classificationRoot);
  const batch = new Batch({
    rootDir,
    classificationRoot,
    truthIntakeRoot,
    outputRoot: batchRoot
  }).build({ apply: true, creditLimit });
  if (batch.ok !== true || batch.status !== "BATCH_PREPARED" || batch.conservation?.ok !== true) {
    throw new Error("Truth recovered verification batch did not complete safely.");
  }
  if (Number(batch.summary.canonicalPending) !== 0) throw new Error("Truth-only gate unexpectedly included canonical pending inventory.");
  if (Number(batch.summary.selectedForVerification) > creditLimit) throw new Error("Truth-only gate exceeded the explicit credit limit.");

  const prepared = {
    ok: true,
    mode: input.verify === true ? "VERIFY" : "PREPARE_ONLY",
    status: input.verify === true ? "PREPARED_FOR_AUTHORIZED_VERIFICATION" : "TRUTH_RECOVERED_BATCH_PREPARED",
    truthOnly: true,
    creditLimit,
    recoveredRows: intake.summary.recoveredRows,
    verificationPending: intake.summary.verificationPending,
    held: intake.summary.held,
    blockerCounts: intake.summary.blockerCounts,
    selectedForVerification: batch.summary.selectedForVerification,
    deferred: batch.summary.deferred,
    duplicateOverlap: batch.summary.duplicateOverlap,
    intakeFingerprint: intake.intakeFingerprint,
    batchFingerprint: batch.batchFingerprint,
    emptyCanonicalClassificationFingerprint: emptyClassification.classificationFingerprint,
    creditsUsed: 0,
    externalVerificationRequested: false,
    leadsUploaded: false,
    emailsSent: false,
    campaignsChanged: false,
    artifacts: { truthIntakeRoot, batchRoot, gateRoot }
  };

  if (input.verify !== true) {
    fs.mkdirSync(gateRoot, { recursive: true });
    fs.writeFileSync(path.join(gateRoot, "manifest.json"), JSON.stringify(prepared, null, 2), "utf8");
    return prepared;
  }

  const verification = await new Runner({ rootDir, batchRoot, outputRoot: verifyRoot }).run({
    apply: true,
    creditBudget: creditLimit
  });
  const completed = {
    ...prepared,
    status: verification.status,
    creditsUsed: Number(verification.creditsUsed || 0),
    creditsRemaining: Number(verification.creditsRemaining || 0),
    externalVerificationRequested: verification.externalVerificationRequested === true,
    verification,
    leadsUploaded: false,
    emailsSent: false,
    campaignsChanged: false
  };
  fs.mkdirSync(gateRoot, { recursive: true });
  fs.writeFileSync(path.join(gateRoot, "manifest.json"), JSON.stringify(completed, null, 2), "utf8");
  return completed;
}

async function main() {
  const result = await run(parseArguments(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (result.ok !== true && result.status !== "AWAITING_APPROVAL") process.exitCode = 1;
  if (result.mode === "PLAN_ONLY") {
    console.log("\nPLAN ONLY. Use --prepare --credit-limit=N to build a truth-only verification batch without spending credits. Use --verify only when the explicit MillionVerifier authorization environment gate has been approved and configured.");
  }
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { run, main, parseArguments, writeEmptyClassification };
