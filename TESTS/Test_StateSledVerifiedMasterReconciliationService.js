"use strict";

const assert = require("assert");
const svc = require("../SERVICES/StateSledVerifiedMasterReconciliationService");

const deduped = svc.dedupeVerified([
  { discoveredEmail: "A@Example.com", state: "FL" },
  { discoveredEmail: "a@example.com", state: "TX" },
  { discoveredEmail: "b@example.com", state: "VA" }
]);
assert.strictEqual(deduped.length, 2);

const rules = {
  wave1States: ["FL", "TX", "CA", "VA", "MD"],
  campaignNaming: {
    prefix: "STATE SLED - ",
    aliases: {
      FL: ["SLED FL"], TX: [], CA: [], VA: [], MD: []
    }
  },
  pipelineStateCampaignNames: ["ACTIVE PIPELINE", "MEETING BOOKED"]
};

const expected = svc.buildExpectedCampaigns(rules, [
  { state: "FL" },
  { state: "FL" },
  { state: "VA" }
]);
assert.strictEqual(expected.find(x => x.state === "FL").verifiedContacts, 2);
assert.strictEqual(expected.find(x => x.state === "VA").verifiedContacts, 1);

const live = [
  { id: "1", name: "SLED FL", status: "draft" },
  { id: "2", name: "ACTIVE PIPELINE", status: "draft" }
];
const result = svc.reconcileCampaigns(expected, live, rules);
assert.strictEqual(result.reconciliation.find(x => x.state === "FL").status, "EXISTS");
assert.strictEqual(result.reconciliation.find(x => x.state === "TX").status, "MISSING");
assert.strictEqual(result.pipelineStateCampaigns.length, 1);

console.log("STATE_SLED_VERIFIED_MASTER_RECONCILIATION_TEST=PASS");
