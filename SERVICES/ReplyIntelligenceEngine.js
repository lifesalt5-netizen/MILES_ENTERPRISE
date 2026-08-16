"use strict";

/**
 * P2GC Reply Intelligence Engine v2
 *
 * Purpose:
 * - classify inbound outbound-campaign replies conservatively
 * - route CRM stage changes
 * - distinguish positive, negative, nurture, OOO, technical, spam, and review traffic
 * - never let negated interest ("not interested") become a hot lead
 * - treat qualified meeting intent as the primary revenue outcome
 *
 * Connector side effects remain dependency-injected. If a connector is absent,
 * the engine records the intended route without inventing an execution result.
 */

function textOf(reply = {}) {
  return String(reply.text || reply.body || reply.message || reply.subject || "").trim().toLowerCase();
}

function hasAny(text, phrases) {
  return phrases.some(phrase => text.includes(phrase));
}

class ReplyIntelligenceEngine {
  constructor({ connectors = {} } = {}) {
    this.connectors = connectors;
  }

  async processReplies(replies = []) {
    const results = {
      ok: true,
      timestamp: new Date().toISOString(),
      processed: [],
      summary: {
        meeting: 0,
        interested: 0,
        notNow: 0,
        notInterested: 0,
        outOfOffice: 0,
        technical: 0,
        spam: 0,
        unknown: 0,
        qualifiedMeetingsRequested: 0
      }
    };

    for (const reply of Array.isArray(replies) ? replies : []) {
      const classification = this.classify(reply);
      const route = await this.routeAction(reply, classification);
      results.processed.push({ reply, classification, route });
      results.summary[classification.type] = (results.summary[classification.type] || 0) + 1;
      if (classification.type === "meeting") results.summary.qualifiedMeetingsRequested += 1;
    }

    return results;
  }

  classify(reply = {}) {
    const text = textOf(reply);
    const subject = String(reply.subject || "").toLowerCase();

    if (!text && !subject) return { type:"unknown", bucket:"REVIEW", confidence:0.3, reason:"empty reply" };

    // Hard negative / compliance intent MUST precede positive keyword matching.
    if (hasAny(text, [
      "unsubscribe", "remove me", "remove my email", "do not contact", "don't contact",
      "stop emailing", "stop email", "stop contacting", "opt out", "not interested",
      "no thanks", "no thank you", "please stop"
    ])) {
      return { type:"notInterested", bucket:"NEGATIVE", confidence:0.98, reason:"negative or do-not-contact language" };
    }

    // Auto-response / OOO is operationally distinct from spam and should not suppress a valid lead.
    if (hasAny(text, [
      "out of office", "out-of-office", "automatic reply", "auto reply", "autoreply",
      "away from the office", "currently away", "on vacation", "annual leave", "returning on",
      "i will return", "i'll return", "limited access to email"
    ]) || /automatic reply|out of office/i.test(subject)) {
      return { type:"outOfOffice", bucket:"OOO", confidence:0.97, reason:"automatic absence response" };
    }

    // Delivery/system issues are technical, not human lead sentiment.
    if (hasAny(text, [
      "delivery failed", "undeliverable", "mailbox unavailable", "mailbox full", "address not found",
      "message blocked", "rejected by server", "550 5.", "mailer-daemon", "postmaster",
      "security gateway", "challenge-response", "verify you are human"
    ]) || /delivery status notification|undeliverable|mail delivery subsystem/i.test(subject)) {
      return { type:"technical", bucket:"TECHNICAL", confidence:0.96, reason:"delivery or automated technical response" };
    }

    // Meeting intent outranks generic positive intent because meetings are the governing KPI.
    if (hasAny(text, [
      "schedule a call", "schedule a meeting", "book a call", "book a meeting", "set up a call",
      "set up a meeting", "let's talk", "lets talk", "can we talk", "calendar", "calendly",
      "available to talk", "available for a call", "meet next", "call me", "give me a call"
    ])) {
      return { type:"meeting", bucket:"POSITIVE", confidence:0.95, reason:"explicit meeting/call intent" };
    }

    if (hasAny(text, [
      "interested", "sounds good", "tell me more", "send me more", "more information",
      "learn more", "how does this work", "yes please", "this could help", "we need help"
    ])) {
      return { type:"interested", bucket:"POSITIVE", confidence:0.9, reason:"positive interest language" };
    }

    if (hasAny(text, [
      "not now", "later", "next month", "next quarter", "follow up", "circle back",
      "check back", "reach back", "after the", "not a priority right now", "maybe later"
    ])) {
      return { type:"notNow", bucket:"NURTURE", confidence:0.88, reason:"future follow-up language" };
    }

    if (hasAny(text, [
      "wrong person", "not the right person", "contact our", "contact my", "please contact",
      "who handles", "procurement portal", "vendor portal", "submit through", "send to"
    ])) {
      return { type:"technical", bucket:"TECHNICAL", confidence:0.78, reason:"routing or process response requiring review" };
    }

    if (hasAny(text, [
      "spam", "bulk email", "unsolicited marketing", "phishing"
    ])) {
      return { type:"spam", bucket:"SPAM", confidence:0.9, reason:"spam complaint or classification" };
    }

    return { type:"unknown", bucket:"REVIEW", confidence:0.5, reason:"no high-confidence intent matched" };
  }

