"use strict";

/**
 * REPLY INTELLIGENCE ENGINE v1
 * - classifies inbound replies
 * - updates CRM stages
 * - triggers follow-up actions
 * - feeds revenue loop
 */

class ReplyIntelligenceEngine {

  constructor({ connectors }) {
    this.connectors = connectors;
  }

  // =========================
  // MAIN ENTRY POINT
  // =========================
  async processReplies(replies = []) {

    const results = {
      timestamp: new Date().toISOString(),
      processed: [],
      summary: {
        interested: 0,
        notNow: 0,
        notInterested: 0,
        meeting: 0,
        spam: 0,
        unknown: 0
      }
    };

    for (const reply of replies) {

      const classification = this.classify(reply);

      results.processed.push({
        reply,
        classification
      });

      await this.routeAction(reply, classification);

      results.summary[classification.type]++;
    }

    return results;
  }

  // =========================
  // CLASSIFICATION ENGINE
  // =========================
  classify(reply) {

    const text = (reply?.text || "").toLowerCase();

    // MEETING INTENT
    if (
      text.includes("schedule") ||
      text.includes("call") ||
      text.includes("meeting") ||
      text.includes("talk")
    ) {
      return { type: "meeting", confidence: 0.85 };
    }

    // INTERESTED
    if (
      text.includes("interested") ||
      text.includes("yes") ||
      text.includes("sounds good") ||
      text.includes("let's do it")
    ) {
      return { type: "interested", confidence: 0.8 };
    }

    // NOT NOW
    if (
      text.includes("not now") ||
      text.includes("later") ||
      text.includes("next month") ||
      text.includes("follow up")
    ) {
      return { type: "notNow", confidence: 0.75 };
    }

    // NOT INTERESTED
    if (
      text.includes("no thanks") ||
      text.includes("not interested") ||
      text.includes("stop")
    ) {
      return { type: "notInterested", confidence: 0.9 };
    }

    // SPAM / AUTO
    if (
      text.includes("unsubscribe") ||
      text.includes("automated") ||
      text.includes("marketing")
    ) {
      return { type: "spam", confidence: 0.85 };
    }

    return { type: "unknown", confidence: 0.5 };
  }

  // =========================
  // ROUTING ENGINE
  // =========================
  async routeAction(reply, classification) {

    const lead = reply.lead || {};

    switch (classification.type) {

      // 🔥 HOT LEAD → CRM + PRIORITY FLAG
      case "interested":

        await this.updateCRM(lead, "HOT_LEAD");

        await this.notify(
          lead,
          "Thanks for your interest — we’ll follow up shortly."
        );

        break;

      // 📅 MEETING REQUEST → BOOKING FLOW
      case "meeting":

        await this.updateCRM(lead, "MEETING_REQUESTED");

        await this.triggerBookingFlow(lead);

        break;

      // 🟡 NURTURE FLOW
      case "notNow":

        await this.updateCRM(lead, "NURTURE");

        await this.scheduleFollowUp(lead);

        break;

      // 🔴 REMOVE FROM ACTIVE OUTREACH
      case "notInterested":

        await this.updateCRM(lead, "DO_NOT_CONTACT");

        break;

      // 🚫 IGNORE / LOG ONLY
      case "spam":

        await this.updateCRM(lead, "SPAM");

        break;

      default:

        await this.updateCRM(lead, "REVIEW_QUEUE");

        break;
    }
  }

  // =========================
  // CRM UPDATE
  // =========================
  async updateCRM(lead, stage) {

    if (!this.connectors?.crm) return;

    return await this.connectors.crm.update({
      stage,
      target: lead
    });
  }

  // =========================
  // BOOKING FLOW (INSTANTLY OR CALENDLY)
  // =========================
  async triggerBookingFlow(lead) {

    if (this.connectors?.webhook) {

      return await this.connectors.webhook.send({
        url: "BOOKING_TRIGGER",
        payload: {
          lead,
          action: "CREATE_MEETING_LINK"
        }
      });
    }
  }

  // =========================
  // FOLLOW-UP SCHEDULER
  // =========================
  async scheduleFollowUp(lead) {

    if (!this.connectors?.instantly) return;

    return await this.connectors.instantly.run({
      campaign: "NURTURE_SEQUENCE",
      target: lead
    });
  }

  // =========================
  // RESPONSE NOTIFIER
  // =========================
  async notify(lead, message) {

    if (!this.connectors?.email) return;

    return await this.connectors.email.send({
      to: lead.email,
      subject: "Re: Your request",
      body: message
    });
  }
}

module.exports = ReplyIntelligenceEngine;