"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const AUTHORIZATION = "AUTHORIZE_GATE_23B3_APPLY_VERIFIED_REPLY_DISPOSITIONS_NO_SEND_NO_LAUNCH";
const SOURCE_FINGERPRINT = "10BD9B5B0CF32C22F00719376B0126575E8B8E843A3CD12AD14DE28C9F43B520";

const SUPPRESSIONS = [
  { email: "tom@aspen-technology.com", disposition: "UNSUBSCRIBE" },
  { email: "swentz@acilconsulting.com", disposition: "NEGATIVE" },
  { email: "ldawson@family1stbio.com", disposition: "NEGATIVE" },
  { email: "sherrie@jadaprints.com", disposition: "UNSUBSCRIBE" }
];
const INTERESTED = { email: "ceo@panzertek.com", disposition: "CONDITIONAL_INTERESTED", qualification: "COMMISSION_OR_RESULTS_BASED_ONLY" };
const NURTURE = { email: "bryan@quadvideohalo.com", disposition: "NURTURE_12_MONTHS", reason: "STARTUP_PRICE_TIMING", duplicateReplyCount: 2 };
const FUTURE_FOLLOW_UP = [
  { email: "karl@dumbomoving.com", disposition: "OUT_OF_OFFICE" },
  { email: "jeremy@p1comms.com", disposition: "OPERATIONS_SUSPENDED" },
  { email: "jamita.machen@theswvault.com", disposition: "OUT_OF_OFFICE" }
];
const REPLACEMENTS = [
  { oldEmail: "sbhservices@gci.net", newEmail: "sbhservicesinc@outlook.com", status: "VERIFICATION_REQUIRED" },
  { oldEmail: "hollywood@gci.net", newEmail: "hollywoodak@outlook.com", status: "VERIFICATION_REQUIRED", deduplicateWith: "sbhservicesinc@outlook.com" }
];
const HELD = [
  { email: "bgservices@boogphotobooth.com", disposition: "AUTO_ACKNOWLEDGEMENT" },
  { email: "nick@licraftsmanship.com", disposition: "NON_PROSPECT_OPERATIONAL_MESSAGE" }
];

function text(value) { return String(value == null ? "" : value).trim(); }
function lower(value) { return text(value).toLowerCase(); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }

