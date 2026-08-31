"use strict";

const assert = require("assert");
const GovernmentBusinessRegistryReconciliationService =
  require("../SERVICES/GovernmentBusinessRegistryReconciliationService");
const policy = require(
  "../CONFIG/GOVERNMENT_DATA/business_registry_reconciliation_policy.json"
);

const service =
  new GovernmentBusinessRegistryReconciliationService({
    policy
  });

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

const sam = {
  source: "SAM_PUBLIC_V2",
  uei: "ABCDEF123456",
  cageCode: "1A2B3",
  legalBusinessName: "Federal Systems LLC",
  website: "https://federalsystems.com",
  physicalAddress: {
    state: "VA",
    postalCode: "22102"
  }
};

test("DSBS record matches SAM by UEI", () => {
  const result = service.reconcile(
    {
      source: "SBA_DSBS",
      uei: "ABCDEF123456",
      legalBusinessName: "Federal Systems, L.L.C.",
      sourceRecordId: "DSBS-1"
    },
    [sam]
  );
  assert.strictEqual(result.status, "SAM_ENTITY_ENRICHMENT");
  assert.strictEqual(result.matchMethod, "UEI_EXACT");
  assert.strictEqual(result.mayEnterSamMaster, true);
});

test("state registry record matches by domain", () => {
  const result = service.reconcile(
    {
      source: "STATE_BUSINESS_REGISTRY",
      legalBusinessName: "Federal Systems Incorporated",
      website: "www.federalsystems.com",
      stateRegistrationId: "S12345",
      registrationJurisdiction: "VA"
    },
    [sam]
  );
  assert.strictEqual(result.status, "SAM_ENTITY_ENRICHMENT");
  assert.strictEqual(
    result.matchMethod,
    "WEBSITE_DOMAIN_EXACT"
  );
});

test("legal name state and postal code provide fallback match", () => {
  const result = service.reconcile(
    {
      source: "STATE_BUSINESS_REGISTRY",
      legalBusinessName: "Federal Systems Inc.",
      state: "VA",
      postalCode: "22102-1234"
    },
    [sam]
  );
  assert.strictEqual(result.status, "SAM_ENTITY_ENRICHMENT");
  assert.strictEqual(
    result.matchMethod,
    "LEGAL_NAME_STATE_ADDRESS_EXACT"
  );
});

test("unmatched state business is not inserted into SAM master", () => {
  const result = service.reconcile(
    {
      source: "STATE_BUSINESS_REGISTRY",
      legalBusinessName: "Qualified New Business LLC",
      state: "FL",
      postalCode: "33602",
      stateRegistrationId: "L260000001"
    },
    [sam]
  );
  assert.strictEqual(
    result.status,
    "SAM_REGISTRATION_OPPORTUNITY"
  );
  assert.strictEqual(result.mayEnterSamMaster, false);
  assert.strictEqual(result.mayEnterProspectPool, true);
  assert.strictEqual(
    result.samRegistrationStatus,
    "NOT_FOUND"
  );
  assert.strictEqual(result.verifiedEmailRequired, true);
});

test("unmatched DSBS business cannot establish SAM registration", () => {
  const result = service.reconcile(
    {
      source: "SBA_DSBS",
      legalBusinessName: "Small Business Prospect LLC",
      state: "MD",
      postalCode: "20852"
    },
    []
  );
  assert.strictEqual(result.mayEnterSamMaster, false);
  assert.strictEqual(
    result.operationalAuthorization,
    false
  );
});

test("unknown source is rejected", () => {
  assert.throws(
    () => service.reconcile(
      {
        source: "UNVERIFIED_SCRAPE",
        legalBusinessName: "Unknown LLC"
      },
      []
    ),
    /Unrecognized business-registry source/
  );
});

test("newest record within same authority wins", () => {
  const selected = service.newestWithinAuthority([
    {
      sourceUpdatedAt: "2026-01-01",
      value: "old"
    },
    {
      sourceUpdatedAt: "2026-07-27",
      value: "new"
    }
  ]);
  assert.strictEqual(selected.value, "new");
});

test("policy keeps all reconciliation writes in staging", () => {
  assert.strictEqual(
    policy.safety.operationalWritesAllowed,
    false
  );
  assert.strictEqual(
    policy.safety.outboundInventoryWrites,
    false
  );
  assert.strictEqual(
    policy.safety.campaignWrites,
    false
  );
});

console.log(
  `GOVERNMENT_BUSINESS_REGISTRY_RECONCILIATION_TEST_PASS ${passed}/${passed}`
);
