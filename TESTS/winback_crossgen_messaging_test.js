"use strict";

const assert = require("assert");
const messaging = require("../SERVICES/marketing/P2GCEmailMessagingStandard");
const WinBackCampaignCrossGenService = require("../SERVICES/revenue/WinBackCampaignCrossGenService");

function run() {
  const service = new WinBackCampaignCrossGenService({ rootDir: require("path").resolve(__dirname, "..") });

  const prior = service.priorConversationSequence();
  const reactivation = service.reactivationSequence();

  assert.strictEqual(prior.length, 4, "prior-conversation cadence should remain four touches");
  assert.strictEqual(reactivation.length, 3, "reactivation cadence should remain three touches");

  for (const step of [...prior, ...reactivation]) {
    const assessment = messaging.assessMessage(step);
    assert.strictEqual(assessment.ok, true, `message standard failed: ${assessment.findings.join(",")}`);
    assert(step.body.length < 2200, "emails must remain first-screen oriented and concise");
    assert(!/boomer|millennial|gen[ -]?x|gen[ -]?z/i.test(step.body), "prospect email may not use generation labels");
    assert(!/guaranteed|10x|act now|limited time/i.test(step.body), "prospect email may not use hype/fake urgency");
  }

  assert(/We spoke in \{\{prior_month\}\}/.test(prior[0].body), "prior-conversation copy must preserve factual relationship context");
  assert(/never got a chance to connect/.test(reactivation[0].body), "reactivation copy must not claim a conversation happened");
  assert(!/We spoke/.test(reactivation[0].body), "no-show copy may not say 'we spoke'");
  assert(/current picture|current view|current evidence/i.test(prior[0].body + prior[1].body), "copy should foreground current evidence");
  assert(/15 minutes|reply “revisit”|Want me to take another look/.test(prior.map(item => item.body).join("\n")), "copy should use low-friction CTAs");

  const definition = service.getCampaignDefinition("PRIOR_CONVERSATION");
  assert.strictEqual(definition.messagingStandard.version, messaging.STANDARD_VERSION);
  assert.strictEqual(definition.messagingStandard.buyerRule.includes("Do not infer or target age/generation"), true);
  assert(definition.messagingStandard.prohibited.includes("GENERATIONAL_STEREOTYPE_PERSONALIZATION"));
  assert.strictEqual(definition.safeguards.noShowTrackClaimsPriorConversation, false);

  process.stdout.write("PASS winback_crossgen_messaging_test\n");
}

run();
