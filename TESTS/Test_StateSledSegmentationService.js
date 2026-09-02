"use strict";

const assert = require("assert");
const svc = require("../SERVICES/StateSledSegmentationService");
const rules = require("../CONFIG/state_sled_segmentation_rules.json");

const good = {
  Entity_Status: "A",
  Country: "USA",
  NORMALIZED_STATE: "FL",
  Industry_Segment: "IT_SERVICES",
  Market_Priority: "TOP_MARKET",
  Final_Consulting_Tier: "Tier 1",
  Lead_Score: "85",
  POC_Email: ""
};

assert.strictEqual(svc.baseEligible(good, rules), true);
assert.strictEqual(svc.qualifiesWave(good, rules.wave1), true);
assert.strictEqual(svc.enrichmentDisposition(good, rules), "ENRICHMENT_REQUIRED");

const legacyExcluded = { ...good, evan_base_qualified: "NO", evan_segment: "EXCLUDE" };
assert.strictEqual(svc.baseEligible(legacyExcluded, rules), true, "legacy EVAN fields must not veto P1.3 eligibility");

const wrongState = { ...good, NORMALIZED_STATE: "AK" };
assert.strictEqual(svc.qualifiesWave(wrongState, rules.wave1), false);
assert.strictEqual(svc.qualifiesWave(wrongState, rules.wave2), true);

const weakScore = { ...good, Lead_Score: "50" };
assert.strictEqual(svc.qualifiesWave(weakScore, rules.wave1), false);
assert.strictEqual(svc.qualifiesWave(weakScore, rules.wave2), false);

const excludedIndustry = { ...good, Industry_Segment: "REAL_ESTATE_RENTAL" };
assert.strictEqual(svc.baseEligible(excludedIndustry, rules), false);

const inactive = { ...good, Entity_Status: "I" };
assert.strictEqual(svc.baseEligible(inactive, rules), false);

const withEmail = { ...good, POC_Email: "owner@example.com" };
assert.strictEqual(svc.enrichmentDisposition(withEmail, rules), "VERIFICATION_REQUIRED");

console.log("STATE_SLED_SEGMENTATION_TEST=PASS");
