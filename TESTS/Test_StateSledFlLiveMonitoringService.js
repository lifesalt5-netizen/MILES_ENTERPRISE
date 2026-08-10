"use strict";

const assert = require("assert");
const s = require("../SERVICES/StateSledFlLiveMonitoringService");

const metrics = s.deriveMetrics(
  { sent: 100, replies: 4, positive_replies: 2, bounced: 1 },
  new Array(73).fill({})
);

assert.strictEqual(metrics.sent, 100);
assert.strictEqual(metrics.replies, 4);
assert.strictEqual(metrics.positiveReplies, 2);
assert.strictEqual(metrics.bounced, 1);
assert.strictEqual(metrics.leadCountObserved, 73);
assert.strictEqual(metrics.replyRate, 0.04);
assert.strictEqual(metrics.bounceRate, 0.01);

console.log("STATE_SLED_FL_LIVE_MONITORING_TEST=PASS");
