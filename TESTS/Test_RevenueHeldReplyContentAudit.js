"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueHeldReplyContentAuditService");
const { AUTHORIZATION, SOURCE_FINGERPRINT } = require("../SERVICES/revenue/RevenueHeldReplyContentAuditService");
const { parseArguments } = require("../SCRIPTS/AuditHeldInstantlyReplyContent");

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log("[PASS] " + name); }

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate23b2-"));
  const sourcePath = path.join(root, "source.json");
  const outputRoot = path.join(root, "out");
  const held = Array.from({ length: 14 }, (_, index) => ({ messageId: "m" + index, email: "lead" + index + "@example.com", subject: "Reply " + index, classification: "MANUAL_REVIEW" }));
  fs.writeFileSync(sourcePath, JSON.stringify({ ok: true, status: "LEGACY_PAUSED_AND_REPLY_TRIAGE_APPLIED", applyFingerprint: SOURCE_FINGERPRINT, summary: { manualReviewHeld: 14 }, dispositions: { manualReview: held } }), "utf8");
  const bodies = [
    "Please unsubscribe me.",
    "No thanks, we are not interested.",
    "I am out of the office until Monday.",
    "Thank you. We received your message and will respond.",
    "How much does this cost? Let's schedule a call.",
    "Please have your team review the attached statement.",
    "Remove me from your list.",
    "We already have a provider and do not need this.",
    "Vacation responder: returning next week.",
    "This is an automated reply. Do not reply.",
    "I am interested. Please send details.",
    "Can you clarify the NAICS reference?",
    "Not a fit for us.",
    "We may revisit this later."
  ];
  const reads = [];
  const service = new Service({
    rootDir: root,
    sourcePath,
    outputRoot,
    requestDelayMs: 0,
    emailProvider: async messageId => { reads.push(messageId); const index = Number(messageId.slice(1)); return { data: { id: messageId, payload: { html_body: "<p>" + bodies[index] + "</p>" } } }; },
    generatedAt: () => "2026-08-08T00:00:00.000Z"
  });

  await test("service is constructable", () => assert.ok(service));
  await test("default mode is plan-only", async () => assert.strictEqual((await service.audit({})).mode, "PLAN_ONLY"));
  await test("plan performs no provider reads", async () => { reads.length = 0; await service.audit({}); assert.strictEqual(reads.length, 0); });
  await test("plan authorizes no writes", async () => assert.strictEqual((await service.audit({})).providerWritesAuthorized, false));
  await test("apply requires live flag", () => assert.rejects(() => service.audit({ apply: true, authorization: AUTHORIZATION }), /--live/));
  await test("wrong authorization fails closed", () => assert.rejects(() => service.audit({ apply: true, live: true, authorization: "WRONG" }), /Exact Gate 23B2/));
  reads.length = 0;
  const report = await service.audit({ apply: true, live: true, authorization: AUTHORIZATION });
  await test("audit completes", () => assert.strictEqual(report.status, "HELD_REPLY_CONTENT_AUDITED"));
  await test("exactly fourteen messages are read", () => assert.strictEqual(reads.length, 14));
  await test("each held identity is read once", () => assert.strictEqual(new Set(reads).size, 14));
  await test("unsubscribe is classified", () => assert.strictEqual(report.summary.counts.UNSUBSCRIBE, 2));
  await test("negative is classified", () => assert.strictEqual(report.summary.counts.NEGATIVE, 3));
  await test("out of office is classified", () => assert.strictEqual(report.summary.counts.OUT_OF_OFFICE, 2));
  await test("automated acknowledgement is classified", () => assert.strictEqual(report.summary.counts.AUTO_ACKNOWLEDGEMENT, 2));
  await test("positive is classified", () => assert.strictEqual(report.summary.counts.POSITIVE_REVIEW, 2));
  await test("manual review is preserved", () => assert.strictEqual(report.summary.counts.MANUAL_REVIEW, 3));
  await test("conservation passes", () => assert.strictEqual(report.conservation.ok, true));
  await test("HTML markup is removed", () => assert.ok(report.items.every(item => !/[<>]/.test(item.excerpt))));
  await test("excerpts are bounded", () => assert.ok(report.items.every(item => item.excerpt.length <= 300)));
  await test("body hashes are recorded", () => assert.ok(report.items.every(item => /^[A-F0-9]{64}$/.test(item.bodySha256))));
  await test("full body is not persisted", () => assert.ok(report.items.every(item => !("body" in item))));
  await test("source fingerprint is bound", () => assert.strictEqual(report.sourceApplyFingerprint, SOURCE_FINGERPRINT));
  await test("provider reads are explicit", () => assert.strictEqual(report.providerReadsPerformed, true));
  await test("provider writes remain unauthorized", () => assert.strictEqual(report.providerWritesAuthorized, false));
  await test("mailbox writes remain unauthorized", () => assert.strictEqual(report.mailboxWritesAuthorized, false));
  await test("no lead status changes occur", () => assert.strictEqual(report.leadsUpdated, 0));
  await test("no replies send", () => assert.strictEqual(report.repliesSent, false));
  await test("no emails send", () => assert.strictEqual(report.emailsSent, false));
  await test("no campaigns change", () => assert.strictEqual(report.campaignsChanged, false));
  await test("no campaigns launch", () => assert.strictEqual(report.campaignsLaunched, false));
  await test("manifest exists", () => assert.ok(fs.existsSync(service.outputPath)));
  await test("audit fingerprint is recorded", () => assert.match(report.auditFingerprint, /^[A-F0-9]{64}$/));
  await test("CLI defaults safely", () => assert.deepStrictEqual(parseArguments([]), { apply: false, live: false, authorization: null }));
  await test("CLI parses exact authorization", () => assert.deepStrictEqual(parseArguments(["--apply", "--live", "--authorization=" + AUTHORIZATION]), { apply: true, live: true, authorization: AUTHORIZATION }));
  const changedPath = path.join(root, "changed.json");
  fs.writeFileSync(changedPath, JSON.stringify({ ok: true, status: "LEGACY_PAUSED_AND_REPLY_TRIAGE_APPLIED", applyFingerprint: "A".repeat(64), summary: { manualReviewHeld: 14 }, dispositions: { manualReview: held } }), "utf8");
  await test("changed Gate 23B evidence fails closed", () => assert.rejects(() => new Service({ rootDir: root, sourcePath: changedPath, outputRoot: path.join(root, "changed-out"), requestDelayMs: 0, emailProvider: async () => ({}) }).audit({ apply: true, live: true, authorization: AUTHORIZATION }), /fingerprint changed/));
  await test("provider identity mismatch fails closed", () => assert.rejects(() => new Service({ rootDir: root, sourcePath, outputRoot: path.join(root, "mismatch-out"), requestDelayMs: 0, emailProvider: async () => ({ id: "wrong", body: "hello" }) }).audit({ apply: true, live: true, authorization: AUTHORIZATION }), /identity mismatch/));
  await test("missing provider body fails closed", () => assert.rejects(() => new Service({ rootDir: root, sourcePath, outputRoot: path.join(root, "empty-out"), requestDelayMs: 0, emailProvider: async messageId => ({ id: messageId }) }).audit({ apply: true, live: true, authorization: AUTHORIZATION }), /body is missing/));

  console.log("REVENUE_HELD_REPLY_CONTENT_AUDIT_TEST_PASS " + passed + "/36");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
