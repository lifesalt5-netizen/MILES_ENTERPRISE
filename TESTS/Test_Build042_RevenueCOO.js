"use strict";

const assert = require("assert");
const RevenueCOOService = require("../SERVICES/RevenueCOOService");

const service = new RevenueCOOService();
const result = service.analyze({
  business: {
    campaigns: [
      { status: "paused", sent: 1000, bounces: 45 }
    ],
    replies: [
      { classification: "Positive" },
      { subject: "Interested" }
    ],
    mailboxes: [
      { email: "test@example.com", health: "warning" }
    ],
    segments: [
      { name: "GSA No Sales", verifiedRemaining: 0 }
    ]
  }
}, "TEST-CYCLE");

assert.strictEqual(result.ok, true);
assert(result.metrics.bounceRate >= 0.04);
assert(result.missions.length >= 5);
assert(result.missions.every(item => item.requiresKevin === false));

console.log("BUILD042 Revenue COO test PASSED");
console.log(JSON.stringify(result, null, 2));
