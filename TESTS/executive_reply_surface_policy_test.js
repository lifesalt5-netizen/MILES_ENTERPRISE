"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Policy = require("../SERVICES/revenue/ExecutiveReplySurfacePolicyService");

(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-exec-reply-"));
  const policy = new Policy({ rootDir: root });

  const cases = [
    ["PRICING_QUESTION", true],
    ["MEETING_INTENT", true],
    ["INTERESTED", true],
    ["REFERRAL", true],
    ["OOO", false],
    ["AUTO_REPLY", false],
    ["NOT_NOW", false],
    ["NEGATIVE", false],
    ["UNSUBSCRIBE", false],
    ["BOUNCE_TECHNICAL", false],
    ["INBOUND_SOLICITATION_SPAM", false],
    ["NEUTRAL_QUESTION", false],
    ["UNKNOWN", false]
  ];

  for (let i = 0; i < cases.length; i += 1) {
    const [category, expected] = cases[i];
    const result = policy.apply({
      category,
      qualifiedPositive: expected,
      from: `${category.toLowerCase()}@example.com`,
      threadId: `t-${i}`,
      conversationKey: `THREAD:t-${i}`,
      subject: category
    });
    assert.strictEqual(result.surfaceToExecutiveInbox, expected, `${category} executive surfacing`);
  }

  const queue = JSON.parse(fs.readFileSync(policy.queuePath, "utf8"));
  assert.strictEqual(queue.length, 4, "only qualified positive replies may enter executive surface queue");
  assert(queue.every(row => row.surfaceToExecutiveInbox === true));
  assert(queue.every(row => ["PRICING_QUESTION", "MEETING_INTENT", "INTERESTED", "REFERRAL"].includes(row.category)));

  const latest = JSON.parse(fs.readFileSync(policy.latestPath, "utf8"));
  assert.strictEqual(latest.policy, "QUALIFIED_POSITIVE_ONLY");
  assert.strictEqual(latest.rawForwardingAllowed, false);
  assert.strictEqual(latest.nonQualifiedExecutiveInboxAllowed, false);

  fs.rmSync(root, { recursive: true, force: true });
  console.log("PASS executive_reply_surface_policy_test");
})();
