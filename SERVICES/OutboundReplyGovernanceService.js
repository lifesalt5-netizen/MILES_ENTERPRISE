"use strict";

function textOf(input = {}) {
  return `${input.subject || ""}\n${input.body || input.text || input.message || ""}`.toLowerCase();
}

function classify(input = {}) {
  const text = textOf(input);
  const sender = String(input.from || input.sender || "").toLowerCase();

  const rules = [
    { category: "UNSUBSCRIBE", priority: "HIGH", re: /\b(unsubscribe|remove me|opt ?out|stop emailing|do not contact|don'?t contact)\b/i,
      actions: ["SUPPRESS_PERMANENTLY","REMOVE_FROM_ALL_CAMPAIGNS","ADD_DO_NOT_CONTACT"], folder: "06 - UNSUBSCRIBES", notifyKevin: false },
    { category: "HARD_BOUNCE", priority: "MEDIUM", re: /(user unknown|recipient not found|mailbox unavailable|address rejected|delivery failed permanently|550\s|5\.1\.1)/i,
      actions: ["MARK_EMAIL_INVALID","REMOVE_FROM_ACTIVE_CAMPAIGNS","ADD_SUPPRESSION","CHECK_SENDER_HEALTH"], folder: "04 - BOUNCES", notifyKevin: false },
    { category: "SOFT_BOUNCE", priority: "LOW", re: /(mailbox full|temporary failure|server unavailable|try again later|421\s|4\.\d\.\d)/i,
      actions: ["RETRY_BY_CAMPAIGN_POLICY","TRACK_REPEAT_FAILURE"], folder: "04 - BOUNCES", notifyKevin: false },
    { category: "OUT_OF_OFFICE", priority: "LOW", re: /(out of office|automatic reply|auto.?reply|on vacation|away until|returning on|i am away|i'm away)/i,
      actions: ["EXTRACT_RETURN_DATE","SCHEDULE_FUTURE_FOLLOWUP","SUPPRESS_DUPLICATE_NOTIFICATION"], folder: "03 - OUT OF OFFICE", notifyKevin: false },
    { category: "SPAM_CHALLENGE", priority: "IGNORE", re: /(barracuda|proofpoint|mimecast|captcha|verify you are human|security verification|email security|url validation|microsoft defender|quarantine)/i,
      actions: ["IGNORE","DO_NOT_COUNT_AS_ENGAGEMENT"], folder: "05 - SPAM RESPONSES", notifyKevin: false },
    { category: "GENERIC_AUTOMATED", priority: "IGNORE", re: /(support ticket|case number|ticket number|automated acknowledgment|automated acknowledgement|thank you for contacting|do not reply|noreply|no-reply)/i,
      actions: ["IGNORE","DO_NOT_CREATE_OPPORTUNITY"], folder: "05 - SPAM RESPONSES", notifyKevin: false },
    { category: "MEETING_REQUEST", priority: "CRITICAL", re: /(schedule (a )?(call|meeting)|book (a )?(call|meeting)|calendar|calendly|available (next|this) week|when are you available|set up (a )?(call|meeting)|meet with)/i,
      actions: ["MARK_POSITIVE","CREATE_OPPORTUNITY","CREATE_FOLLOWUP_TASK","SEND_SCHEDULING_PATH","NOTIFY_KEVIN"], folder: "01 - MEETING REQUESTS", notifyKevin: true },
    { category: "QUALIFIED_LEAD", priority: "CRITICAL", re: /(interested|tell me more|send (me )?(information|info|details)|let'?s talk|please call|we'?d like to discuss|would like to discuss|can we talk|sounds interesting)/i,
      actions: ["MARK_POSITIVE","CREATE_OPPORTUNITY","CREATE_FOLLOWUP_TASK","NOTIFY_KEVIN"], folder: "00 - HOT LEADS", notifyKevin: true },
    { category: "NURTURE", priority: "LOW", re: /(not now|not right now|circle back|follow up later|later this year|next quarter|maybe later)/i,
      actions: ["MOVE_TO_NURTURE","SCHEDULE_FUTURE_FOLLOWUP"], folder: "07 - NURTURE", notifyKevin: false }
  ];

  for (const rule of rules) {
    if (rule.re.test(text) || (rule.category === "GENERIC_AUTOMATED" && /noreply|no-reply/.test(sender))) {
      return { ok: true, category: rule.category, priority: rule.priority, actions: rule.actions, folder: rule.folder, notifyKevin: rule.notifyKevin, confidence: "RULE_MATCH" };
    }
  }

  return {
    ok: true,
    category: "FOLLOW_UP_REQUIRED",
    priority: "MEDIUM",
    actions: ["HUMAN_OR_AI_REVIEW","DO_NOT_AUTO_SUPPRESS"],
    folder: "02 - FOLLOW-UP REQUIRED",
    notifyKevin: false,
    confidence: "UNCLASSIFIED"
  };
}

function processBatch(messages = []) {
  const results = messages.map(message => ({ ...message, classification: classify(message) }));
  const counts = {};
  for (const item of results) counts[item.classification.category] = (counts[item.classification.category] || 0) + 1;
  return { ok: true, gate: "OUTBOUND_REPLY_GOVERNANCE", processed: results.length, counts, results };
}

module.exports = { classify, processBatch };
