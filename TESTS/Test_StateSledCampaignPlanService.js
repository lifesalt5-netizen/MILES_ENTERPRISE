"use strict";

const assert = require("assert");
const service = require("../SERVICES/StateSledCampaignPlanService");

assert.strictEqual(service.normalizeEmail(" Test@Example.COM "), "test@example.com");
assert.strictEqual(service.renderCampaignName("STATE SLED - {{STATE}}", "FL"), "STATE SLED - FL");

console.log("STATE_SLED_CAMPAIGN_PLAN_TEST=PASS");
