"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const AUTHORIZATION = "AUTHORIZE_GATE_23B_PAUSE_LEGACY_AND_APPLY_REPLY_TRIAGE_NO_SEND_NO_LAUNCH";
const SOURCE_FINGERPRINT = "562BE750E34FA59304A6E64C9A0CF12E4FBD4E7AD9DF4A9A63366C5ADA8BB48D";
const LEGACY_CAMPAIGN_ID = "3b178b26-4449-4217-9369-946ad9542ac2";

function text(value) { return String(value || "").trim(); }
function lower(value) { return text(value).toLowerCase(); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }

class RevenueInstantlyReplyTriageApplyService {
  constructor(options = {}) {
    this.service = "REVENUE_INSTANTLY_REPLY_TRIAGE_APPLY";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.auditPath = options.auditPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "instantly_workspace_forwarding_audit", "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "instantly_reply_triage_apply");
    this.progressPath = options.progressPath || path.join(this.outputRoot, "progress.jsonl");
    this.outputPath = options.outputPath || path.join(this.outputRoot, "manifest.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    const connector = options.connector || ((options.pauseProvider && options.interestProvider)
      ? null
      : require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js")));
    this.pauseProvider = options.pauseProvider || (campaignId => connector.pauseCampaign(campaignId, "Gate 23B governed legacy capacity remediation"));
    this.interestProvider = options.interestProvider || (payload => connector.request("/leads/update-interest-status", { method: "POST", body: payload }));
  }

  plan() {
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      authorizationRequired: AUTHORIZATION,
      legacyCampaignToPause: LEGACY_CAMPAIGN_ID,
      providerWritesAuthorized: false,
      emailsSent: false,
      repliesSent: false,
      campaignsLaunched: false
    };
  }

  loadAudit() {
    if (!fs.existsSync(this.auditPath)) throw new Error("Gate 23A audit evidence is missing.");
    const audit = JSON.parse(fs.readFileSync(this.auditPath, "utf8").replace(/^\uFEFF/, ""));
    if (audit.ok !== true || audit.status !== "FULL_WORKSPACE_AND_FORWARDING_AUDITED") throw new Error("Gate 23A audit evidence is unhealthy.");
    if (audit.auditFingerprint !== SOURCE_FINGERPRINT) throw new Error("Gate 23A audit fingerprint changed.");
    if (Number(audit.summary?.activeLegacyCampaigns) !== 1) throw new Error("Exactly one active legacy campaign is required.");
    const legacy = (audit.activeLegacyCampaigns || [])[0];
    if (text(legacy?.campaignId) !== LEGACY_CAMPAIGN_ID || Number(legacy?.dailyLimit) !== 40) throw new Error("Authorized legacy campaign evidence changed.");
    return audit;
  }

  dispositions(audit) {
    const items = Array.isArray(audit.replyTriage?.items) ? audit.replyTriage.items : [];
    const unique = new Set();
    const normalized = items.map(item => ({
      messageId: text(item.messageId),
      email: lower(item.from),
      subject: text(item.subject),
      classification: text(item.classification)
    })).filter(item => item.messageId && item.email);
    for (const item of normalized) {
      if (unique.has(item.messageId)) throw new Error("Duplicate reply evidence detected.");
      unique.add(item.messageId);
    }
    const positive = normalized.filter(item => item.classification === "POSITIVE_REVIEW");
    const manual = normalized.filter(item => item.classification === "MANUAL_REVIEW");
    const outOfOffice = normalized.filter(item => item.classification === "OUT_OF_OFFICE");
    if (positive.length !== 4 || manual.length !== 14 || outOfOffice.length !== 14 || normalized.length !== 32) {
      throw new Error("Gate 23A triage conservation changed.");
    }
    return { positive, manual, outOfOffice };
  }

