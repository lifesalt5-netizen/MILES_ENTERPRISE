"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/GovernmentContractorTruthVerificationIntakeService");
const { parseArguments } = require("../SCRIPTS/PrepareGovernmentContractorTruthVerificationIntake");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-truth-intake-"));
  const masterPath = path.join(root, "master.csv");
  const recoveryPath = path.join(root, "recovery.csv");
  const modelPath = path.join(root, "model.json");
  const outputRoot = path.join(root, "output");

  fs.writeFileSync(masterPath,
    "uei,legal_name,state,email,vehicle_memberships,segments\n" +
    "U1,Acme LLC,FL,gsa@example.com,GSA;POLARIS,GSA_NO_SALES;POLARIS_NO_SALES\n" +
    "U2,Beta LLC,TX,polaris@example.com,POLARIS,POLARIS_NO_SALES\n" +
    "U3,Gamma LLC,VA,va@example.com,VA_FSS;ALLIANT_3,VA_FSS_LOW_SALES;ALLIANT_3_LOW_SALES\n" +
    "U4,Delta LLC,MD,bad-email,SAM,SAM_NO_SALES\n", "utf8");
  fs.writeFileSync(recoveryPath,
    "row_index,uei,legal_name,state,vehicle_memberships,email,contact_source,match_method,source_path\n" +
    "1,U1,Acme LLC,FL,GSA;POLARIS,gsa@example.com,SAM,UEI,source-a.csv\n" +
    "2,U2,Beta LLC,TX,POLARIS,polaris@example.com,STATE_SLED,UEI,source-b.csv\n" +
    "3,U3,Gamma LLC,VA,VA_FSS;ALLIANT_3,va@example.com,SBA_SBS,UEI,source-c.csv\n" +
    "4,U4,Delta LLC,MD,SAM,bad-email,SAM,UEI,source-d.csv\n", "utf8");
  fs.writeFileSync(modelPath, JSON.stringify({
    assignmentPolicy: { priorityOrder: ["EXPIRED_EVERYTHING","EXPIRING_6M","EXPIRING_12M","GSA","VA","SAM","CERTIFICATIONS","SBS","SLED_STATE"] },
    segments: [{ id: "gsa_no_sales" }]
  }), "utf8");

  const service = new Service({ rootDir: root, masterPath, recoveryDetailPath: recoveryPath, segmentModelPath: modelPath, outputRoot, generatedAt: () => "2026-08-20T23:55:00-04:00" });
  await test("service is constructable", async () => assert.ok(service));
  const plan = service.build({});
  await test("default mode is plan-only", async () => assert.strictEqual(plan.mode, "PLAN_ONLY"));
  await test("plan writes nothing", async () => assert.strictEqual(fs.existsSync(outputRoot), false));
  await test("plan requires verification", async () => assert.strictEqual(plan.verificationRequired, true));
  await test("plan authorizes no outbound", async () => assert.strictEqual(plan.providerWritesAuthorized || plan.leadsUploaded || plan.emailsSent || plan.campaignsChanged, false));

  const result = service.build({ apply: true });
  await test("intake is prepared", async () => assert.strictEqual(result.status, "TRUTH_CONTACT_VERIFICATION_INTAKE_PREPARED"));
  await test("two governed contacts become verification-pending", async () => assert.strictEqual(result.summary.verificationPending, 2));
  await test("two unsafe contacts are held", async () => assert.strictEqual(result.summary.held, 2));
  await test("POLARIS-only contact is held for missing outbound ownership", async () => assert.strictEqual(result.summary.blockerCounts.NO_GOVERNED_OUTBOUND_SEGMENT, 1));
  await test("invalid syntax is held", async () => assert.strictEqual(result.summary.blockerCounts.INVALID_EMAIL_SYNTAX, 1));
  await test("UEI identity matching is recorded", async () => assert.strictEqual(result.summary.identityMatchedByUei, 3));
  await test("conservation passes", async () => assert.strictEqual(result.conservation.ok, true));
  const pending = fs.readFileSync(result.artifacts.pending.filePath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  await test("GSA ownership is retained", async () => assert.deepStrictEqual(pending.find(row => row.email === "gsa@example.com").segments, ["GSA"]));
  await test("VA FSS ownership maps to governed VA", async () => assert.deepStrictEqual(pending.find(row => row.email === "va@example.com").segments, ["VA"]));
  await test("truth provenance is retained", async () => assert.strictEqual(pending.find(row => row.email === "gsa@example.com").truthUei, "U1"));
  await test("every admitted contact remains verification-required", async () => assert.ok(pending.every(row => row.verificationRequired === true && row.classification === "PENDING_VERIFICATION")));
  await test("no external verification is called", async () => assert.strictEqual(result.externalVerificationRequested, false));
  await test("no provider writes occur", async () => assert.strictEqual(result.providerWritesAuthorized, false));
  await test("no leads upload", async () => assert.strictEqual(result.leadsUploaded, false));
  await test("no emails send", async () => assert.strictEqual(result.emailsSent, false));
  await test("no campaigns change", async () => assert.strictEqual(result.campaignsChanged, false));
  await test("fingerprint is recorded", async () => assert.match(result.intakeFingerprint, /^[A-F0-9]{64}$/));
  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { apply: false, masterPath: null, recoveryDetailPath: null }));
  await test("CLI parses explicit paths", async () => assert.deepStrictEqual(parseArguments(["--apply","--master=A.csv","--recovery-detail=B.csv"]), { apply: true, masterPath: "A.csv", recoveryDetailPath: "B.csv" }));

  console.log("GOVERNMENT_CONTRACTOR_TRUTH_VERIFICATION_INTAKE_TEST_PASS " + passed + "/24");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
