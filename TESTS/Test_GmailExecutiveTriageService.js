"use strict";

const assert = require("assert");
const GmailExecutiveTriageService = require("../SERVICES/revenue/GmailExecutiveTriageService");

function b64url(text) {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function message(id, from, subject, body) {
  return {
    id,
    threadId: `t-${id}`,
    internalDate: String(Date.now()),
    snippet: body.slice(0, 80),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: from },
        { name: "To", value: "sender@example.com" },
        { name: "Subject", value: subject }
      ],
      body: { data: b64url(body) }
    }
  };
}

function fakeDependencies({ legacyForwarding = false, sendFailure = false } = {}) {
  const source = [
    message("spam", "pitch@example.com", "Grow your business", "We provide SEO services to help with your marketing and grow your business."),
    message("ooo", "prospect@example.com", "Automatic reply", "I am out of the office until Monday."),
    message("positive", "buyer@example.com", "Re: GSA growth", "Yes, I am interested. Let's talk this week."),
    message("question", "owner@example.com", "Re: government contracts", "Can you send me more information?")
  ];
  const sends = [];
  const modifies = [];
  const labels = [];
  const authCalls = [];
  const gmail = {
    users: {
      settings: {
        getAutoForwarding: async () => ({ data: { enabled: legacyForwarding, emailAddress: legacyForwarding ? "kevin@pathways2gc.com" : null } })
      },
      messages: {
        list: async () => ({ data: { messages: source.map(item => ({ id: item.id })) } }),
        get: async ({ id }) => ({ data: source.find(item => item.id === id) }),
        send: async request => {
          if (sendFailure) throw new Error("simulated send failure");
          sends.push(request);
          return { data: { id: `sent-${sends.length}` } };
        },
        modify: async request => {
          modifies.push(request);
          return { data: { id: request.id } };
        }
      },
      labels: {
        list: async () => ({ data: { labels: labels.map(item => ({ id: item.id, name: item.name })) } }),
        create: async ({ requestBody }) => {
          const item = { id: `label-${labels.length + 1}`, name: requestBody.name };
          labels.push(item);
          return { data: item };
        }
      }
    }
  };
  const accountManager = {
    listAccounts: () => [
      { accountKey: "sender_at_example.com", email: "sender@example.com", valid: true },
      { accountKey: "personal_at_gmail.com", email: "personal@gmail.com", valid: true }
    ],
    getAuthClientForAccount: async accountKey => {
      authCalls.push(accountKey);
      return { fake: true, accountKey };
    }
  };
  const google = { gmail: () => gmail };
  return { accountManager, google, sends, modifies, authCalls, businessDomains: ["example.com"] };
}

function serviceFor(deps) {
  return new GmailExecutiveTriageService({
    accountManager: deps.accountManager,
    google: deps.google,
    businessDomains: deps.businessDomains
  });
}

async function run() {
  const oldMutations = process.env.MILES_GOOGLE_INBOX_MUTATIONS;
  const oldForward = process.env.MILES_GOOGLE_EXECUTIVE_FORWARD_ENABLED;
  try {
    delete process.env.MILES_GOOGLE_INBOX_MUTATIONS;
    delete process.env.MILES_GOOGLE_EXECUTIVE_FORWARD_ENABLED;

    const legacy = fakeDependencies({ legacyForwarding: true });
    const legacyResult = await serviceFor(legacy).run({ execute: false });
    assert.strictEqual(legacyResult.ok, false);
    assert.strictEqual(legacyResult.blockers[0].blocker, "LEGACY_GMAIL_AUTO_FORWARDING_ENABLED");
    assert.strictEqual(legacy.sends.length, 0);
    assert.strictEqual(legacy.modifies.length, 0);
    assert.deepStrictEqual(legacy.authCalls, ["sender_at_example.com"], "personal account must not even be authenticated/read by business triage");

    const plan = fakeDependencies({ legacyForwarding: false });
    const planResult = await serviceFor(plan).run({ execute: false });
    assert.strictEqual(planResult.ok, true);
    assert.strictEqual(planResult.eligibleBusinessAccounts, 1);
    assert.strictEqual(planResult.skippedOutOfBusinessScope, 1);
    assert.strictEqual(planResult.accounts[0].scope, "BUSINESS_TRIAGE");
    assert.strictEqual(planResult.accounts[0].messagesInspected, 4);
    assert.strictEqual(planResult.accounts[0].surfaced, 2);
    assert.strictEqual(planResult.accounts[0].autonomousResolved, 2);
    assert.strictEqual(planResult.accounts[1].scope, "OUT_OF_BUSINESS_SCOPE");
    assert.strictEqual(planResult.accounts[1].skipped, true);
    assert.strictEqual(planResult.accounts[1].messagesInspected, 0);
    assert.deepStrictEqual(plan.authCalls, ["sender_at_example.com"]);
    assert.strictEqual(plan.sends.length, 0);
    assert.strictEqual(plan.modifies.length, 0);

    const gated = fakeDependencies({ legacyForwarding: false });
    const gatedResult = await serviceFor(gated).run({ execute: true });
    assert.strictEqual(gatedResult.ok, false);
    assert.strictEqual(gatedResult.blockers[0].blocker, "GMAIL_EXECUTIVE_TRIAGE_WRITE_GATES_DISABLED");
    assert.deepStrictEqual(gated.authCalls, ["sender_at_example.com"]);
    assert.strictEqual(gated.sends.length, 0);
    assert.strictEqual(gated.modifies.length, 0);

    process.env.MILES_GOOGLE_INBOX_MUTATIONS = "true";
    process.env.MILES_GOOGLE_EXECUTIVE_FORWARD_ENABLED = "true";
    const live = fakeDependencies({ legacyForwarding: false });
    const liveResult = await serviceFor(live).run({ execute: true });
    assert.strictEqual(liveResult.ok, true);
    assert.strictEqual(liveResult.accounts[0].forwarded, 2);
    assert.strictEqual(liveResult.accounts[0].archived, 4);
    assert.strictEqual(liveResult.accounts[1].forwarded, 0);
    assert.strictEqual(liveResult.accounts[1].archived, 0);
    assert.deepStrictEqual(live.authCalls, ["sender_at_example.com"]);
    assert.strictEqual(live.sends.length, 2);
    assert.strictEqual(live.modifies.length, 4);
    assert(live.modifies.every(item => item.requestBody.removeLabelIds.includes("INBOX")));

    const failed = fakeDependencies({ legacyForwarding: false, sendFailure: true });
    const failedResult = await serviceFor(failed).run({ execute: true });
    assert.strictEqual(failedResult.ok, false);
    assert.deepStrictEqual(failed.authCalls, ["sender_at_example.com"]);
    assert.strictEqual(failed.modifies.some(item => item.id === "positive"), false, "must not archive a surfaced message when executive forwarding fails");
    assert.strictEqual(failed.modifies.some(item => item.id === "question"), false, "must not archive a surfaced message when executive forwarding fails");

    console.log("GMAIL_EXECUTIVE_TRIAGE_TEST=GREEN");
    console.log("PERSONAL_GMAIL_BUSINESS_SCOPE_ISOLATION=GREEN");
  } finally {
    if (oldMutations === undefined) delete process.env.MILES_GOOGLE_INBOX_MUTATIONS;
    else process.env.MILES_GOOGLE_INBOX_MUTATIONS = oldMutations;
    if (oldForward === undefined) delete process.env.MILES_GOOGLE_EXECUTIVE_FORWARD_ENABLED;
    else process.env.MILES_GOOGLE_EXECUTIVE_FORWARD_ENABLED = oldForward;
  }
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