  loadProgress() {
    if (!fs.existsSync(this.progressPath)) return new Map();
    const records = fs.readFileSync(this.progressPath, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    return new Map(records.map(item => [item.actionId, item]));
  }

  appendProgress(record) {
    fs.mkdirSync(this.outputRoot, { recursive: true });
    fs.appendFileSync(this.progressPath, JSON.stringify(record) + "\n", "utf8");
  }

  async apply(input = {}) {
    if (input.apply !== true) return this.plan();
    if (input.live !== true) throw new Error("Explicit --live authorization is required.");
    if (input.authorization !== AUTHORIZATION) throw new Error("Exact Gate 23B authorization is required.");
    const audit = this.loadAudit();
    const dispositions = this.dispositions(audit);
    const progress = this.loadProgress();
    let pausedThisRun = 0;
    let positivesUpdatedThisRun = 0;

    const pauseActionId = sha256("PAUSE:" + LEGACY_CAMPAIGN_ID + ":" + SOURCE_FINGERPRINT);
    if (!progress.has(pauseActionId)) {
      const response = await this.pauseProvider(LEGACY_CAMPAIGN_ID);
      if (response?.dryRun === true || response?.mutationExecuted === false) throw new Error("Legacy campaign pause returned a dry-run response.");
      const record = { actionId: pauseActionId, action: "PAUSE_LEGACY_CAMPAIGN", campaignId: LEGACY_CAMPAIGN_ID, completedAt: this.generatedAt() };
      this.appendProgress(record); progress.set(pauseActionId, record); pausedThisRun = 1;
    }

    for (const item of dispositions.positive) {
      const actionId = sha256("INTERESTED:" + item.messageId + ":" + item.email + ":" + SOURCE_FINGERPRINT);
      if (progress.has(actionId)) continue;
      const response = await this.interestProvider({ lead_email: item.email, interest_value: 1, disable_auto_interest: true });
      if (response?.dryRun === true || response?.mutationExecuted === false) throw new Error("Lead interest update returned a dry-run response.");
      const record = { actionId, action: "MARK_INTERESTED", messageId: item.messageId, email: item.email, completedAt: this.generatedAt() };
      this.appendProgress(record); progress.set(actionId, record); positivesUpdatedThisRun += 1;
    }

    const report = {
      ok: true,
      service: this.service,
      mode: "APPLY_LIVE_AUTHORIZED",
      status: "LEGACY_PAUSED_AND_REPLY_TRIAGE_APPLIED",
      generatedAt: this.generatedAt(),
      authorization: AUTHORIZATION,
      sourceAuditFingerprint: SOURCE_FINGERPRINT,
      summary: {
        legacyCampaignsPaused: 1,
        positiveLeadsMarkedInterested: dispositions.positive.length,
        manualReviewHeld: dispositions.manual.length,
        outOfOfficeDeferred: dispositions.outOfOffice.length,
        pausedThisRun,
        positivesUpdatedThisRun
      },
      conservation: { ok: dispositions.positive.length + dispositions.manual.length + dispositions.outOfOffice.length === 32, totalReplies: 32 },
      dispositions: {
        interested: dispositions.positive,
        manualReview: dispositions.manual,
        futureFollowUp: dispositions.outOfOffice
      },
      providerWritesAuthorized: true,
      providerWriteScope: "PAUSE_ONE_LEGACY_CAMPAIGN_AND_MARK_FOUR_POSITIVE_LEADS_INTERESTED",
      negativeOrUnsubscribeSuppressionApplied: 0,
      mailboxForwardingChanged: false,
      leadsUploaded: 0,
      emailsSent: false,
      repliesSent: false,
      campaignsChanged: 1,
      campaignsLaunched: false
    };
    const identity = { ...report }; delete identity.generatedAt;
    report.applyFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    fs.mkdirSync(this.outputRoot, { recursive: true });
    fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath: this.outputPath, bytes: fs.statSync(this.outputPath).size, sha256: sha256(fs.readFileSync(this.outputPath)) };
    return report;
  }
}

module.exports = RevenueInstantlyReplyTriageApplyService;
module.exports.AUTHORIZATION = AUTHORIZATION;
module.exports.SOURCE_FINGERPRINT = SOURCE_FINGERPRINT;
module.exports.LEGACY_CAMPAIGN_ID = LEGACY_CAMPAIGN_ID;
