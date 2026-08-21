"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/LeadSupplyChainCloseoutService");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-lead-closeout-"));
const intelligence = path.join(root, "intel");
const truth = path.join(intelligence, "GOVERNMENT_CONTRACTOR_TRUTH");
const legacy = path.join(intelligence, "CONSOLIDATION OF LEADS");
const sledDir = path.join(root, "DATA", "OUTBOUND", "STATE_SLED", "INSTANTLY_RECONCILIATION");
const gateDir = path.join(root, "DATA", "runtime", "revenue", "truth_recovered_production_gate");
const verifyDir = path.join(root, "DATA", "runtime", "revenue", "email_verification_results");
for (const d of [truth, legacy, sledDir, gateDir, verifyDir]) fs.mkdirSync(d, { recursive: true });

fs.writeFileSync(path.join(truth, "GOVERNMENT_CONTRACTOR_TRUTH_MASTER_CONTACTS_V2.csv"), [
  "uei,legal_name,state,email,vehicle_memberships,segments",
  "UEI001,Alpha LLC,FL,alpha@example.com,GSA,GSA_NO_SALES",
  "UEI002,Beta Inc,VA,beta@example.com,POLARIS,POLARIS_LOW_SALES",
  "UEI003,Gamma Corp,TX,,GSA,GSA_LOW_SALES"
].join("\n"));

fs.writeFileSync(path.join(legacy, "a.csv"), [
  "UEI,Legal_Name,State,email",
  "UEI001,Alpha LLC,FL,alpha@example.com",
  "UEI001,Alpha LLC,FL,alpha2@example.com",
  "UEI999,Old Co,NY,old@example.com",
  ",Blank Identity,,blank@example.com"
].join("\n"));
fs.writeFileSync(path.join(legacy, "b.csv"), [
  "UEI,Legal_Name,State,email",
  "UEI002,Beta Inc,VA,beta@example.com",
  "UEI999,Old Co,NY,old2@example.com"
].join("\n"));

fs.writeFileSync(path.join(sledDir, "STATE_SLED_WAVE1_VERIFIED_MASTER.csv"), [
  "uei,Legal_Name,State,discoveredEmail",
  "SLED001,State Alpha,FL,statealpha@example.com",
  "SLED002,State Beta,TX,statebeta@example.com"
].join("\n"));
fs.writeFileSync(path.join(gateDir, "manifest.json"), JSON.stringify({ ok:true, status:"VERIFICATION_AND_RECONCILIATION_COMPLETED", recoveredRows:1, verificationPending:0, held:0, selectedForVerification:1, creditsUsed:1 }, null, 2));
fs.writeFileSync(path.join(verifyDir, "send_ready.jsonl"), JSON.stringify({ email:"alpha@example.com" }) + "\n");

let passed = 0;
function check(condition, label) { if (!condition) throw new Error(`[FAIL] ${label}`); passed += 1; console.log(`[PASS] ${label}`); }

(async () => {
  const service = new Service({ rootDir: root, intelligenceRoot: intelligence });
  const plan = await service.run();
  check(plan.mode === "PLAN_ONLY" && plan.writes === false, "default mode is safe plan-only");

  const result = await service.run({ apply:true });
  check(result.ok === true, "closeout is green on complete evidence");
  check(result.summary.authoritativeCompanies === 3, "authoritative company count is exact");
  check(result.summary.federalSegments === 3, "federal segment inventory is recomputed");
  check(result.summary.sledSegments === 2, "SLED inventory comes from verified master");
  check(result.summary.legacyRowsScanned === 6, "legacy row count is streamed exactly");
  check(result.summary.legacyUniqueIdentities === 4, "legacy identities are deduped");
  check(result.summary.legacyDuplicateOrOverlapRows === 2, "legacy overlap and duplicate rows are measured");
  check(result.summary.verificationProvenRecoveredContacts === 1, "verification-proven contact count is separate from known email count");

  const out = path.join(root, "DATA", "revenue", "lead_supply_chain_closeout");
  for (const name of ["LEAD_SUPPLY_CHAIN_WATERFALL.json","FED_SEGMENT_INVENTORY.csv","SLED_SEGMENT_INVENTORY.csv","SEGMENT_REPLENISHMENT_PLAN.csv","LEAD_PIPELINE_DEFECTS.md","LEAD_SUPPLY_CHAIN_CLOSEOUT_MANIFEST.json"]) {
    check(fs.existsSync(path.join(out, name)), `${name} is produced`);
  }

  console.log(`LEAD_SUPPLY_CHAIN_CLOSEOUT_V8_TEST_PASS ${passed}/${passed}`);
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
