"use strict";

const FederalSledVendorClassificationService = require("../SERVICES/orion/FederalSledVendorClassificationService");

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`[PASS] ${message}`);
}

const service = new FederalSledVendorClassificationService({
  generatedAt: () => "2026-08-09T00:00:00.000Z"
});

const merged = service.mergeStateRows([
  {
    source: { state: "FL", name: "Florida Vendor Awards", recordType: "AWARD" },
    rows: [
      { vendor_name: "Acme Gov LLC", uei: "UEI123", email: "sales@acme.test", award_id: "FL-1", award_amount: 100000, award_date: "2026-01-10" },
      { vendor_name: "Acme Gov LLC", uei: "UEI123", email: "sales@acme.test", award_id: "FL-1", award_amount: 100000, award_date: "2026-01-10" }
    ]
  },
  {
    source: { state: "GA", name: "Georgia Vendor Awards", recordType: "AWARD" },
    rows: [
      { vendor_name: "Acme Gov LLC", uei: "UEI123", email: "sales@acme.test", award_id: "GA-9", award_amount: 250000, award_date: "2026-02-12" }
    ]
  }
]);

assert(merged.length === 1, "state vendor lists merge to one contractor identity");
assert(merged[0].sledAwardCount === 2, "duplicate state award rows do not inflate award count");
assert(merged[0].sledRevenue === 350000, "state revenue sums confirmed prime awards");
assert(merged[0].sledStates.join(",") === "FL,GA", "all awarded states are preserved");
assert(merged[0].sledStateCount === 2, "state award footprint count is preserved");
assert(merged[0].sledByState.find((row) => row.state === "FL").awardCount === 1, "per-state award counts are preserved");
assert(merged[0].sledByState.find((row) => row.state === "GA").revenue === 250000, "per-state revenue is preserved");

const authoritativeZeroFederal = {
  ok: true,
  status: "AUTHORITATIVE_AWARD_HISTORY_READ",
  source: { authoritativeForPersistence: true },
  identity: { uei: "UEI123", canonicalNames: ["Acme Gov LLC"], reconciliationRequired: false },
  summary: {
    primeAwardedRevenue: 0,
    primeAwardCount: 0,
    subcontractedRevenue: 0,
    subcontractAwardCount: 0
  }
};

const sledOnly = service.classify(merged[0], authoritativeZeroFederal);
assert(sledOnly.governmentMarket === "SLED_ONLY", "confirmed state awards plus authoritative zero federal history classify SLED only");
assert(sledOnly.sled.role === "PRIME", "state awarded vendor is treated as SLED prime");
assert(sledOnly.federal.federalRevenue === 0, "federal revenue is zero when prime and subcontract revenue are both zero");
assert(sledOnly.federal.federalAwardCount === 0, "federal award count is zero when prime and subcontract awards are both zero");
assert(sledOnly.evidence.federalZeroSalesConfirmed === true, "zero federal sales requires authoritative federal reconciliation");
assert(sledOnly.segmentation.marketingRoute === "SLED_TO_FEDERAL", "SLED-only awarded vendor routes to federal expansion marketing");
assert(sledOnly.segmentation.marketable === true, "SLED-only awarded vendor with email is marketable");

const fedAndSledAudit = {
  ok: true,
  status: "AUTHORITATIVE_AWARD_HISTORY_READ",
  source: { authoritativeForPersistence: true },
  identity: { uei: "UEI123", canonicalNames: ["Acme Gov LLC"], reconciliationRequired: false },
  summary: {
    primeAwardedRevenue: 500000,
    primeAwardCount: 2,
    subcontractedRevenue: 125000,
    subcontractAwardCount: 1
  }
};

const fedAndSled = service.classify(merged[0], fedAndSledAudit);
assert(fedAndSled.governmentMarket === "FED_AND_SLED", "federal plus state award history classifies FED and SLED");
assert(fedAndSled.federal.federalRevenue === 625000, "federal revenue equals prime plus subcontract revenue");
assert(fedAndSled.federal.federalAwardCount === 3, "federal award count equals distinct prime plus subcontract awards");
assert(fedAndSled.federal.federalRole === "PRIME_AND_SUBCONTRACTOR", "federal role preserves prime and subcontract activity");
assert(fedAndSled.segmentation.marketable === false, "FED and SLED contractor is excluded from SLED-to-federal segment");

const noEmailVendor = { ...merged[0], email: null, emails: [] };
const noEmail = service.classify(noEmailVendor, authoritativeZeroFederal);
assert(noEmail.governmentMarket === "SLED_ONLY", "SLED-only classification does not depend on email availability");
assert(noEmail.segmentation.marketable === false, "missing email blocks outreach eligibility");
assert(noEmail.segmentation.reason === "EMAIL_REQUIRED_FOR_OUTREACH", "missing-email blocker is explicit");

const vendorOnly = service.mergeStateRows([
  {
    source: { state: "TX", name: "Texas Registered Vendors", recordType: "VENDOR" },
    rows: [{ vendor_name: "Vendor Only Inc", uei: "UEI999", email: "hello@vendor.test" }]
  }
])[0];
const vendorOnlyAudit = {
  ...authoritativeZeroFederal,
  identity: { uei: "UEI999", canonicalNames: ["Vendor Only Inc"], reconciliationRequired: false }
};
const vendorOnlyResult = service.classify(vendorOnly, vendorOnlyAudit);
assert(vendorOnlyResult.governmentMarket === "STATE_VENDOR_ONLY", "registered state vendor without award evidence stays vendor-only");
assert(vendorOnlyResult.sled.awardCount === 0, "vendor registration does not count as a state award");
assert(vendorOnlyResult.segmentation.marketable === false, "vendor-only registration is not placed in awarded-state expansion segment");

const unresolvedFederal = {
  ok: false,
  status: "IDENTITY_NOT_CONFIRMED_BY_AUTHORITATIVE_SOURCES",
  source: { authoritativeForPersistence: false },
  identity: { uei: "UEI123", reconciliationRequired: true }
};
const unresolved = service.classify(merged[0], unresolvedFederal);
assert(unresolved.governmentMarket === "UNCONFIRMED", "unresolved federal identity cannot classify contractor as SLED only");
assert(unresolved.evidence.federalZeroSalesConfirmed === false, "unresolved federal lookup cannot become zero federal sales");
assert(unresolved.segmentation.eligible === false, "unresolved federal identity is excluded from segmentation");

const nameMerged = service.mergeStateRows([
  {
    source: { state: "NC", name: "NC Awards", recordType: "AWARD" },
    rows: [{ vendor_name: "Example Company, Inc.", award_id: "NC-1", award_amount: 10 }]
  },
  {
    source: { state: "SC", name: "SC Awards", recordType: "AWARD" },
    rows: [{ vendor_name: "EXAMPLE COMPANY INC", award_id: "SC-1", award_amount: 20 }]
  }
]);
assert(nameMerged.length === 1, "normalized legal names merge state records when UEI is unavailable");
assert(nameMerged[0].sledStates.join(",") === "NC,SC", "name-based merge preserves multi-state award footprint");

console.log("FEDERAL_SLED_VENDOR_CLASSIFICATION_TEST_PASS 30/30");
