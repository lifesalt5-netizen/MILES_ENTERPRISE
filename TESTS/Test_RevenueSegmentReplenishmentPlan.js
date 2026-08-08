"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueSegmentReplenishmentPlanService");
const { parseArguments } = require("../SCRIPTS/PlanRevenueSegmentReplenishment");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-replenishment-"));
  const auditPath = path.join(root, "audit.json");
  const deferredPath = path.join(root, "deferred.jsonl");
  const outputRoot = path.join(root, "output");
  const names = ["Expiring GSA 12 Months", "Expiring VA 12 Months", "GSA", "VA", "8(a)", "HUBZone", "SDVOSB", "VOSB", "WOSB", "SBS"];
  const counts = [4659, 28, 714, 108, 45, 83, 1766, 336, 643, 194];
  const routes = names.map((route, index) => ({ route, candidates: counts[index], alreadyPresentGlobally: Math.min(counts[index], 10), uploadDelta: counts[index] - Math.min(counts[index], 10) }));
  fs.writeFileSync(auditPath, JSON.stringify({
    ok: true, status: "GLOBAL_DUPLICATE_AUDIT_COMPLETED", auditFingerprint: "A".repeat(64),
    summary: { classifiedCandidates: 8576, unclassifiedHeld: 2 }, conservation: { ok: true }, routes
  }), "utf8");
  const deferred = [];
  for (let index = 0; index < 100; index += 1) deferred.push({ email: "pending-" + index + "@example.com", primaryRoute: names[index % names.length] });
  fs.writeFileSync(deferredPath, deferred.map(JSON.stringify).join("\n") + "\n", "utf8");

  const service = new Service({
    rootDir: root, auditPath, deferredPath, outputRoot, outputPath: path.join(outputRoot, "plan.json"),
    generatedAt: () => "2026-08-08T00:00:00.000Z",
    planner: { route: record => ({ name: record.primaryRoute }) }
  });

  await test("service is constructable", async () => assert.ok(service));
  const provenanceProbe = new Service({
    rootDir: root,
    planner: { route: record => ({ name: record.segments.join(" | ").includes("GSA_NO_SALES") ? "GSA" : "Unclassified" }) }
  });
  await test("source provenance recovers a missing route label", async () => assert.strictEqual(
    provenanceProbe.route({ email: "source@example.com", segments: ["MASTER"], sources: ["C:\\archive\\GSA_NO_SALES.csv"] }),
    "GSA"
  ));
  const preview = service.build({});
  await test("default mode is plan-only", async () => assert.strictEqual(preview.mode, "PLAN_ONLY"));
  await test("default target is 5000", async () => assert.strictEqual(preview.targetPerSegment, 5000));
  await test("preview performs no writes", async () => assert.strictEqual(fs.existsSync(outputRoot), false));
  await test("preview authorizes no source reads", async () => assert.strictEqual(preview.sourceReadsAuthorized, false));
  await test("zero target fails closed", async () => assert.throws(() => service.build({ apply: true, target: 0 }), /positive integer/));
  await test("fractional target fails closed", async () => assert.throws(() => service.build({ apply: true, target: 1.5 }), /positive integer/));

  const report = service.build({ apply: true, target: 5000 });
  await test("plan completes", async () => assert.strictEqual(report.status, "SEGMENT_REPLENISHMENT_PLANNED"));
  await test("ten configured routes are planned", async () => assert.strictEqual(report.summary.routes, 10));
  await test("aggregate target is 50000", async () => assert.strictEqual(report.summary.aggregateTarget, 50000));
  await test("verified total is conserved", async () => assert.strictEqual(report.summary.verified, 8576));
  await test("deferred verification total is conserved", async () => assert.strictEqual(report.summary.pendingVerification, 100));
  await test("outside-route pending total is bound correctly", async () => assert.strictEqual(report.summary.deferredOutsideConfiguredRoutes, 0));
  await test("pending route counts are exposed", async () => assert.strictEqual(Object.values(report.summary.pendingRouteCounts).reduce((sum, count) => sum + count, 0), 100));
  await test("outside configured route breakdown is exposed", async () => assert.deepStrictEqual(report.summary.outsideConfiguredRouteCounts, {}));
  await test("each route receives its own target", async () => assert.ok(report.routes.every(route => route.target === 5000)));
  await test("verified gaps never go negative", async () => assert.ok(report.routes.every(route => route.verifiedGap >= 0)));
  await test("best case includes pending verification", async () => assert.ok(report.routes.every(route => route.bestCaseAfterPending === route.verified + route.pendingVerification)));
  await test("net-new source need is calculated", async () => assert.ok(report.routes.every(route => route.netNewSourceNeededAtBestCase === Math.max(0, 5000 - route.bestCaseAfterPending))));
  await test("one primary route policy is locked", async () => assert.strictEqual(report.targetPolicy.onePrimaryRoutePerEmail, true));
  await test("global exclusion policy includes Instantly", async () => assert.ok(report.globalExclusionPolicy.includes("ALL_INSTANTLY_CAMPAIGN_EMAILS")));
  await test("incremental pulls are preferred", async () => assert.ok(report.acquisitionSequence.includes("PULL_INCREMENTAL_WHEN_SUPPORTED")));
  await test("snapshot fallback is allowed", async () => assert.strictEqual(report.targetPolicy.fullSnapshotAllowedWhenIncrementalSourceUnavailable, true));
  await test("source-limited segments may remain below target", async () => assert.strictEqual(report.targetPolicy.sourceLimitedSegmentsMayRemainBelowTarget, true));
  await test("no source action is authorized", async () => assert.strictEqual(report.sourceReadsAuthorized, false));
  await test("no verification credits are used", async () => assert.strictEqual(report.verificationCreditsUsed, 0));
  await test("no provider writes occur", async () => assert.strictEqual(report.providerWritesAuthorized, false));
  await test("no leads upload", async () => assert.strictEqual(report.leadsUploaded, 0));
  await test("no campaigns launch", async () => assert.strictEqual(report.campaignsLaunched, false));
  await test("plan artifact exists", async () => assert.strictEqual(fs.existsSync(report.artifact.filePath), true));
  await test("artifact hash is recorded", async () => assert.match(report.artifact.sha256, /^[A-F0-9]{64}$/));
  await test("fingerprint is recorded", async () => assert.match(report.replenishmentFingerprint, /^[A-F0-9]{64}$/));
  await test("CLI defaults safely", async () => assert.deepStrictEqual(parseArguments([]), { apply: false, target: 5000 }));
  await test("CLI parses explicit target", async () => assert.deepStrictEqual(parseArguments(["--apply", "--target=6000"]), { apply: true, target: 6000 }));

  console.log("REVENUE_SEGMENT_REPLENISHMENT_PLAN_TEST_PASS " + passed + "/35");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
