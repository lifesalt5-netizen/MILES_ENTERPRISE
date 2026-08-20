"use strict";

const fs = require("fs");
const path = require("path");

const QUALIFIED_CATEGORIES = new Set([
  "PRICING_QUESTION",
  "MEETING_INTENT",
  "INTERESTED",
  "REFERRAL"
]);

const NON_EXECUTIVE_CATEGORIES = new Set([
  "OOO",
  "AUTO_REPLY",
  "NOT_NOW",
  "NEGATIVE",
  "UNSUBSCRIBE",
  "BOUNCE_TECHNICAL",
  "INBOUND_SOLICITATION_SPAM",
  "NEUTRAL_QUESTION",
  "UNKNOWN"
]);

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, filePath);
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function replyKey(reply = {}) {
  return String(
    reply.conversationKey ||
    reply.threadId ||
    reply.thread_id ||
    `${reply.from || ""}|${reply.campaignId || reply.campaign_id || ""}`
  ).trim();
}

class ExecutiveReplySurfacePolicyService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.outputDir = options.outputDir || path.join(this.rootDir, "DATA", "runtime", "revenue", "replies");
    this.queuePath = options.queuePath || path.join(this.outputDir, "executive_reply_surface_queue.json");
    this.latestPath = options.latestPath || path.join(this.outputDir, "executive_reply_surface_latest.json");
  }

  disposition(classification = {}) {
    const category = String(classification.category || "UNKNOWN").trim();
    const qualified = classification.qualifiedPositive === true || QUALIFIED_CATEGORIES.has(category);

    if (qualified) {
      return {
        surfaceToExecutiveInbox: true,
        executiveDisposition: "SURFACE_QUALIFIED_REPLY",
        destination: "EXECUTIVE_INBOX",
        requiresHumanAttention: true
      };
    }

    if (category === "OOO" || category === "NOT_NOW") {
      return {
        surfaceToExecutiveInbox: false,
        executiveDisposition: "MILES_FOLLOWUP_ONLY",
        destination: "FOLLOWUP_QUEUE",
        requiresHumanAttention: false
      };
    }

    if (["NEGATIVE", "UNSUBSCRIBE", "BOUNCE_TECHNICAL"].includes(category)) {
      return {
        surfaceToExecutiveInbox: false,
        executiveDisposition: "MILES_SUPPRESSION_ONLY",
        destination: "SUPPRESSION",
        requiresHumanAttention: false
      };
    }

    if (category === "AUTO_REPLY" || category === "INBOUND_SOLICITATION_SPAM") {
      return {
        surfaceToExecutiveInbox: false,
        executiveDisposition: "MILES_LOG_ONLY",
        destination: "ACTIVITY_LOG",
        requiresHumanAttention: false
      };
    }

    if (category === "NEUTRAL_QUESTION" || category === "UNKNOWN") {
      return {
        surfaceToExecutiveInbox: false,
        executiveDisposition: "MILES_REVIEW_QUEUE_ONLY",
        destination: "MANUAL_REVIEW_QUEUE",
        requiresHumanAttention: false
      };
    }

    return {
      surfaceToExecutiveInbox: false,
      executiveDisposition: NON_EXECUTIVE_CATEGORIES.has(category) ? "MILES_HANDLE_ONLY" : "MILES_REVIEW_QUEUE_ONLY",
      destination: "MANUAL_REVIEW_QUEUE",
      requiresHumanAttention: false
    };
  }

  apply(classification = {}) {
    const policy = this.disposition(classification);
    const record = {
      ...classification,
      ...policy,
      surfacedAt: policy.surfaceToExecutiveInbox ? new Date().toISOString() : null,
      policyAppliedAt: new Date().toISOString(),
      source: classification.source || "INSTANTLY_UNIBOX"
    };

    const existing = readJson(this.queuePath, []);
    const rows = Array.isArray(existing) ? existing : [];
    const key = replyKey(record);
    const filtered = rows.filter(row => replyKey(row) !== key);

    if (policy.surfaceToExecutiveInbox) filtered.push(record);
    writeJsonAtomic(this.queuePath, filtered);

    writeJsonAtomic(this.latestPath, {
      ok: true,
      service: "EXECUTIVE_REPLY_SURFACE_POLICY",
      policy: "QUALIFIED_POSITIVE_ONLY",
      rawForwardingAllowed: false,
      nonQualifiedExecutiveInboxAllowed: false,
      queuePath: this.queuePath,
      queueCount: filtered.length,
      latest: record,
      generatedAt: new Date().toISOString()
    });

    return record;
  }
}

module.exports = ExecutiveReplySurfacePolicyService;
module.exports.ExecutiveReplySurfacePolicyService = ExecutiveReplySurfacePolicyService;
module.exports.QUALIFIED_CATEGORIES = QUALIFIED_CATEGORIES;
