"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const AUTHORIZATION = "AUTHORIZE_GATE_23B2_HELD_REPLY_CONTENT_AUDIT_PLAN_ONLY";
const SOURCE_FINGERPRINT = "B41A8C2BBE0F4FB7667D8A03D34A4596316C28B0D68FEA23E89C50AE3D3DC537";

function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value == null ? "" : value).trim(); }
function lower(value) { return text(value).toLowerCase(); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }

class RevenueHeldReplyContentAuditService {
  constructor(options = {}) {
    this.service = "REVENUE_HELD_REPLY_CONTENT_AUDIT";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.sourcePath = options.sourcePath || path.join(this.rootDir, "DATA", "runtime", "revenue", "instantly_reply_triage_apply", "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "held_reply_content_audit");
    this.outputPath = options.outputPath || path.join(this.outputRoot, "manifest.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.requestDelayMs = options.requestDelayMs === undefined ? 3250 : Number(options.requestDelayMs);
    this.sleep = options.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    const connector = options.connector || (options.emailProvider ? null : require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js")));
    this.emailProvider = options.emailProvider || (messageId => connector.request("/emails/" + encodeURIComponent(messageId), { method: "GET" }));
  }

  plan() {
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      authorizationRequired: AUTHORIZATION,
      heldRepliesExpected: 14,
      providerReadsAuthorized: false,
      providerWritesAuthorized: false,
      mailboxWritesAuthorized: false,
      emailsSent: false,
      repliesSent: false,
      campaignsChanged: false,
      campaignsLaunched: false
    };
  }

  loadSource() {
    if (!fs.existsSync(this.sourcePath)) throw new Error("Gate 23B evidence is missing.");
    const source = JSON.parse(fs.readFileSync(this.sourcePath, "utf8").replace(/^\uFEFF/, ""));
    if (source.ok !== true || source.status !== "LEGACY_PAUSED_AND_REPLY_TRIAGE_APPLIED") throw new Error("Gate 23B evidence is unhealthy.");
    if (source.applyFingerprint !== SOURCE_FINGERPRINT) throw new Error("Gate 23B apply fingerprint changed.");
    const held = array(source.dispositions?.manualReview).map(item => ({
      messageId: text(item.messageId),
      email: lower(item.email || item.from),
      subject: text(item.subject).slice(0, 180)
    }));
    if (Number(source.summary?.manualReviewHeld) !== 14 || held.length !== 14) throw new Error("Exactly fourteen held replies are required.");
    if (new Set(held.map(item => item.messageId)).size !== 14 || held.some(item => !item.messageId || !item.email)) throw new Error("Held reply identity evidence is invalid.");
    return { source, held };
  }

  unwrap(response) {
    for (const key of ["email", "data", "item", "result"]) if (response?.[key] && typeof response[key] === "object") return response[key];
    if (response && typeof response === "object") return response;
    throw new Error("Provider response does not contain an email object.");
  }

  stripMarkup(value) {
    return text(value)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/&#39;/g, "'").replace(/&quot;/gi, "\"")
      .replace(/\s+/g, " ").trim();
  }

  extractBody(message) {
    const candidates = [];
    const visit = (value, key = "", depth = 0) => {
      if (depth > 5 || value == null) return;
      if (typeof value === "string") {
        if (/(body|text|content|html|snippet|preview|message)/i.test(key)) candidates.push(this.stripMarkup(value));
        return;
      }
      if (Array.isArray(value)) return value.forEach(item => visit(item, key, depth + 1));
      if (typeof value === "object") for (const [childKey, child] of Object.entries(value)) visit(child, childKey, depth + 1);
    };
    visit(message);
    const body = candidates.filter(Boolean).sort((a, b) => b.length - a.length)[0] || "";
    if (!body) throw new Error("Provider email body is missing.");
    return body;
  }

  classify(item, body) {
    const combined = lower(item.subject + " " + body);
    if (/unsubscribe|remove me|stop (emailing|sending)|do not (email|contact)|opt.?out/.test(combined)) return "UNSUBSCRIBE";
    if (/out of (the )?office|away from (my )?desk|vacation responder|on vacation|limited availability|temporary suspension of operations|return(ing)? on/.test(combined)) return "OUT_OF_OFFICE";
    if (/automated (message|reply|response)|auto.?reply|we.{0,12}(received|got) your (email|message)|do not reply|no.?reply|must read.{0,30}(schedule|resources)/.test(combined) || /automated|no.?reply/.test(item.email)) return "AUTO_ACKNOWLEDGEMENT";
    if (/not interested|no thank(s| you)|not a fit|do not need|already (have|use|work with)|please don.t contact/.test(combined)) return "NEGATIVE";
    if (/how much|price|pricing|cost|interested|tell me more|send (me )?(details|information)|book|schedule (a )?(call|meeting)|let.s (talk|connect)|proposal|available for a call|yes[, .]/.test(combined)) return "POSITIVE_REVIEW";
    return "MANUAL_REVIEW";
  }

  async audit(input = {}) {
    if (input.apply !== true) return this.plan();
    if (input.live !== true) throw new Error("Explicit --live provider-read authorization is required.");
    if (input.authorization !== AUTHORIZATION) throw new Error("Exact Gate 23B2 authorization is required.");
    const { held } = this.loadSource();
    const items = [];
    for (let index = 0; index < held.length; index += 1) {
      if (index > 0 && this.requestDelayMs > 0) await this.sleep(this.requestDelayMs);
      const message = this.unwrap(await this.emailProvider(held[index].messageId));
      const providerId = text(message.id || message.email_id || held[index].messageId);
      if (providerId && providerId !== held[index].messageId) throw new Error("Provider message identity mismatch.");
      const body = this.extractBody(message);
      items.push({
        ...held[index],
        classification: this.classify(held[index], body),
        excerpt: body.slice(0, 300),
        bodyBytes: Buffer.byteLength(body),
        bodySha256: sha256(Buffer.from(body))
      });
    }
    const counts = {};
    for (const item of items) counts[item.classification] = (counts[item.classification] || 0) + 1;
    const classified = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const report = {
      ok: true,
      service: this.service,
      mode: "APPLY_LIVE_READ_ONLY",
      status: "HELD_REPLY_CONTENT_AUDITED",
      generatedAt: this.generatedAt(),
      authorization: AUTHORIZATION,
      sourceApplyFingerprint: SOURCE_FINGERPRINT,
      summary: { heldReplies: 14, providerMessagesRead: items.length, counts, stillRequiringManualReview: counts.MANUAL_REVIEW || 0 },
      conservation: { ok: classified === 14 && items.length === 14, classified, heldReplies: 14 },
      items,
      recommendedNextActions: {
        interestedReview: items.filter(item => item.classification === "POSITIVE_REVIEW").map(item => item.messageId),
        suppressAfterApproval: items.filter(item => ["UNSUBSCRIBE", "NEGATIVE"].includes(item.classification)).map(item => item.messageId),
        defer: items.filter(item => item.classification === "OUT_OF_OFFICE").map(item => item.messageId),
        holdAutomated: items.filter(item => item.classification === "AUTO_ACKNOWLEDGEMENT").map(item => item.messageId),
        manualReview: items.filter(item => item.classification === "MANUAL_REVIEW").map(item => item.messageId)
      },
      providerReadsPerformed: true,
      providerWritesAuthorized: false,
      mailboxWritesAuthorized: false,
      leadsUpdated: 0,
      emailsSent: false,
      repliesSent: false,
      campaignsChanged: false,
      campaignsLaunched: false
    };
    const identity = { ...report }; delete identity.generatedAt;
    report.auditFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    fs.mkdirSync(this.outputRoot, { recursive: true });
    fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath: this.outputPath, bytes: fs.statSync(this.outputPath).size, sha256: sha256(fs.readFileSync(this.outputPath)) };
    return report;
  }
}

module.exports = RevenueHeldReplyContentAuditService;
module.exports.AUTHORIZATION = AUTHORIZATION;
module.exports.SOURCE_FINGERPRINT = SOURCE_FINGERPRINT;
