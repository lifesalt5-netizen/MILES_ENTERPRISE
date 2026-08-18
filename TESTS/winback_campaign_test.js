"use strict";

const assert = require("assert");
const WinBackCampaignService = require("../SERVICES/revenue/WinBackCampaignService");
const { constants } = require("../SERVICES/revenue/WinBackCampaignService");

class MockConnector {
  constructor() {
    this.calls = [];
    this.nextId = 1;
  }

  async execute(input) {
    this.calls.push(input);
    if (input.action === "createCampaign") {
      return { ok: true, result: { id: `campaign-${this.nextId++}` } };
    }
    if (input.action === "uploadLeads") {
      return { ok: true, uploaded: input.payload.leads.length };
    }
    if (input.action === "activateCampaign") {
      return { ok: true, result: { active: true } };
    }
    return { ok: false };
  }
}

function priorLead(overrides = {}) {
  return {
    track: "PRIOR_CONVERSATION",
    relationship_status: "PRIOR_CONVERSATION",
    first_name: "Chokha",
    full_name: "Chokha Palayamkottai",
    email: "chokha@example.com",
    company: "Integralops",
    company_display: "Integralops",
    prior_month: "March 2026",
    prior_topic: "your federal growth strategy",
    meeting_date: "2026-03-18",
    blockers: [],
    ...overrides
  };
}

function reactivationLead(overrides = {}) {
  return {
    track: "REACTIVATION",
    relationship_status: "NO_SHOW",
    first_name: "Jonathan",
    full_name: "Jonathan Evans",
    email: "jonathan@example.com",
    company: "Evans Federal",
    company_display: "Evans Federal",
    prior_month: "March 2026",
    prior_topic: "your federal growth strategy",
    meeting_date: "2026-03-04",
    blockers: [],
    ...overrides
  };
}

async function run() {
  const mock = new MockConnector();
  const service = new WinBackCampaignService({ connector: mock });

  const priorSequence = service.priorConversationSequence();
  const reactivationSequence = service.reactivationSequence();
  assert.strictEqual(priorSequence.length, 4);
  assert.strictEqual(reactivationSequence.length, 3);
  assert(priorSequence[0].body.includes("We spoke in {{prior_month}}"), "prior-conversation copy should acknowledge the real conversation");
  assert(!reactivationSequence[0].body.includes("We spoke"), "no-show copy must never claim a conversation occurred");
  assert(reactivationSequence[0].body.includes("we never got a chance to connect"), "no-show copy should accurately describe the relationship");
  assert(priorSequence[2].body.includes("$2,500"));
  assert(priorSequence[2].body.includes("$1,250/month"));

  const priorQualification = service.qualifyLead(priorLead(), constants.TRACKS.PRIOR_CONVERSATION);
  assert.strictEqual(priorQualification.eligible, true);

  const noShowInPrior = service.qualifyLead(reactivationLead(), constants.TRACKS.PRIOR_CONVERSATION);
  assert.strictEqual(noShowInPrior.eligible, false, "no-show must not enter prior-conversation campaign");
  assert(noShowInPrior.blockers.some(item => item.startsWith("TRACK_MISMATCH") || item.startsWith("PRIOR_CONVERSATION_NOT_CONFIRMED")));

  const noShowQualification = service.qualifyLead(reactivationLead(), constants.TRACKS.REACTIVATION);
  assert.strictEqual(noShowQualification.eligible, true);

  const currentClient = service.qualifyLead(priorLead({ crm_status: "ACTIVE_CLIENT" }), constants.TRACKS.PRIOR_CONVERSATION);
  assert.strictEqual(currentClient.eligible, false);
  assert(currentClient.blockers.some(item => item.startsWith("SUPPRESSED_STATUS:")));

  const unsubscribed = service.qualifyLead(priorLead({ unsubscribed: true }), constants.TRACKS.PRIOR_CONVERSATION);
  assert.strictEqual(unsubscribed.eligible, false);
  assert(unsubscribed.blockers.includes("DO_NOT_CONTACT"));

  const activeProposal = service.qualifyLead(priorLead({ crm_status: "PROPOSAL_SENT" }), constants.TRACKS.PRIOR_CONVERSATION);
  assert.strictEqual(activeProposal.eligible, false, "active deals must not receive a win-back sequence");

  const plan = await service.execute({
    priorConversationCandidates: [priorLead()],
    reactivationCandidates: [reactivationLead()],
    apply: false,
    writeReport: false
  });
  assert.strictEqual(plan.prior.status, "READY");
  assert.strictEqual(plan.reactivation.status, "READY");
  assert.strictEqual(mock.calls.length, 0, "plan mode must not mutate Instantly");

  const apply = await service.execute({
    priorConversationCandidates: [priorLead()],
    reactivationCandidates: [reactivationLead()],
    apply: true,
    activate: false,
    writeReport: false
  });
  assert.strictEqual(apply.prior.status, "CAMPAIGN_PREPARED_DRAFT");
  assert.strictEqual(apply.reactivation.status, "CAMPAIGN_PREPARED_DRAFT");
  assert.strictEqual(apply.prior.campaignActivated, false);
  assert.strictEqual(apply.reactivation.campaignActivated, false);
  assert.strictEqual(apply.prior.leadsUploaded, 1);
  assert.strictEqual(apply.reactivation.leadsUploaded, 1);
  assert.strictEqual(mock.calls.filter(call => call.action === "createCampaign").length, 2);
  assert.strictEqual(mock.calls.filter(call => call.action === "uploadLeads").length, 2);
  assert.strictEqual(mock.calls.filter(call => call.action === "activateCampaign").length, 0);

  const approvalMock = new MockConnector();
  const approvalService = new WinBackCampaignService({ connector: approvalMock });
  const blockedActivation = await approvalService.execute({
    priorConversationCandidates: [priorLead()],
    reactivationCandidates: [],
    apply: true,
    activate: true,
    activationApproval: "WRONG",
    writeReport: false
  });
  assert.strictEqual(blockedActivation.prior.status, "ACTIVATION_APPROVAL_REQUIRED");
  assert.strictEqual(approvalMock.calls.filter(call => call.action === "activateCampaign").length, 0);

  const leadPayload = service.buildLeadPayload({
    lead: priorLead(),
    qualification: priorQualification
  }, "campaign-123", constants.TRACKS.PRIOR_CONVERSATION);
  assert.strictEqual(leadPayload.skip_if_in_workspace, false, "win-back may need to re-enroll a prior workspace lead");
  assert.strictEqual(leadPayload.skip_if_in_campaign, true);
  assert.strictEqual(leadPayload.custom_variables.winback_track, "PRIOR_CONVERSATION");

  process.stdout.write("PASS winback_campaign_test\n");
}

run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
