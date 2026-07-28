"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require(
  "../SERVICES/LegacySegmentReconciliationService"
);
const cli = require(
  "../SCRIPTS/ReconcileLegacySegmentsStaging"
);

function jsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${rows.map(JSON.stringify).join("\n")}\n`,
    "utf8"
  );
}

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "legacy-reconcile-")
  );
  const staging = path.join(
    root,
    "DATA",
    "staging",
    "government_data"
  );
  const masterRoot = path.join(
    root,
    "Good Files to use",
    "Good To Use and segmented"
  );
  fs.mkdirSync(masterRoot, { recursive: true });
  const legacyMasterPath = path.join(
    masterRoot,
    "MASTER_DEDUPED_ALL_SEGMENTS.csv"
  );
  fs.writeFileSync(
    legacyMasterPath,
    [
      [
        "Campaign Name",
        "Email",
        "company_id",
        "uei",
        "legal_name",
        "primary_naics",
        "first_gsa_award_date",
        "federal_revenue",
        "expiration_date",
        "segment"
      ].map(value => `"${value}"`).join(","),
      '"GSA No Sales","owner@alpha.com","A-1","UEI-ALPHA",' +
        '"Alpha LLC","541611","2026-07-10","0","2026-08-15","GSA"',
      '"GSA No Sales","old@alpha.com","A-1","UEI-ALPHA",' +
        '"Alpha LLC","541611","2026-07-10","0","2026-08-15","GSA"',
      '"SAM","contact@beta.com","B-1","UEI-BETA",' +
        '"Beta LLC","541611","","0","","SAM"',
      '"Other","person@gamma.com","C-1","UEI-GAMMA",' +
        '"Gamma LLC","722513","","0","",""',
      '"SBS","","","","","541611","","0","","SBS"',
      '"SAM","buyer@factory.com","F-1","UEI-FACTORY",' +
        '"Custom Manufacturing LLC","332710","","0","","SAM"'
    ].join("\n") + "\n",
    "utf8"
  );

  const verificationRoot = path.join(
    staging,
    "email_verification",
    "VERIFY"
  );
  const verifiedPath = path.join(
    verificationRoot,
    "gsa_freshly_verified_ok.jsonl"
  );
  jsonl(verifiedPath, [
    {
      uei: "UEI-ALPHA",
      legalBusinessName: "Alpha LLC",
      naicsCodes: ["541611"],
      gsaEligibility: {
        currentGsaNaicsMatch: true,
        matchedNaics: ["541611"],
        matchedSins: ["541611"]
      },
      recoveredEmailMatch: {
        emails: [
          {
            email: "owner@alpha.com",
            authorityScore: 100,
            freshVerification: {
              provider: "MillionVerifier",
              result: "ok"
            }
          }
        ]
      }
    }
  ]);
  const reportPath = path.join(
    verificationRoot,
    "millionverifier_all_results.csv"
  );
  fs.writeFileSync(
    reportPath,
    "email,result\nowner@alpha.com,ok\n" +
      "old@alpha.com,invalid\ncontact@beta.com,catch_all\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(verificationRoot, "manifest.json"),
    JSON.stringify({
      ok: true,
      status: "COMPLETED",
      generatedAt: "2026-07-28T02:00:00.000Z",
      artifacts: [
        { filePath: verifiedPath },
        { filePath: reportPath }
      ]
    }),
    "utf8"
  );

  const gsaRoot = path.join(staging, "GOVDATA");
  fs.mkdirSync(gsaRoot, { recursive: true });
  const allowlistPath = path.join(
    gsaRoot,
    "gsa_mas_sin_naics_allowlist.json"
  );
  fs.writeFileSync(
    allowlistPath,
    JSON.stringify({
      uniqueNaics: ["541611"],
      offerings: [
        { sin: "541611", naicsCodes: ["541611"] }
      ]
    }),
    "utf8"
  );

  const recoveryRoot = path.join(
    staging,
    "email_recovery",
    "RECOVERY"
  );
  fs.mkdirSync(recoveryRoot, { recursive: true });
  fs.writeFileSync(
    path.join(recoveryRoot, "email_source_inventory.json"),
    JSON.stringify({
      inventory: [{ filePath: legacyMasterPath }]
    }),
    "utf8"
  );
  return {
    root,
    legacyMasterPath,
    verifiedPath,
    allowlistPath,
    reportPath
  };
}

async function run() {
  const data = fixture();
  const service = new Service({ root: data.root });
  const plan = service.plan();
  assert.strictEqual(plan.mode, "PLAN_ONLY");
  assert.strictEqual(
    plan.inputs.legacySegmentMaster,
    data.legacyMasterPath
  );
  assert.strictEqual(
    plan.reconciliation.everyLegacyRowAccountedFor,
    true
  );
  assert.strictEqual(plan.safety.legacySourceDeletions, false);

  const result = await service.reconcile({
    runId: "TEST",
    now: "2026-07-28T00:00:00.000Z"
  });
  assert.strictEqual(result.status, "COMPLETED");
  assert.strictEqual(result.counts.legacyRowsProcessed, 6);
  assert.strictEqual(result.counts.refreshedVerifiedCompanies, 1);
  assert.strictEqual(
    result.counts.categories.RETAINED_FRESH_VERIFIED,
    1
  );
  assert.strictEqual(
    result.counts.categories.OLDER_DUPLICATE_OF_RETAINED,
    1
  );
  assert.strictEqual(
    result.counts.categories.QUALIFIED_NEEDS_VERIFIED_EMAIL,
    1
  );
  assert.strictEqual(
    result.counts.categories.NO_CURRENT_GSA_MATCH,
    1
  );
  assert.strictEqual(
    result.counts.categories.IDENTITY_UNRESOLVED,
    1
  );
  assert.strictEqual(
    result.counts.categories.DISALLOWED_ENTITY_OR_MANUFACTURING,
    1
  );
  assert.strictEqual(
    result.conservation.classifiedRows,
    result.conservation.sourceRows
  );
  assert.strictEqual(
    result.nextGate.operationalAuthorization,
    false
  );

  const masterPath = result.artifacts.find(item =>
    item.filePath.endsWith(
      "refreshed_verified_segment_master.jsonl"
    )
  ).filePath;
  const master = JSON.parse(
    fs.readFileSync(masterPath, "utf8").trim()
  );
  assert.strictEqual(
    master.segmentation.primarySegment,
    "New GSA Holders This Month"
  );
  assert.strictEqual(master.segmentation.priorityRank, 1);
  assert.strictEqual(
    result.segmentation.samRegistrationDateUsedAsGsaAwardDate,
    false
  );
  assert.strictEqual(
    master.outboundReadiness.operationalImportApproved,
    false
  );
  assert.strictEqual(
    master.recoveredEmailMatch.emails[0]
      .freshVerification.result,
    "ok"
  );

  const deletionPlanPath = result.artifacts.find(item =>
    item.filePath.endsWith(
      "legacy_deletion_replacement_plan.json"
    )
  ).filePath;
  const deletionPlan = JSON.parse(
    fs.readFileSync(deletionPlanPath, "utf8")
  );
  assert.strictEqual(deletionPlan.safeToDeleteNow, false);
  assert.strictEqual(deletionPlan.deletionAuthorized, false);
  assert.strictEqual(deletionPlan.candidateRows, 1);

  assert.deepStrictEqual(
    cli.parseArgs([
      "--apply",
      "--legacy-master=C:\\legacy.csv",
      "--run-id=RUN"
    ]),
    {
      apply: true,
      legacyMasterPath: "C:\\legacy.csv",
      verifiedPath: null,
      allowlistPath: null,
      verificationReportPath: null,
      outputRoot: null,
      runId: "RUN",
      help: false
    }
  );

  console.log("LEGACY_SEGMENT_RECONCILIATION_TEST_PASS 18/18");
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
