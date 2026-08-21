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

  // Regression: a short direct human question on an existing outbound thread is
  // an engaged prospect signal even when the lexical classifier calls it neutral.
  const engaged = policy.apply({
    category: "NEUTRAL_QUESTION",
    qualifiedPositive: false,
    humanReply: true,
    from: "jules@example.com",
    campaignId: "campaign-1",
    leadId: "lead-1",
    threadId: "t-engaged",
    conversationKey: "THREAD:t-engaged",
    preview: "Why?",
    subject: "Re: Quick question"
  });
  assert.strictEqual(engaged.surfaceToExecutiveInbox, true);
  assert.strictEqual(engaged.executiveDisposition, "SURFACE_ENGAGED_QUESTION");
  assert.strictEqual(engaged.engagedQuestion, true);

  const queue = JSON.parse(fs.readFileSync(policy.queuePath, "utf8"));
  assert.strictEqual(queue.length, 5, "qualified positives plus evidence-gated terse engaged questions may enter executive surface queue");
  assert(queue.every(row => row.surfaceToExecutiveInbox === true));
  assert.strictEqual(queue.filter(row => row.category === "NEUTRAL_QUESTION").length, 1);
  assert.strictEqual(queue.find(row => row.category === "NEUTRAL_QUESTION").engagedQuestion, true);

  const latest = JSON.parse(fs.readFileSync(policy.latestPath, "utf8"));
  assert.strictEqual(latest.policy, "QUALIFIED_POSITIVE_PLUS_TERSE_ENGAGED_QUESTIONS");
  assert.strictEqual(latest.rawForwardingAllowed, false);
  assert.strictEqual(latest.nonQualifiedExecutiveInboxAllowed, false);

  fs.rmSync(root, { recursive: true, force: true });
  console.log("PASS executive_reply_surface_policy_test");
})();
