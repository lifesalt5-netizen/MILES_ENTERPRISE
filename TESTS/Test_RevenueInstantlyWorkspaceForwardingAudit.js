"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueInstantlyWorkspaceForwardingAuditService");
const { AUTHORIZATION } = require("../SERVICES/revenue/RevenueInstantlyWorkspaceForwardingAuditService");
const { parseArguments } = require("../SCRIPTS/AuditInstantlyWorkspaceForwarding");

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log("[PASS] " + name); }

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate23a-"));
  const readinessPath = path.join(root, "ready.json");
  const outputRoot = path.join(root, "out");
  const governedRoutes = Array.from({ length: 10 }, (_, index) => ({ route: "R" + index, campaignId: "g" + index, ready: true }));
  fs.writeFileSync(readinessPath, JSON.stringify({ ok: true, readyToLaunch: true, readinessFingerprint: "A".repeat(64), summary: { campaignsReady: 10 }, routes: governedRoutes }), "utf8");
  const campaigns = [
    ...governedRoutes.map((route, index) => ({ id: route.campaignId, name: route.route, status: 2, daily_limit: 10, email_list: ["sender" + (index % 9) + "@example.com"] })),
    { id: "legacy", name: "P2GC - HIGH VALUE", status: 1, daily_limit: 25, email_list: ["sender0@example.com"] },
    { id: "draft", name: "Old Draft", status: 0, daily_limit: 0 }
  ];
  const accounts = Array.from({ length: 9 }, (_, index) => ({ email: "sender" + index + "@example.com", status: "active", forward_to: "kevin@pathways2gc.com" }));
  const emails = [
    { id: "e1", direction: "inbound", from: "buyer@example.com", subject: "How much does this cost?", body: "Please send pricing." },
    { id: "e2", direction: "inbound", from: "no@example.com", subject: "No thanks", body: "unsubscribe" },
    { id: "e3", direction: "inbound", from: "ooo@example.com", subject: "Automatic reply", body: "Away from my desk" },
    { id: "e4", from: "sender0@example.com", subject: "Quick question about your GSA contract", body: "Outbound copy without a direction field" }
  ];
  const service = new Service({
    rootDir: root,
    readinessPath,
    outputRoot,
    campaignProvider: async () => ({ items: campaigns }),
    accountProvider: async () => ({ items: accounts }),
    emailProvider: async () => ({ items: emails }),
    forwardingEvidenceProvider: async () => null,
    pageDelayMs: 0,
    generatedAt: () => "2026-08-08T00:00:00.000Z"
  });

  await test("service is constructable", () => assert.ok(service));
  await test("default mode is plan-only", async () => assert.strictEqual((await service.audit({})).mode, "PLAN_ONLY"));
  await test("plan performs no provider reads", async () => assert.strictEqual((await service.audit({})).providerReadsAuthorized, false));
  await test("plan authorizes no writes", async () => assert.strictEqual((await service.audit({})).providerWritesAuthorized, false));
  await test("apply requires live flag", () => assert.rejects(() => service.audit({ apply: true, authorization: AUTHORIZATION }), /--live/));
  await test("wrong authorization fails closed", () => assert.rejects(() => service.audit({ apply: true, live: true, authorization: "WRONG" }), /Exact Gate 23A/));
  const report = await service.audit({ apply: true, live: true, authorization: AUTHORIZATION });
  await test("audit completes", () => assert.strictEqual(report.status, "FULL_WORKSPACE_AND_FORWARDING_AUDITED"));
  await test("all campaigns are read", () => assert.strictEqual(report.summary.campaignsRead, 12));
  await test("ten governed campaigns are found", () => assert.strictEqual(report.summary.governedCampaignsFound, 10));
  await test("active legacy campaign is detected", () => assert.strictEqual(report.summary.activeLegacyCampaigns, 1));
  await test("active legacy capacity is counted", () => assert.strictEqual(report.summary.activeDailyLimit, 25));
  await test("all accounts are read", () => assert.strictEqual(report.summary.accountsRead, 9));
  await test("visible forwarding is inventoried", () => assert.strictEqual(report.summary.forwardingRulesConfirmed, 9));
  await test("Instantly fields do not prove IONOS rules", () => assert.strictEqual(report.summary.ionosForwardingEvidencePresent, false));
  await test("IONOS evidence gap is explicit", () => assert.ok(report.blockers.includes("IONOS_FORWARDING_EVIDENCE_REQUIRED")));
  await test("blanket forwarding target is detected", () => assert.strictEqual(report.forwardingAudit.blanketForwardingToPrimaryDetected, true));
  await test("positive pricing reply is classified", () => assert.strictEqual(report.replyTriage.counts.POSITIVE_REVIEW, 1));
  await test("unsubscribe is classified", () => assert.strictEqual(report.replyTriage.counts.UNSUBSCRIBE, 1));
  await test("out of office is classified", () => assert.strictEqual(report.replyTriage.counts.OUT_OF_OFFICE, 1));
  await test("own outbound mail without direction is excluded", () => assert.strictEqual(report.summary.inboundMessagesRead, 3));
  await test("capacity apply remains blocked", () => assert.strictEqual(report.safeForGate23CapacityApply, false));
  await test("provider reads are recorded", () => assert.strictEqual(report.providerReadsPerformed, true));
  await test("provider writes remain unauthorized", () => assert.strictEqual(report.providerWritesAuthorized, false));
  await test("mailbox writes remain unauthorized", () => assert.strictEqual(report.mailboxWritesAuthorized, false));
  await test("no replies are sent", () => assert.strictEqual(report.repliesSent, false));
  await test("no emails are sent", () => assert.strictEqual(report.emailsSent, false));
  await test("no campaigns change", () => assert.strictEqual(report.campaignsChanged, false));
  await test("no campaigns launch", () => assert.strictEqual(report.campaignsLaunched, false));
  await test("audit fingerprint is recorded", () => assert.match(report.auditFingerprint, /^[A-F0-9]{64}$/));
  await test("evidence artifact exists", () => assert.ok(fs.existsSync(report.artifact.filePath)));
  await test("CLI defaults safely", () => assert.deepStrictEqual(parseArguments([]), { apply: false, live: false, authorization: null }));
  await test("CLI parses exact authorization", () => assert.deepStrictEqual(parseArguments(["--apply", "--live", "--authorization=" + AUTHORIZATION]), { apply: true, live: true, authorization: AUTHORIZATION }));

  console.log("REVENUE_INSTANTLY_WORKSPACE_FORWARDING_AUDIT_TEST_PASS " + passed + "/32");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
