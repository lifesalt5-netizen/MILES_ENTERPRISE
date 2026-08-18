"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const GlobalSuppressionService = require("../SERVICES/revenue/GlobalSuppressionService");
const CampaignSuppressionOverlayService = require("../SERVICES/revenue/CampaignSuppressionOverlayService");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-campaign-suppression-"));
const suppression = new GlobalSuppressionService({ rootDir: root });
suppression.upsert({ email: "stop@example.com", reason: "UNSUBSCRIBE", evidence: "remove me" });
suppression.upsert({ email: "bad@example.com", reason: "BOUNCE_TECHNICAL", evidence: "undeliverable" });

const overlay = new CampaignSuppressionOverlayService({ rootDir: root, suppression });
const result = overlay.filter([
  { email: "good@example.com", company: "Good Co" },
  { email: "stop@example.com", company: "Stop Co" },
  { email: "bad@example.com", company: "Bad Co", blockers: ["EXISTING_BLOCKER"] }
]);

assert.strictEqual(result.total, 3);
assert.strictEqual(result.kept.length, 1);
assert.strictEqual(result.kept[0].email, "good@example.com");
assert.strictEqual(result.blocked.length, 2);
assert.strictEqual(result.suppressedCount, 2);
assert(result.blocked.find(row => row.email === "stop@example.com").blockers.includes("GLOBAL_SUPPRESSION:UNSUBSCRIBE"));
const bounced = result.blocked.find(row => row.email === "bad@example.com");
assert(bounced.blockers.includes("EXISTING_BLOCKER"));
assert(bounced.blockers.includes("GLOBAL_SUPPRESSION:BOUNCE_TECHNICAL"));

const winbackRunner = fs.readFileSync(path.join(__dirname, "..", "RUN_P2GC_WINBACK_CAMPAIGN.js"), "utf8");
const captureRunner = fs.readFileSync(path.join(__dirname, "..", "RUN_CAPTURE_CAPACITY_CAMPAIGN.js"), "utf8");
const safeAudit = fs.readFileSync(path.join(__dirname, "..", "SCRIPTS", "RUN_P2GC_SAFE_REVENUE_AUDIT.ps1"), "utf8");
assert(winbackRunner.includes("CampaignSuppressionOverlayService"));
assert(captureRunner.includes("CampaignSuppressionOverlayService"));
assert(winbackRunner.includes("globalSuppressionBlockedCount"));
assert(captureRunner.includes("globalSuppression"));

const replyIndex = safeAudit.indexOf('RUN_P2GC_REPLY_INTELLIGENCE.js');
const winbackIndex = safeAudit.indexOf('RUN_P2GC_WINBACK_CAMPAIGN.js');
const captureIndex = safeAudit.indexOf('RUN_CAPTURE_CAPACITY_CAMPAIGN.js');
assert(replyIndex >= 0 && winbackIndex > replyIndex && captureIndex > replyIndex, "reply intelligence must populate suppression before campaign planning");

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS campaign_global_suppression_overlay_test");
