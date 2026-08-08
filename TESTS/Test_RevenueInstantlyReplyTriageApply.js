"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueInstantlyReplyTriageApplyService");
const { AUTHORIZATION, SOURCE_FINGERPRINT, LEGACY_CAMPAIGN_ID } = require("../SERVICES/revenue/RevenueInstantlyReplyTriageApplyService");
const { parseArguments } = require("../SCRIPTS/ApplyInstantlyReplyTriage");

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log("[PASS] " + name); }

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate23b-"));
  const auditPath = path.join(root, "audit.json");
  const outputRoot = path.join(root, "out");
  const replies = [
    ...Array.from({ length: 4 }, (_, index) => ({ messageId: "p" + index, from: "positive" + index + "@example.com", subject: "Pricing", classification: "POSITIVE_REVIEW" })),
    ...Array.from({ length: 14 }, (_, index) => ({ messageId: "m" + index, from: "manual" + index + "@example.com", subject: "Reply", classification: "MANUAL_REVIEW" })),
    ...Array.from({ length: 14 }, (_, index) => ({ messageId: "o" + index, from: "ooo" + index + "@example.com", subject: "Out of office", classification: "OUT_OF_OFFICE" }))
  ];
  fs.writeFileSync(auditPath, JSON.stringify({
    ok: true,
    status: "FULL_WORKSPACE_AND_FORWARDING_AUDITED",
    auditFingerprint: SOURCE_FINGERPRINT,
    summary: { activeLegacyCampaigns: 1 },
    activeLegacyCampaigns: [{ campaignId: LEGACY_CAMPAIGN_ID, dailyLimit: 40 }],
    replyTriage: { items: replies }
  }), "utf8");
  const pauses = [];
  const updates = [];
  const service = new Service({
    rootDir: root,
    auditPath,
    outputRoot,
    pauseProvider: async campaignId => { pauses.push(campaignId); return { action: "pause" }; },
    interestProvider: async payload => { updates.push(payload); return { message: "submitted" }; },
    generatedAt: () => "2026-08-08T00:00:00.000Z"
  });

  await test("service is constructable", () => assert.ok(service));
  await test("default mode is plan-only", async () => assert.strictEqual((await service.apply({})).mode, "PLAN_ONLY"));
  await test("plan performs no provider writes", async () => assert.strictEqual((await service.apply({})).providerWritesAuthorized, false));
  await test("apply requires live flag", () => assert.rejects(() => service.apply({ apply: true, authorization: AUTHORIZATION }), /--live/));
  await test("wrong authorization fails closed", () => assert.rejects(() => service.apply({ apply: true, live: true, authorization: "WRONG" }), /Exact Gate 23B/));
  const report = await service.apply({ apply: true, live: true, authorization: AUTHORIZATION });
  await test("apply completes", () => assert.strictEqual(report.status, "LEGACY_PAUSED_AND_REPLY_TRIAGE_APPLIED"));
  await test("exact legacy campaign is paused", () => assert.deepStrictEqual(pauses, [LEGACY_CAMPAIGN_ID]));
  await test("exactly four positives are updated", () => assert.strictEqual(updates.length, 4));
  await test("positive status value is one", () => assert.ok(updates.every(item => item.interest_value === 1)));
  await test("auto interest is disabled", () => assert.ok(updates.every(item => item.disable_auto_interest === true)));
  await test("four interested dispositions are recorded", () => assert.strictEqual(report.dispositions.interested.length, 4));
  await test("fourteen manual replies remain held", () => assert.strictEqual(report.summary.manualReviewHeld, 14));
  await test("fourteen out of office replies are deferred", () => assert.strictEqual(report.summary.outOfOfficeDeferred, 14));
  await test("reply conservation passes", () => assert.strictEqual(report.conservation.ok, true));
  await test("write scope is constrained", () => assert.match(report.providerWriteScope, /ONE_LEGACY_CAMPAIGN/));
  await test("no negative suppression is invented", () => assert.strictEqual(report.negativeOrUnsubscribeSuppressionApplied, 0));
  await test("mailbox forwarding is unchanged", () => assert.strictEqual(report.mailboxForwardingChanged, false));
  await test("no leads upload", () => assert.strictEqual(report.leadsUploaded, 0));
  await test("no emails send", () => assert.strictEqual(report.emailsSent, false));
  await test("no replies send", () => assert.strictEqual(report.repliesSent, false));
  await test("no campaigns launch", () => assert.strictEqual(report.campaignsLaunched, false));
  await test("progress evidence exists", () => assert.ok(fs.existsSync(service.progressPath)));
  await test("progress records five actions", () => assert.strictEqual(fs.readFileSync(service.progressPath, "utf8").trim().split(/\r?\n/).length, 5));
  await test("manifest exists", () => assert.ok(fs.existsSync(service.outputPath)));
  await test("apply fingerprint is recorded", () => assert.match(report.applyFingerprint, /^[A-F0-9]{64}$/));
  const second = await service.apply({ apply: true, live: true, authorization: AUTHORIZATION });
  await test("rerun is idempotent", () => assert.strictEqual(second.summary.positivesUpdatedThisRun, 0));
  await test("rerun creates no extra pause", () => assert.strictEqual(pauses.length, 1));
  await test("rerun creates no extra interest updates", () => assert.strictEqual(updates.length, 4));
  await test("CLI defaults safely", () => assert.deepStrictEqual(parseArguments([]), { apply: false, live: false, authorization: null }));
  await test("CLI parses authorization", () => assert.deepStrictEqual(parseArguments(["--apply", "--live", "--authorization=" + AUTHORIZATION]), { apply: true, live: true, authorization: AUTHORIZATION }));

  console.log("REVENUE_INSTANTLY_REPLY_TRIAGE_APPLY_TEST_PASS " + passed + "/30");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
