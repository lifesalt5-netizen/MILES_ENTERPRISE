"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueVerifiedReplyDispositionApplyService");
const { AUTHORIZATION, SOURCE_FINGERPRINT, SUPPRESSIONS } = require("../SERVICES/revenue/RevenueVerifiedReplyDispositionApplyService");
const { parseArguments } = require("../SCRIPTS/ApplyVerifiedInstantlyReplyDispositions");

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log("[PASS] " + name); }

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate23b3-"));
  const sourcePath = path.join(root, "source.json");
  const outputRoot = path.join(root, "out");
  const items = [
    { email: "tom@aspen-technology.com", classification: "UNSUBSCRIBE" },
    { email: "swentz@acilconsulting.com", classification: "NEGATIVE" },
    { email: "ldawson@family1stbio.com", classification: "NEGATIVE" },
    { email: "sherrie@jadaprints.com", classification: "UNSUBSCRIBE" },
    { email: "ceo@panzertek.com", classification: "MANUAL_REVIEW" },
    { email: "bryan@quadvideohalo.com", classification: "MANUAL_REVIEW" },
    { email: "bryan@quadvideohalo.com", classification: "MANUAL_REVIEW" },
    { email: "karl@dumbomoving.com", classification: "OUT_OF_OFFICE" },
    { email: "jeremy@p1comms.com", classification: "OUT_OF_OFFICE" },
    { email: "jamita.machen@theswvault.com", classification: "OUT_OF_OFFICE" },
    { email: "sbhservices@gci.net", classification: "MANUAL_REVIEW" },
    { email: "hollywood@gci.net", classification: "MANUAL_REVIEW" },
    { email: "bgservices@boogphotobooth.com", classification: "AUTO_ACKNOWLEDGEMENT" },
    { email: "nick@licraftsmanship.com", classification: "MANUAL_REVIEW" }
  ];
  fs.writeFileSync(sourcePath, JSON.stringify({ ok: true, status: "HELD_REPLY_CONTENT_AUDITED", auditFingerprint: SOURCE_FINGERPRINT, summary: { heldReplies: 14 }, conservation: { ok: true }, items }), "utf8");
  const blocks = [];
  const updates = [];
  const service = new Service({
    rootDir: root,
    sourcePath,
    outputRoot,
    blockProvider: async email => { blocks.push(email); return { id: "b" + blocks.length, bl_value: email, is_domain: false }; },
    interestProvider: async payload => { updates.push(payload); return { message: "submitted" }; },
    generatedAt: () => "2026-08-08T00:00:00.000Z"
  });

  await test("service is constructable", () => assert.ok(service));
  await test("default mode is plan-only", async () => assert.strictEqual((await service.apply({})).mode, "PLAN_ONLY"));
  await test("plan performs no provider writes", async () => { await service.apply({}); assert.strictEqual(blocks.length + updates.length, 0); });
  await test("apply requires live flag", () => assert.rejects(() => service.apply({ apply: true, authorization: AUTHORIZATION }), /--live/));
  await test("wrong authorization fails closed", () => assert.rejects(() => service.apply({ apply: true, live: true, authorization: "WRONG" }), /Exact Gate 23B3/));
  const report = await service.apply({ apply: true, live: true, authorization: AUTHORIZATION });
  await test("apply completes", () => assert.strictEqual(report.status, "VERIFIED_REPLY_DISPOSITIONS_APPLIED"));
  await test("exactly four addresses are blocked", () => assert.strictEqual(blocks.length, 4));
  await test("only reviewed addresses are blocked", () => assert.deepStrictEqual(blocks, SUPPRESSIONS.map(item => item.email)));
  await test("domains are never blocked", () => assert.ok(blocks.every(email => email.includes("@"))));
  await test("one conditional opportunity is updated", () => assert.strictEqual(updates.length, 1));
  await test("Panzertek is the interested lead", () => assert.strictEqual(updates[0].lead_email, "ceo@panzertek.com"));
  await test("interested value is one", () => assert.strictEqual(updates[0].interest_value, 1));
  await test("auto interest is disabled", () => assert.strictEqual(updates[0].disable_auto_interest, true));
  await test("Bryan is deduplicated to one nurture contact", () => assert.strictEqual(report.summary.nurtureContacts, 1));
  await test("two Bryan replies are conserved", () => assert.strictEqual(report.summary.duplicateNurtureRepliesCollapsed, 2));
  await test("three future follow-ups are held", () => assert.strictEqual(report.summary.futureFollowUpHeld, 3));
  await test("two replacements require verification", () => assert.strictEqual(report.summary.replacementEmailsQueuedForVerification, 2));
  await test("replacement addresses are not outreach authorized", () => assert.ok(JSON.parse(fs.readFileSync(report.artifacts.replacementVerification.filePath, "utf8")).every(item => item.outreachAuthorized === false)));
  await test("two non-opportunities are held", () => assert.strictEqual(report.summary.nonOpportunitiesHeld, 2));
  await test("conservation passes", () => assert.strictEqual(report.conservation.ok, true));
  await test("provider scope is constrained", () => assert.strictEqual(report.providerWriteScope, "BLOCK_4_EXACT_EMAILS_AND_MARK_1_CONDITIONAL_INTERESTED"));
  await test("mailbox writes remain unauthorized", () => assert.strictEqual(report.mailboxWritesAuthorized, false));
  await test("no leads upload", () => assert.strictEqual(report.leadsUploaded, 0));
  await test("no emails send", () => assert.strictEqual(report.emailsSent, false));
  await test("no replies send", () => assert.strictEqual(report.repliesSent, false));
  await test("no campaigns change", () => assert.strictEqual(report.campaignsChanged, false));
  await test("no campaigns launch", () => assert.strictEqual(report.campaignsLaunched, false));
  await test("progress records five provider writes", () => assert.strictEqual(fs.readFileSync(service.progressPath, "utf8").trim().split(/\r?\n/).length, 5));
  await test("all internal queue artifacts exist", () => assert.ok(Object.values(report.artifacts).every(item => fs.existsSync(item.filePath))));
  await test("manifest exists", () => assert.ok(fs.existsSync(service.outputPath)));
  await test("apply fingerprint is recorded", () => assert.match(report.applyFingerprint, /^[A-F0-9]{64}$/));
  const second = await service.apply({ apply: true, live: true, authorization: AUTHORIZATION });
  await test("rerun is idempotent", () => assert.strictEqual(second.summary.blocksCreatedThisRun + second.summary.interestedUpdatedThisRun, 0));
  await test("rerun creates no provider calls", () => assert.strictEqual(blocks.length + updates.length, 5));
  await test("CLI defaults safely", () => assert.deepStrictEqual(parseArguments([]), { apply: false, live: false, authorization: null }));
  await test("CLI parses exact authorization", () => assert.deepStrictEqual(parseArguments(["--apply", "--live", "--authorization=" + AUTHORIZATION]), { apply: true, live: true, authorization: AUTHORIZATION }));
  const changedPath = path.join(root, "changed.json");
  fs.writeFileSync(changedPath, JSON.stringify({ ok: true, status: "HELD_REPLY_CONTENT_AUDITED", auditFingerprint: "A".repeat(64), summary: { heldReplies: 14 }, conservation: { ok: true }, items }), "utf8");
  await test("changed source fingerprint fails closed", () => assert.rejects(() => new Service({ rootDir: root, sourcePath: changedPath, outputRoot: path.join(root, "changed-out"), blockProvider: async () => ({}), interestProvider: async () => ({}) }).apply({ apply: true, live: true, authorization: AUTHORIZATION }), /fingerprint changed/));
  const dryRunRoot = path.join(root, "dry-run");
  await test("dry-run block response fails closed", () => assert.rejects(() => new Service({ rootDir: root, sourcePath, outputRoot: dryRunRoot, blockProvider: async () => ({ dryRun: true }), interestProvider: async () => ({}) }).apply({ apply: true, live: true, authorization: AUTHORIZATION }), /dry-run/));

  console.log("REVENUE_VERIFIED_REPLY_DISPOSITION_APPLY_TEST_PASS " + passed + "/37");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