  async routeAction(reply, classification) {
    const lead = reply?.lead || { email:reply?.email || null };
    const route = { stage:null, actions:[] };

    switch (classification.type) {
      case "interested":
        route.stage = "HOT_LEAD";
        route.actions.push(await this.updateCRM(lead, route.stage));
        route.actions.push(await this.notify(lead, "Thanks for your interest — we’ll follow up shortly."));
        break;

      case "meeting":
        route.stage = "MEETING_REQUESTED";
        route.actions.push(await this.updateCRM(lead, route.stage));
        route.actions.push(await this.triggerBookingFlow(lead));
        break;

      case "notNow":
        route.stage = "NURTURE";
        route.actions.push(await this.updateCRM(lead, route.stage));
        route.actions.push(await this.scheduleFollowUp(lead));
        break;

      case "notInterested":
        route.stage = "DO_NOT_CONTACT";
        route.actions.push(await this.updateCRM(lead, route.stage));
        break;

      case "outOfOffice":
        route.stage = "OUT_OF_OFFICE";
        route.actions.push(await this.updateCRM(lead, route.stage));
        break;

      case "technical":
        route.stage = "TECHNICAL_REVIEW";
        route.actions.push(await this.updateCRM(lead, route.stage));
        break;

      case "spam":
        route.stage = "SPAM";
        route.actions.push(await this.updateCRM(lead, route.stage));
        break;

      default:
        route.stage = "REVIEW_QUEUE";
        route.actions.push(await this.updateCRM(lead, route.stage));
        break;
    }

    route.actions = route.actions.filter(Boolean);
    route.executedActions = route.actions.filter(action => action.executed === true).length;
    return route;
  }

  async updateCRM(lead, stage) {
    if (!this.connectors?.crm?.update) return { action:"CRM_UPDATE", stage, executed:false, reason:"CRM connector unavailable" };
    const result = await this.connectors.crm.update({ stage, target:lead });
    return { action:"CRM_UPDATE", stage, executed:true, result };
  }

  async triggerBookingFlow(lead) {
    if (this.connectors?.booking?.request) {
      const result = await this.connectors.booking.request({ lead, action:"CREATE_MEETING_LINK" });
      return { action:"BOOKING_FLOW", executed:true, result };
    }
    if (this.connectors?.webhook?.send) {
      const result = await this.connectors.webhook.send({ url:"BOOKING_TRIGGER", payload:{ lead, action:"CREATE_MEETING_LINK" } });
      return { action:"BOOKING_FLOW", executed:true, result };
    }
    return { action:"BOOKING_FLOW", executed:false, reason:"booking connector unavailable" };
  }

  async scheduleFollowUp(lead) {
    if (!this.connectors?.instantly?.run) return { action:"NURTURE_SEQUENCE", executed:false, reason:"Instantly routing connector unavailable" };
    const result = await this.connectors.instantly.run({ campaign:"NURTURE_SEQUENCE", target:lead });
    return { action:"NURTURE_SEQUENCE", executed:true, result };
  }

  async notify(lead, message) {
    if (!this.connectors?.email?.send) return { action:"POSITIVE_REPLY_ACKNOWLEDGEMENT", executed:false, reason:"email connector unavailable" };
    const result = await this.connectors.email.send({ to:lead.email, subject:"Re: Your request", body:message });
    return { action:"POSITIVE_REPLY_ACKNOWLEDGEMENT", executed:true, result };
  }
}

module.exports = ReplyIntelligenceEngine;
