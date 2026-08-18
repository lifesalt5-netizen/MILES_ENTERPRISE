"use strict";

const assert = require("assert");
const os = require("os");
const path = require("path");
const CaptureCapacityCampaignService = require("../SERVICES/revenue/CaptureCapacityCampaignService");
const { constants } = require("../SERVICES/revenue/CaptureCapacityCampaignService");

function goodLead(overrides = {}) {
  return {
    email: "alex@example.com",
    first_name: "Alex",
    company: "Example Federal",
    vehicle_or_market: "GSA MAS / DHS",
    specific_company_problem_or_vehicle: "its expanding DHS pipeline and GSA MAS pursuits",
    specific_capture_problem: "adding capture research capacity while senior leaders focus on shaping",
    triggers: [
      {
        type: "CAPTURE_HIRING",
        evidence: "hiring a Capture Manager to support federal growth",
        source: "company careers page"
      }
    ],
    ...overrides
  };
}

(async () => {
  const fakeCalls = [];
  const fakeConnector = {
    async execute(task) {
      fakeCalls.push(task);
      if (task.action === "createCampaign") return { ok: true, result: { id: "campaign-123" } };
      if (task.action === "uploadLeads") return { ok: true, uploaded: task.payload.leads.length };
      if (task.action === "activateCampaign") return { ok: true, result: { status: "active" } };
      return { ok: false };
    }
  };

  const service = new CaptureCapacityCampaignService({
    connector: fakeConnector,
    rootDir: path.join(os.tmpdir(), "miles-capture-capacity-test"),
    generatedAt: () => "2026-08-18T18:53:00.000Z"
  });

  const qualified = service.qualifyLead(goodLead());
  assert.equal(qualified.eligible, true);
  assert.equal(qualified.score, 5);
  assert.equal(qualified.personalization.specific_current_need, "hiring a Capture Manager to support federal growth");

  const noTrigger = service.qualifyLead(goodLead({ triggers: [] }));
  assert.equal(noTrigger.eligible, false);
  assert(noTrigger.blockers.includes("EVIDENCE_BACKED_CAPTURE_TRIGGER_REQUIRED"));

  const missingPersonalization = service.qualifyLead(goodLead({ vehicle_or_market: "", specific_company_problem_or_vehicle: "" }));
  assert.equal(missingPersonalization.eligible, false);
  assert(missingPersonalization.blockers.includes("PERSONALIZATION_REQUIRED:vehicle_or_market"));

  const suppressed = service.qualifyLead(goodLead({ status: "UNSUBSCRIBED" }));
  assert.equal(suppressed.eligible, false);
  assert(suppressed.blockers.includes("SUPPRESSED_STATUS:UNSUBSCRIBED"));

  const payload = service.buildCampaignPayload();
  const steps = payload.sequences[0].steps;
  assert.deepEqual(steps.map(step => step.delay), [2, 3, 4, 0]);
  assert.equal(payload.stop_on_reply, true);
  assert.equal(payload.stop_on_auto_reply, true);
  assert.equal(payload.open_tracking, false);
  assert.equal(payload.link_tracking, false);
  assert(steps[0].variants[0].body.includes("P2GC Capture Intelligence Sprint™"));
  assert(steps[0].variants[0].body.includes("$2,500"));
  assert(steps[0].variants[0].body.includes("$5,000/month"));

  const plan = await service.execute({ candidates: [goodLead()], writeReport: false });
  assert.equal(plan.status, "READY");
  assert.equal(plan.campaignCreated, false);
  assert.equal(fakeCalls.length, 0);

  const applied = await service.execute({ candidates: [goodLead()], apply: true, writeReport: false });
  assert.equal(applied.status, "CAMPAIGN_PREPARED_DRAFT");
  assert.equal(applied.campaignCreated, true);
  assert.equal(applied.leadsUploaded, 1);
  assert.equal(applied.campaignActivated, false);
  assert.equal(fakeCalls[0].action, "createCampaign");
  assert.equal(fakeCalls[1].action, "uploadLeads");
  assert.equal(fakeCalls[1].payload.leads[0].custom_variables.company, "Example Federal");
  assert.equal(fakeCalls[1].payload.leads[0].custom_variables.capture_trigger_type, "CAPTURE_HIRING");

  const deniedActivation = await service.execute({
    candidates: [goodLead()],
    apply: true,
    activate: true,
    writeReport: false
  });
  assert.equal(deniedActivation.status, "ACTIVATION_APPROVAL_REQUIRED");
  assert.equal(deniedActivation.activationRequired, `ACTIVATE:${constants.CAMPAIGN_KEY}`);

  const activated = await service.execute({
    candidates: [goodLead()],
    apply: true,
    activate: true,
    activationApproval: `ACTIVATE:${constants.CAMPAIGN_KEY}`,
    writeReport: false
  });
  assert.equal(activated.status, "CAMPAIGN_ACTIVATED");
  assert.equal(activated.campaignActivated, true);

  const funnel = service.summarizeFunnel([
    { stage: "TARGETED" },
    { stage: "ENROLLED" },
    { stage: "REPLIED_POSITIVE" },
    { stage: "MEETING_BOOKED" },
    { stage: "SPRINT_WON" },
    { stage: "DESK_WON" }
  ]);
  assert.equal(funnel.sprintRevenue, 2500);
  assert.equal(funnel.deskMrr, 5000);
  assert.equal(funnel.conversions.sprintToDeskPct, 100);

  const many = Array.from({ length: 2005 }, (_, i) => goodLead({ email: `lead${i}@example.com` }));
  const audience = service.prepareAudience(many);
  assert.equal(audience.eligibleCount, 2000);
  assert.equal(audience.capped, true);

  console.log("PASS capture_capacity_campaign_test");
})();
