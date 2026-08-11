"use strict";

const assert = require("assert");
const service = require("../SERVICES/StateSledFlLiveExecutionService");
const rules = require("../CONFIG/state_sled_fl_live_execution_rules.json");

const healthy = service.selectHealthySenders({ items: [
  { email: "good@example.com", status: 1, warmup_status: 1, setup_pending: false, stat_warmup_score: 90 },
  { email: "bad@example.com", status: -1, warmup_status: 1, setup_pending: false, stat_warmup_score: 95 },
  { email: "cold@example.com", status: 1, warmup_status: 1, setup_pending: false, stat_warmup_score: 50 }
]}, rules);

assert.strictEqual(healthy.length, 1);
assert.strictEqual(healthy[0].email, "good@example.com");

const payload = service.buildCampaignPayload(rules, ["good@example.com"]);
assert.strictEqual(payload.name, "STATE SLED - FL");
assert.deepStrictEqual(payload.email_list, ["good@example.com"]);
assert.strictEqual(payload.daily_limit, 25);
assert.strictEqual(payload.stop_on_reply, true);
assert.strictEqual(payload.link_tracking, false);
assert.strictEqual(payload.open_tracking, false);
assert.strictEqual(payload.insert_unsubscribe_header, true);
assert.strictEqual(Array.isArray(payload.sequences), true);
assert.strictEqual(payload.sequences[0].steps.length, 4);

const lead = service.buildLeadPayload({
  discoveredEmail: "verified@example.com",
  legalName: "Example LLC",
  domain: "example.com",
  uei: "ABC123"
}, "campaign-id");

assert.strictEqual(lead.campaign, "campaign-id");
assert.strictEqual(lead.email, "verified@example.com");
assert.strictEqual(lead.skip_if_in_workspace, true);
assert.strictEqual(lead.skip_if_in_campaign, true);

console.log("STATE_SLED_FL_LIVE_EXECUTION_TEST=PASS");
