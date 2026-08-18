"use strict";

const CATEGORIES = Object.freeze({
  PRICING_QUESTION: "PRICING_QUESTION",
  MEETING_INTENT: "MEETING_INTENT",
  INTERESTED: "INTERESTED",
  REFERRAL: "REFERRAL",
  NEUTRAL_QUESTION: "NEUTRAL_QUESTION",
  NOT_NOW: "NOT_NOW",
  OOO: "OOO",
  AUTO_REPLY: "AUTO_REPLY",
  NEGATIVE: "NEGATIVE",
  UNSUBSCRIBE: "UNSUBSCRIBE",
  BOUNCE_TECHNICAL: "BOUNCE_TECHNICAL",
  INBOUND_SOLICITATION_SPAM: "INBOUND_SOLICITATION_SPAM",
  UNKNOWN: "UNKNOWN"
});

const SALES_POSITIVE = new Set([
  CATEGORIES.PRICING_QUESTION,
  CATEGORIES.MEETING_INTENT,
  CATEGORIES.INTERESTED,
  CATEGORIES.REFERRAL
]);

const HARD_SUPPRESSION = new Set([
  CATEGORIES.UNSUBSCRIBE,
  CATEGORIES.NEGATIVE,
  CATEGORIES.BOUNCE_TECHNICAL
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return clean(String(value ?? "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&"));
}

function bodyText(email = {}) {
  const text = email?.body?.text || email?.text || email?.body_text || email?.content_preview || email?.snippet || email?.message || "";
  const html = email?.body?.html || email?.html || "";
  return clean(text || stripHtml(html));
}

function senderEmail(email = {}) {
  return clean(email?.from_address_email || email?.from || email?.sender_email || email?.lead || email?.lead_email).toLowerCase();
}

function matches(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function parseReturnDate(text, now = new Date()) {
  const source = clean(text);
  const monthDay = source.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (monthDay) {
    const parsed = new Date(`${monthDay[1]} ${monthDay[2]}, ${now.getUTCFullYear()} 12:00:00 UTC`);
    if (!Number.isNaN(parsed.getTime())) {
      if (parsed.getTime() < now.getTime() - 7 * 86400000) parsed.setUTCFullYear(parsed.getUTCFullYear() + 1);
      return new Date(parsed.getTime() + 86400000).toISOString();
    }
  }

  const numeric = source.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : now.getUTCFullYear();
    const parsed = new Date(Date.UTC(year, Number(numeric[1]) - 1, Number(numeric[2]), 12));
    if (!Number.isNaN(parsed.getTime())) return new Date(parsed.getTime() + 86400000).toISOString();
  }

  return null;
}

function addDaysIso(days, now = new Date()) {
  return new Date(now.getTime() + days * 86400000).toISOString();
}

class ReplyIntelligenceService {
  constructor(options = {}) {
    this.now = options.now || (() => new Date());
  }

  classify(email = {}) {
    const subject = clean(email.subject);
    const body = bodyText(email);
    const combined = `${subject}\n${body}`.toLowerCase();
    const from = senderEmail(email);
    const campaignId = clean(email.campaign_id || email.campaignId);
    const leadId = clean(email.lead_id || email.leadId);
    const instantAuto = Number(email.is_auto_reply || 0) === 1 || email.is_auto_reply === true;

    const oooPatterns = [
      /\bout of (?:the )?office\b/i,
      /\baway from (?:my )?desk\b/i,
      /\bon vacation\b/i,
      /\bannual leave\b/i,
      /\bmedical leave\b/i,
      /\blimited availability\b/i,
      /\bcurrently (?:traveling|travelling)\b/i,
      /\breturning (?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d)/i
    ];
    if (matches(combined, oooPatterns)) {
      return this.result(email, CATEGORIES.OOO, 0.99, {
        humanReply: false,
        action: "SCHEDULE_FOLLOWUP_AFTER_RETURN",
        followUpAt: parseReturnDate(combined, this.now()) || addDaysIso(7, this.now())
      });
    }

    const bouncePatterns = [
      /\bmail delivery (?:system|subsystem)\b/i,
      /\bundeliverable\b/i,
      /\bdelivery (?:status notification|failure|failed)\b/i,
      /\breturned message\b/i,
      /\brecipient address rejected\b/i,
      /\bmessage could not be delivered\b/i,
      /\baddress not found\b/i
    ];
    if (matches(combined, bouncePatterns)) {
      return this.result(email, CATEGORIES.BOUNCE_TECHNICAL, 0.99, {
        humanReply: false,
        action: "SUPPRESS_EMAIL_TECHNICAL"
      });
    }

    const unsubscribePatterns = [
      /\bunsubscribe\b/i,
      /\bremove me\b/i,
      /\btake me off\b/i,
      /\bstop (?:emailing|contacting|sending)\b/i,
      /\bdo not (?:email|contact) me\b/i,
      /\bdon't (?:email|contact) me\b/i,
      /\bopt me out\b/i
    ];
    if (matches(combined, unsubscribePatterns)) {
      return this.result(email, CATEGORIES.UNSUBSCRIBE, 0.99, {
        humanReply: true,
        action: "HARD_SUPPRESS"
      });
    }

    const autoPatterns = [
      /\bautomatic reply\b/i,
      /\bautomated reply\b/i,
      /\bauto[- ]?reply\b/i,
      /\bwe(?:'|’)ve received your (?:message|email)\b/i,
      /\bthank you for contacting\b/i,
      /\bthis is an automated (?:message|response)\b/i,
      /\bdo not reply to this (?:message|email)\b/i
    ];
    if (instantAuto || matches(combined, autoPatterns)) {
      return this.result(email, CATEGORIES.AUTO_REPLY, 0.98, {
        humanReply: false,
        action: "LOG_ONLY"
      });
    }

    const negativePatterns = [
      /\bno thanks\b/i,
      /\bno thank you\b/i,
      /\bnot interested\b/i,
      /\bnot a priority\b/i,
      /\bwe(?:'|’)re not interested\b/i,
      /\bwe are not interested\b/i,
      /\bnot something we need\b/i,
      /\bnot a fit\b/i,
      /\bplease close (?:this|the loop)\b/i
    ];
    if (matches(combined, negativePatterns)) {
      return this.result(email, CATEGORIES.NEGATIVE, 0.96, {
        humanReply: true,
        action: "HARD_SUPPRESS"
      });
    }

    const pricingPatterns = [
      /\bhow much\b/i,
      /\bwhat (?:does|would|will) (?:this|it) cost\b/i,
      /\bpricing\b/i,
      /\bprice\b/i,
      /\bcost\b/i,
      /\brate(?:s)?\b/i,
      /\bfee(?:s)?\b/i,
      /\bquote\b/i,
      /\bbudget\b/i
    ];
    if (matches(combined, pricingPatterns)) {
      return this.result(email, CATEGORIES.PRICING_QUESTION, 0.96, {
        humanReply: true,
        qualifiedPositive: true,
        action: "ALERT_KEVIN_IMMEDIATE"
      });
    }

    const meetingPatterns = [
      /\bschedule (?:a )?(?:call|meeting|time)\b/i,
      /\bbook (?:a )?(?:call|meeting|time)\b/i,
      /\blet(?:'|’)s (?:talk|chat|connect|meet)\b/i,
      /\bopen to (?:a )?(?:conversation|call|meeting|chat)\b/i,
      /\bcan we (?:talk|chat|connect|meet)\b/i,
      /\bwould like to (?:talk|chat|connect|meet)\b/i,
      /\bavailable (?:for|to) (?:a )?(?:call|meeting|chat)\b/i,
      /\b15 minutes\b/i
    ];
    if (matches(combined, meetingPatterns)) {
      return this.result(email, CATEGORIES.MEETING_INTENT, 0.94, {
        humanReply: true,
        qualifiedPositive: true,
        action: "ALERT_KEVIN_IMMEDIATE"
      });
    }

    const referralPatterns = [
      /\bplease (?:contact|reach out to|speak with)\b/i,
      /\bthe (?:right|best) person (?:is|would be)\b/i,
      /\bi(?:'|’)m copying\b/i,
      /\bcc(?:'|’)ing\b/i,
      /\brefer you to\b/i,
      /\bconnect you with\b/i
    ];
    if (matches(combined, referralPatterns)) {
      return this.result(email, CATEGORIES.REFERRAL, 0.9, {
        humanReply: true,
        qualifiedPositive: true,
        action: "CREATE_REFERRAL_FOLLOWUP"
      });
    }

    const interestedPatterns = [
      /\binterested\b/i,
      /\btell me more\b/i,
      /\bsounds good\b/i,
      /\bsounds interesting\b/i,
      /\bi(?:'|’)d like to learn more\b/i,
      /\bi would like to learn more\b/i,
      /\bcurious (?:about|to learn)\b/i,
      /\bwe should explore\b/i,
      /\byes[,!. ]/i
    ];
    if (matches(combined, interestedPatterns)) {
      return this.result(email, CATEGORIES.INTERESTED, 0.9, {
        humanReply: true,
        qualifiedPositive: true,
        action: "ALERT_KEVIN_IMMEDIATE"
      });
    }

    const notNowPatterns = [
      /\bnot (?:right )?now\b/i,
      /\bcircle back\b/i,
      /\brevisit (?:this )?(?:later|next)\b/i,
      /\bnext (?:month|quarter|year)\b/i,
      /\bfollow up (?:in|next)\b/i,
      /\btry me (?:in|next)\b/i,
      /\bafter (?:the )?(?:holidays|summer|budget|fiscal year)\b/i
    ];
    if (matches(combined, notNowPatterns)) {
      return this.result(email, CATEGORIES.NOT_NOW, 0.88, {
        humanReply: true,
        action: "SCHEDULE_NURTURE_FOLLOWUP",
        followUpAt: addDaysIso(30, this.now())
      });
    }

    const solicitationSignals = [
      /\bhelp (?:you|with your) (?:marketing|seo|website|sales)\b/i,
      /\bgrow your business\b/i,
      /\bnew customers\b/i,
      /\blead generation\b/i,
      /\bseo services\b/i,
      /\bmarketing services\b/i,
      /\bproduct offering\b/i,
      /\bfunding (?:available|offer)\b/i,
      /\bbusiness loan\b/i,
      /\bcustomer service\b/i,
      /\bwe(?:'|’)d love to (?:help|work with you)\b/i
    ];
    const solicitationScore = solicitationSignals.filter(pattern => pattern.test(combined)).length;
    if (!campaignId && !leadId && solicitationScore >= 2) {
      return this.result(email, CATEGORIES.INBOUND_SOLICITATION_SPAM, 0.9, {
        humanReply: false,
        action: "IGNORE_INBOUND_SOLICITATION"
      });
    }

    const neutralQuestionPatterns = [
      /\?/, /\bwhat\b/i, /\bwhich\b/i, /\bwho\b/i, /\bwhy\b/i, /\bhow\b/i, /\bcan you\b/i, /\bcould you\b/i
    ];
    if (matches(combined, neutralQuestionPatterns)) {
      return this.result(email, CATEGORIES.NEUTRAL_QUESTION, 0.72, {
        humanReply: true,
        action: "REVIEW_SAME_DAY"
      });
    }

    return this.result(email, CATEGORIES.UNKNOWN, 0.5, {
      humanReply: true,
      action: "MANUAL_REVIEW"
    });
  }

  result(email, category, confidence, overrides = {}) {
    const from = senderEmail(email);
    const body = bodyText(email);
    const humanReply = overrides.humanReply !== undefined ? overrides.humanReply : true;
    const qualifiedPositive = overrides.qualifiedPositive !== undefined
      ? overrides.qualifiedPositive
      : SALES_POSITIVE.has(category);
    return {
      category,
      confidence,
      from,
      emailId: clean(email?.id),
      threadId: clean(email?.thread_id || email?.threadId),
      campaignId: clean(email?.campaign_id || email?.campaignId),
      leadId: clean(email?.lead_id || email?.leadId),
      subject: clean(email?.subject),
      preview: clean(email?.content_preview || body).slice(0, 500),
      timestamp: clean(email?.timestamp_created || email?.timestamp_email || email?.timestamp || new Date().toISOString()),
      humanReply,
      qualifiedPositive,
      hardSuppression: HARD_SUPPRESSION.has(category),
      salesMetricEligible: humanReply && category !== CATEGORIES.INBOUND_SOLICITATION_SPAM,
      action: overrides.action || "MANUAL_REVIEW",
      followUpAt: overrides.followUpAt || null,
      priority: qualifiedPositive ? "CRITICAL" : [CATEGORIES.NEUTRAL_QUESTION, CATEGORIES.NOT_NOW].includes(category) ? "HIGH" : "NORMAL"
    };
  }

  summarize(classifications = []) {
    const counts = Object.fromEntries(Object.values(CATEGORIES).map(category => [category, 0]));
    for (const item of classifications) {
      if (counts[item?.category] !== undefined) counts[item.category] += 1;
    }
    const rawReceived = classifications.length;
    const humanReplies = classifications.filter(item => item?.humanReply).length;
    const qualifiedPositiveReplies = classifications.filter(item => item?.qualifiedPositive).length;
    const meaningfulHumanReplies = classifications.filter(item => item?.salesMetricEligible).length;
    return {
      rawReceived,
      humanReplies,
      meaningfulHumanReplies,
      qualifiedPositiveReplies,
      humanReplyRatePct: rawReceived ? Number(((humanReplies / rawReceived) * 100).toFixed(2)) : 0,
      qualifiedPositiveRatePct: humanReplies ? Number(((qualifiedPositiveReplies / humanReplies) * 100).toFixed(2)) : 0,
      counts
    };
  }
}

module.exports = ReplyIntelligenceService;
module.exports.ReplyIntelligenceService = ReplyIntelligenceService;
module.exports.CATEGORIES = CATEGORIES;
module.exports.SALES_POSITIVE = SALES_POSITIVE;
module.exports.HARD_SUPPRESSION = HARD_SUPPRESSION;
module.exports.helpers = { clean, stripHtml, bodyText, senderEmail, parseReturnDate, addDaysIso };