class RevenueVerifiedReplyDispositionApplyService {
  constructor(options = {}) {
    this.service = "REVENUE_VERIFIED_REPLY_DISPOSITION_APPLY";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.sourcePath = options.sourcePath || path.join(this.rootDir, "DATA", "runtime", "revenue", "held_reply_content_audit", "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "verified_reply_disposition_apply");
    this.progressPath = options.progressPath || path.join(this.outputRoot, "progress.jsonl");
    this.outputPath = options.outputPath || path.join(this.outputRoot, "manifest.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    const connector = options.connector || ((options.blockProvider && options.interestProvider) ? null : require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js")));
    this.blockProvider = options.blockProvider || (email => connector.request("/block-lists-entries", { method: "POST", body: { bl_value: email } }));
    this.interestProvider = options.interestProvider || (payload => connector.request("/leads/update-interest-status", { method: "POST", body: payload }));
  }

  plan() {
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      authorizationRequired: AUTHORIZATION,
      exactEmailBlocks: SUPPRESSIONS.length,
      interestedUpdates: 1,
      providerWritesAuthorized: false,
      mailboxWritesAuthorized: false,
      emailsSent: false,
      repliesSent: false,
      campaignsChanged: false,
      campaignsLaunched: false
    };
  }

  loadSource() {
    if (!fs.existsSync(this.sourcePath)) throw new Error("Gate 23B2 evidence is missing.");
    const source = JSON.parse(fs.readFileSync(this.sourcePath, "utf8").replace(/^\uFEFF/, ""));
    if (source.ok !== true || source.status !== "HELD_REPLY_CONTENT_AUDITED") throw new Error("Gate 23B2 evidence is unhealthy.");
    if (source.auditFingerprint !== SOURCE_FINGERPRINT) throw new Error("Gate 23B2 audit fingerprint changed.");
    if (Number(source.summary?.heldReplies) !== 14 || source.conservation?.ok !== true) throw new Error("Gate 23B2 conservation is invalid.");
    const byEmail = new Map((source.items || []).map(item => [lower(item.email), item]));
    const expected = [...SUPPRESSIONS.map(item => item.email), INTERESTED.email, NURTURE.email, ...FUTURE_FOLLOW_UP.map(item => item.email), ...REPLACEMENTS.map(item => item.oldEmail), ...HELD.map(item => item.email)];
    if (new Set(expected).size !== 13 || expected.some(email => !byEmail.has(email))) throw new Error("Reviewed reply identities changed.");
    if ((source.items || []).filter(item => lower(item.email) === NURTURE.email).length !== 2) throw new Error("Bryan reply-thread conservation changed.");
    for (const item of SUPPRESSIONS) {
      const observed = text(byEmail.get(item.email)?.classification);
      if (!(["UNSUBSCRIBE", "NEGATIVE"].includes(observed))) throw new Error("Suppression classification changed: " + item.email);
    }
    return source;
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

  persistQueue(name, records) {
    const filePath = path.join(this.outputRoot, name + ".json");
    fs.mkdirSync(this.outputRoot, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");
    return { filePath, records: records.length, bytes: fs.statSync(filePath).size, sha256: sha256(fs.readFileSync(filePath)) };
  }

  assertLiveResponse(response, action) {
    if (!response || response.dryRun === true || response.mutationExecuted === false) throw new Error(action + " returned a dry-run or empty response.");
  }

  async apply(input = {}) {
    if (input.apply !== true) return this.plan();
    if (input.live !== true) throw new Error("Explicit --live authorization is required.");
    if (input.authorization !== AUTHORIZATION) throw new Error("Exact Gate 23B3 authorization is required.");
    this.loadSource();
    const progress = this.loadProgress();
    let blocksCreatedThisRun = 0;
    let interestedUpdatedThisRun = 0;

    for (const item of SUPPRESSIONS) {
      const actionId = sha256("BLOCK_EMAIL:" + item.email + ":" + item.disposition + ":" + SOURCE_FINGERPRINT);
      if (progress.has(actionId)) continue;
      const response = await this.blockProvider(item.email);
      this.assertLiveResponse(response, "Exact email block");
      if (response.bl_value && lower(response.bl_value) !== item.email) throw new Error("Block-list response identity mismatch.");
      const record = { actionId, action: "BLOCK_EXACT_EMAIL", email: item.email, disposition: item.disposition, completedAt: this.generatedAt() };
      this.appendProgress(record); progress.set(actionId, record); blocksCreatedThisRun += 1;
    }

    const interestedActionId = sha256("INTERESTED:" + INTERESTED.email + ":" + SOURCE_FINGERPRINT);
    if (!progress.has(interestedActionId)) {
      const response = await this.interestProvider({ lead_email: INTERESTED.email, interest_value: 1, disable_auto_interest: true });
      this.assertLiveResponse(response, "Interested update");
      const record = { actionId: interestedActionId, action: "MARK_CONDITIONAL_INTERESTED", ...INTERESTED, completedAt: this.generatedAt() };
      this.appendProgress(record); progress.set(interestedActionId, record); interestedUpdatedThisRun = 1;
    }

    const artifacts = {
      nurture: this.persistQueue("nurture_12_months", [{ ...NURTURE, eligibleAfter: "2027-08-08", sendAuthorized: false }]),
      futureFollowUp: this.persistQueue("future_follow_up", FUTURE_FOLLOW_UP.map(item => ({ ...item, sendAuthorized: false }))),
      replacementVerification: this.persistQueue("replacement_email_verification", REPLACEMENTS.map(item => ({ ...item, emailVerified: false, outreachAuthorized: false }))),
      held: this.persistQueue("held_non_opportunities", HELD.map(item => ({ ...item, sendAuthorized: false })))
    };

    const report = {
      ok: true,
      service: this.service,
      mode: "APPLY_LIVE_AUTHORIZED",
      status: "VERIFIED_REPLY_DISPOSITIONS_APPLIED",
      generatedAt: this.generatedAt(),
      authorization: AUTHORIZATION,
      sourceAuditFingerprint: SOURCE_FINGERPRINT,
      summary: {
        exactEmailsBlocked: SUPPRESSIONS.length,
        interestedMarked: 1,
        nurtureContacts: 1,
        duplicateNurtureRepliesCollapsed: 2,
        futureFollowUpHeld: FUTURE_FOLLOW_UP.length,
        replacementEmailsQueuedForVerification: REPLACEMENTS.length,
        nonOpportunitiesHeld: HELD.length,
        blocksCreatedThisRun,
        interestedUpdatedThisRun
      },
      conservation: { ok: 4 + 1 + 2 + 3 + 2 + 2 === 14, sourceReplies: 14, dispositions: 14 },
      providerWritesAuthorized: true,
      providerWriteScope: "BLOCK_4_EXACT_EMAILS_AND_MARK_1_CONDITIONAL_INTERESTED",
      mailboxWritesAuthorized: false,
      suppression: SUPPRESSIONS,
      interested: INTERESTED,
      nurture: NURTURE,
      futureFollowUp: FUTURE_FOLLOW_UP,
      replacementVerification: REPLACEMENTS,
      held: HELD,
      artifacts,
      leadsUploaded: 0,
      emailsSent: false,
      repliesSent: false,
      campaignsChanged: false,
      campaignsLaunched: false
    };
    const identity = { ...report }; delete identity.generatedAt;
    report.applyFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath: this.outputPath, bytes: fs.statSync(this.outputPath).size, sha256: sha256(fs.readFileSync(this.outputPath)) };
    return report;
  }
}

module.exports = RevenueVerifiedReplyDispositionApplyService;
module.exports.AUTHORIZATION = AUTHORIZATION;
module.exports.SOURCE_FINGERPRINT = SOURCE_FINGERPRINT;
module.exports.SUPPRESSIONS = SUPPRESSIONS;
