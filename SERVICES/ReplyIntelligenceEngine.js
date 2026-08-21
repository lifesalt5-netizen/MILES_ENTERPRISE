"use strict";

/**
 * REPLY INTELLIGENCE ENGINE v3
 * Compatibility wrapper around the revenue-grade ReplyIntelligenceService.
 *
 * Safety rule:
 * - Classification and routing decisions are automatic.
 * - Qualified positive replies may be marked as governed reply candidates.
 * - No prospect-facing reply is sent by this engine.
 */

const ReplyIntelligenceService = require("./revenue/ReplyIntelligenceService");
const { evaluateQualifiedReplyForAutonomy } = require("./revenue/AutonomousQualifiedReplyPolicy");

const LEGACY_TYPES = Object.freeze({
  PRICING_QUESTION: "interested",
  MEETING_INTENT: "meeting",
  INTERESTED: "interested",
  REFERRAL: "interested",
  NEUTRAL_QUESTION: "unknown",
  NOT_NOW: "notNow",
  OOO: "spam",
  AUTO_REPLY: "spam",
  NEGATIVE: "notInterested",
  UNSUBSCRIBE: "notInterested",
  BOUNCE_TECHNICAL: "spam",
  INBOUND_SOLICITATION_SPAM: "spam",
  UNKNOWN: "unknown"
});

function replyExecutionContext(reply = {}) {
  return {
    reply_to_uuid: reply.reply_to_uuid || reply.replyToUuid || reply.email_uuid || reply.emailId || reply.email_id || reply.id || reply.uuid || "",
    eaccount: reply.eaccount || reply.sender_account || reply.senderAccount || reply.account || reply.account_email || ""
  };
}

class ReplyIntelligenceEngine {
  constructor(options = {}) {
    this.connectors = options.connectors || {};
    this.classifier = options.classifier || new ReplyIntelligenceService(options);
  }

  normalize(reply = {}) {
    if (reply.body && typeof reply.body === "object") return reply;
    return {
      ...reply,
      body: {
        text: reply.text || reply.body || reply.snippet || reply.message || ""
      },
      from_address_email: reply.from_address_email || reply.email || reply?.lead?.email || reply.from || "",
      lead_id: reply.lead_id || reply?.lead?.id || "",
      campaign_id: reply.campaign_id || reply.campaignId || ""
    };
  }

  async processReplies(replies = []) {
    const processed = [];
    const exact = [];
    const summary = {
      interested: 0,
      notNow: 0,
      notInterested: 0,
      meeting: 0,
      spam: 0,
      unknown: 0
    };
    let governedReplyCandidates = 0;

    for (const reply of Array.isArray(replies) ? replies : []) {
      const normalized = this.normalize(reply);
      const exactClassification = this.classifier.classify(normalized);
      const legacyType = LEGACY_TYPES[exactClassification.category] || "unknown";
      const classification = {
        type: legacyType,
        category: exactClassification.category,
        confidence: exactClassification.confidence,
        humanReply: exactClassification.humanReply,
        qualifiedPositive: exactClassification.qualifiedPositive,
        hardSuppression: exactClassification.hardSuppression,
        action: exactClassification.action,
        followUpAt: exactClassification.followUpAt,
        priority: exactClassification.priority
      };
      const executionContext = replyExecutionContext(reply);
      const autonomy = evaluateQualifiedReplyForAutonomy({
        ...exactClassification,
        ...executionContext
      });
      if (autonomy.eligible) governedReplyCandidates += 1;

      processed.push({
        reply,
        classification,
        autonomy: {
          ...autonomy,
          ...executionContext
        }
      });
      exact.push(exactClassification);
      summary[legacyType] = Number(summary[legacyType] || 0) + 1;
    }

    return {
      timestamp: new Date().toISOString(),
      processed,
      summary,
      revenueSummary: this.classifier.summarize(exact),
      governedReplyCandidates,
      safety: {
        prospectFacingRepliesSent: 0,
        campaignMutations: 0,
        classificationOnly: true,
        governedReplyCandidatesPrepared: governedReplyCandidates
      }
    };
  }
}

module.exports = ReplyIntelligenceEngine;
module.exports.LEGACY_TYPES = LEGACY_TYPES;
module.exports.replyExecutionContext = replyExecutionContext;
