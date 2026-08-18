"use strict";

const WinBackCampaignService = require("./WinBackCampaignService");
const messaging = require("../marketing/P2GCEmailMessagingStandard");

const BLUEPRINT_NAME = "Executive Government Growth Blueprint™";
const BLUEPRINT_PRICE = 2500;
const ACCELERATOR_NAME = "Government Growth Accelerator™";
const ACCELERATOR_MRR = 1250;

class WinBackCampaignCrossGenService extends WinBackCampaignService {
  priorConversationSequence() {
    const sequence = [
      {
        day: 1,
        delay: 0,
        subject: "{{first_name}}, quick follow-up on {{company_display}}",
        body: `{{first_name}},\n\nWe spoke in {{prior_month}} about {{prior_topic}}.\n\nI wanted to circle back because P2GC works differently now. Instead of starting with a general service pitch, I can show you a current picture of {{company_display}}—where the federal opportunity is, what may be getting in the way, and the 2–3 actions I would prioritize now.\n\nThat includes current opportunities and recompetes, agency fit, vehicle gaps, competitors/incumbents, and prime or teaming targets.\n\nIf federal growth is still a priority, I can refresh {{company_display}} before we talk.\n\nWorth 15 minutes?\n\nKevin Carter\nPathways 2 Government Contracting`
      },
      {
        day: 4,
        delay: 3,
        subject: "What I would show you first",
        body: `{{first_name}},\n\nA practical example of what has changed at P2GC:\n\nBefore asking you to buy anything, I can put evidence on the screen for {{company_display}}—best-fit agencies, current and forecast opportunities, recompetes, vehicle gaps, competitors/incumbents, and primes worth approaching.\n\nThen we separate what looks attractive from what is actually realistic.\n\nIf you reply with the one federal-growth question you care about most right now, I’ll focus the refresh there.\n\nKevin`
      },
      {
        day: 8,
        delay: 4,
        subject: "A simpler way to restart",
        body: `{{first_name}},\n\nIf timing, budget or uncertainty kept us from moving forward before, I simplified the entry point.\n\nThe ${BLUEPRINT_NAME} is $${BLUEPRINT_PRICE.toLocaleString()}. It gives you the current evidence, the gaps, and a prioritized path before you decide whether ongoing help is worth it.\n\nIf execution support makes sense after that, the ${ACCELERATOR_NAME} starts at $${ACCELERATOR_MRR.toLocaleString()}/month.\n\nNo long setup and no need to repeat our old conversation.\n\nWant me to take another look at {{company_display}}?\n\nKevin`
      },
      {
        day: 14,
        delay: 6,
        subject: "Should I close this out?",
        body: `{{first_name}},\n\nI’ll make this my last note.\n\nI reached back out because we already had a real conversation and P2GC can now give you a much clearer, evidence-backed view of where {{company_display}} can realistically grow.\n\nIf it is still worth revisiting, reply “revisit” and I’ll pick it up from there.\n\nIf not, I’ll close the loop.\n\nKevin`
      }
    ];

    return sequence.map(step => ({ ...step, messagingStandard: messaging.assessMessage(step) }));
  }

  reactivationSequence() {
    const sequence = [
      {
        day: 1,
        delay: 0,
        subject: "Still working on federal growth?",
        body: `{{first_name}},\n\nYou had a federal strategy call scheduled with me in {{prior_month}}, but we never got a chance to connect.\n\nP2GC works differently now. I can come to the call with a current view of {{company_display}}—agency fit, opportunities and recompetes, vehicle gaps, competitors/incumbents, and prime or teaming targets.\n\nYou do not need to prepare anything. I’ll do the homework first.\n\nStill worth 15 minutes?\n\nKevin Carter\nPathways 2 Government Contracting`
      },
      {
        day: 5,
        delay: 4,
        subject: "What you would actually see",
        body: `{{first_name}},\n\nIf we reconnect, I do not want to spend the call giving you generic GovCon advice.\n\nI would rather show you current evidence for {{company_display}} and answer three questions:\n\n1. Where is the realistic federal opportunity?\n2. What is getting in the way?\n3. What should you do next?\n\nThat keeps the conversation practical and lets you decide quickly whether P2GC is useful.\n\nWant me to prepare it?\n\nKevin`
      },
      {
        day: 12,
        delay: 7,
        subject: "Close this out?",
        body: `{{first_name}},\n\nI’ll close the loop after this.\n\nYou tried to connect with P2GC before. If federal growth is still a priority, reply “yes” and I’ll prepare a current look at {{company_display}} before we speak.\n\nIf not, no problem.\n\nKevin`
      }
    ];

    return sequence.map(step => ({ ...step, messagingStandard: messaging.assessMessage(step) }));
  }

  getCampaignDefinition(track) {
    const definition = super.getCampaignDefinition(track);
    return {
      ...definition,
      messagingStandard: messaging.getStandard(),
      sequence: this.sequence(track)
    };
  }
}

module.exports = WinBackCampaignCrossGenService;
module.exports.WinBackCampaignCrossGenService = WinBackCampaignCrossGenService;
