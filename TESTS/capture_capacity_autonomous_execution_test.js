"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  CaptureCapacityAutonomousExecutionService
} = require("../SERVICES/revenue/CaptureCapacityAutonomousExecutionService");

function prospect(email = "alex@example.com", evidence = "Hiring a Capture Director for federal growth") {
  return {
    email,
    first_name: "Alex",
    company: "Example Federal",
    specific_current_need: evidence,
    specific_company_problem_or_vehicle: "adding capture capacity while permanent roles are being filled",
    vehicle_or_market: "Federal Civilian",
    specific_capture_problem: "adding capture capacity while permanent roles are being filled",
    triggers: [
      {
        type: "CAPTURE_HIRING",
        evidence,
        source: "https://example.com/careers/capture-director"
      }
    ]
  };
}

class FakeDiscoveryService {
  constructor(candidates) {
    this.candidates = candidates;
  }

  discover() {
    return {
      ok: this.candidates.length > 0,
      candidates: this.candidates,
      artifact: "prospect-feed.json",
      sourceCounts: {
        contactRows: this.candidates.length,
        signalRows: this.candidates.length,
        qualifiedRows: this.candidates.length
      },
      campaignGate: {
        eligibleCount: this.candidates.length,
        blockedCount: 0
      },
      nextAction: this.candidates.length
        ? "READY_FOR_CAPTURE_CAPACITY_CAMPAIGN_HANDOFF"
        : "REFRESH_CAPTURE_CAPACITY_CONTACT_AND_SIGNAL_SOURCES"
    };
  }
}

class FakeCampaignService {
  constructor() {
    this.executeCalls = [];
    this.uploadCalls = [];
  }

  async execute(input) {
    this.executeCalls.push(input);

    if (!input.apply) {
      return {
        ok: true,
        mode: "PLAN_ONLY",
        status: "READY",
        campaignCreated: false,
        campaignActivated: false,
        leadsUploaded: 0,
        artifact: "campaign-plan.json"
      };
    }

    return {
      ok: true,
      mode: "APPLY",
      status: "CAMPAIGN_PREPARED_DRAFT",
      campaignId: "campaign-123",
      campaignName: "P2GC Fractional Capture Intelligence — Trigger Qualified",
      campaignCreated: true,
      campaignActivated: false,
      leadsUploaded: input.candidates.length,
      artifact: "campaign-draft.json"
    };
  }

  prepareAudience(candidates) {
    return {
      eligible: candidates.map(lead => ({
        lead,
        qualification: {
          email: lead.email,
          personalization: {
            first_name: lead.first_name,
            company: lead.company,
            specific_current_need: lead.specific_current_need,
            specific_company_problem_or_vehicle: lead.specific_company_problem_or_vehicle,
            vehicle_or_market: lead.vehicle_or_market,
            specific_capture_problem: lead.specific_capture_problem
          },
          score: 5,
          evidenceBackedTriggers: lead.triggers
        }
      }))
    };
  }

  buildLeadPayload(item, campaignId) {
    return {
      campaign: campaignId,
      email: item.qualification.email
    };
  }

  getConnector() {
    return {
      execute: async task => {
        this.uploadCalls.push(task);
        return {
          ok: true,
          uploaded: task.payload.leads.length
        };
      }
    };
  }
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-capture-auto-"));
  const discovery = new FakeDiscoveryService([prospect()]);
  const campaign = new FakeCampaignService();

  const planOnly = new CaptureCapacityAutonomousExecutionService({
    rootDir: root,
    discoveryService: discovery,
    campaignService: campaign,
    env: {
      CAPTURE_CAPACITY_AUTO_STAGE: "true",
      INSTANTLY_WRITE_ENABLED: "false"
    },
    now: () => new Date("2026-08-18T19:30:00.000Z")
  });

  const planned = await planOnly.execute({
    capability: "revenue.capture_capacity_handoff"
  });

  assert.strictEqual(planned.ok, true);
  assert.strictEqual(planned.status, "READY_WRITE_GATE_DISABLED");
  assert.strictEqual(campaign.executeCalls.length, 1);
  assert.strictEqual(campaign.executeCalls[0].apply, false);
  assert.strictEqual(campaign.executeCalls[0].activate, false);

  campaign.executeCalls.length = 0;

  const liveDraft = new CaptureCapacityAutonomousExecutionService({
    rootDir: root,
    discoveryService: discovery,
    campaignService: campaign,
    env: {
      CAPTURE_CAPACITY_AUTO_STAGE: "true",
      INSTANTLY_WRITE_ENABLED: "true",
      CAPTURE_CAPACITY_ACTIVATION_APPROVAL: "ACTIVATE:P2GC_CAPTURE_CAPACITY_2026Q3"
    },
    now: () => new Date("2026-08-18T19:31:00.000Z")
  });

  const staged = await liveDraft.execute({
    capability: "revenue.capture_capacity_handoff"
  });

  assert.strictEqual(staged.ok, true);
  assert.strictEqual(staged.status, "CAMPAIGN_STAGED_DRAFT");
  assert.strictEqual(staged.policy.autoActivate, false);
  assert.strictEqual(campaign.executeCalls.length, 1);
  assert.strictEqual(campaign.executeCalls[0].apply, true);
  assert.strictEqual(campaign.executeCalls[0].activate, false);
  assert.ok(fs.existsSync(liveDraft.stateFile));

  const repeated = await liveDraft.execute({
    capability: "revenue.capture_capacity_handoff"
  });

  assert.strictEqual(repeated.ok, true);
  assert.strictEqual(repeated.status, "ALREADY_STAGED");
  assert.strictEqual(campaign.executeCalls.length, 1);

  discovery.candidates = [
    prospect(),
    prospect("sam@example.com", "Added a second federal Capture Manager opening")
  ];

  const refreshed = await liveDraft.execute({
    capability: "revenue.capture_capacity_handoff"
  });

  assert.strictEqual(refreshed.ok, true);
  assert.strictEqual(refreshed.status, "EXISTING_DRAFT_REFRESHED");
  assert.strictEqual(campaign.executeCalls.length, 1);
  assert.strictEqual(campaign.uploadCalls.length, 1);
  assert.strictEqual(campaign.uploadCalls[0].action, "uploadLeads");
  assert.strictEqual(campaign.uploadCalls[0].payload.campaignId, "campaign-123");

  discovery.candidates = [];

  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "miles-capture-empty-"));
  const empty = new CaptureCapacityAutonomousExecutionService({
    rootDir: emptyRoot,
    discoveryService: discovery,
    campaignService: new FakeCampaignService(),
    env: {
      CAPTURE_CAPACITY_AUTO_STAGE: "true",
      INSTANTLY_WRITE_ENABLED: "true"
    }
  });

  const noProspects = await empty.execute({
    capability: "revenue.capture_capacity_handoff"
  });

  assert.strictEqual(noProspects.ok, false);
  assert.strictEqual(noProspects.status, "NO_QUALIFIED_PROSPECTS");

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(emptyRoot, { recursive: true, force: true });

  console.log("PASS capture_capacity_autonomous_execution_test");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
