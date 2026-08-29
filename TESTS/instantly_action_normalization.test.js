"use strict";

const assert = require("assert");
const {
  normalizeInstantlyAction,
  resolveConnectorAction
} = require("../CORE/ExecutionActionContracts");

const aliases = {
  SYNC_CAMPAIGNS: "listCampaigns",
  REVIEW_PAUSED_CAMPAIGNS: "listCampaigns",
  REVIEW_CAMPAIGNS: "listCampaigns",
  CAMPAIGN_REVIEW: "listCampaigns",
  AUDIT_CAMPAIGNS: "listCampaigns",
  CAMPAIGN_STATUS: "listCampaigns",
  LIST_PAUSED_CAMPAIGNS: "listCampaigns"
};

for (const [requested, expected] of Object.entries(aliases)) {
  assert.strictEqual(
    normalizeInstantlyAction(requested),
    expected,
    `${requested} should normalize to ${expected}`
  );

  const resolution = resolveConnectorAction("INSTANTLY", requested);
  assert.strictEqual(resolution.supported, true, `${requested} should pass connector preflight`);
  assert.strictEqual(resolution.canonicalAction, expected);
}

assert.strictEqual(normalizeInstantlyAction("pauseCampaign"), "pauseCampaign");
assert.strictEqual(normalizeInstantlyAction("DELETE_EVERYTHING"), null);

console.log("instantly_action_normalization.test.js: PASS");
