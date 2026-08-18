"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CaptureCapacityProductionLoopService = require("../SERVICES/revenue/CaptureCapacityProductionLoopService");

function handoffDiscovery() {
  return {
    ok: true,
    feed: {
      sourceCounts: {
        contactRows: 20,
        signalRows: 4,
        enrichedRows: 3,
        qualifiedRows: 2
      },
      nextAction: "READY_FOR_CAPTURE_CAPACITY_CAMPAIGN_HANDOFF",
      sourceBootstrap: {
        status: "CONTACT_SOURCES_BOOTSTRAPPED"
      },
      signalBridge: {
        status: "ORION_PUBLIC_SIGNALS_EXPORTED",
        verifiedSignalCount: 4,
        validationQueueCount: 6
      },
      artifact: "prospect-feed.json"
    },
    work: [
      {
        id: "P2GC-CAPTURE-CAPACITY-QUALIFIED-HANDOFF",
        capability: "revenue.capture_capacity_handoff",
        priority: "CRITICAL",
        priorityScore: 100,
        reason: "qualified revenue work",
        metadata: {
          qualifiedRows: 2
        }
      }
    ]
  };
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capture-production-loop-"));
  let executionCalls = 0;

  const discovery = {
    async discover() {
      return handoffDiscovery();
    }
  };

  const execution = {
    async execute(input) {
      executionCalls += 1;
      assert.strictEqual(input.capability, "revenue.capture_capacity_handoff");
      assert.strictEqual(input.workItem.id, "P2GC-CAPTURE-CAPACITY-QUALIFIED-HANDOFF");
      return {
        ok: true,
        status: "CAMPAIGN_STAGED_DRAFT",
        campaignKey: "P2GC_CAPTURE_CAPACITY_2026Q3",
        campaignId: "campaign-123",
        qualifiedCount: 2,
        policy: {
          apply: true,
          autoActivate: false,
          activationPolicy: "NEVER_AUTO_ACTIVATE"
        },
        campaign: {
          status: "CAMPAIGN_PREPARED_DRAFT",
          campaignCreated: true,
          leadsUploaded: 2,
          campaignActivated: false
        },
        stateFile: "capture-capacity-state.json"
      };
    }
  };

  const service = new CaptureCapacityProductionLoopService({
    rootDir: root,
    discovery,
    execution,
    enableExecution: true,
    intervalMs: 300000,
    log: () => {}
  });

  const staged = await service.runOnce();

  assert.strictEqual(staged.ok, true);
  assert.strictEqual(staged.status, "CAMPAIGN_STAGED_DRAFT");
  assert.strictEqual(staged.handoff.qualifiedRows, 2);
  assert.strictEqual(staged.discovery.verifiedOrionSignals, 4);
  assert.strictEqual(staged.discovery.orionValidationQueue, 6);
  assert.strictEqual(staged.execution.campaignId, "campaign-123");
  assert.strictEqual(staged.execution.campaign.campaignActivated, false);
  assert.strictEqual(staged.safety.campaignActivationRequested, false);
  assert.strictEqual(staged.safety.autonomousActivationAllowed, false);
  assert.strictEqual(executionCalls, 1);
  assert.ok(fs.existsSync(staged.artifact));

  const executionDisabled = new CaptureCapacityProductionLoopService({
    rootDir: root,
    discovery,
    execution,
    enableExecution: false,
    log: () => {}
  });

  const disabled = await executionDisabled.runOnce();

  assert.strictEqual(disabled.ok, true);
  assert.strictEqual(disabled.status, "CAPTURE_CAPACITY_EXECUTION_DISABLED");
  assert.strictEqual(disabled.execution, null);
  assert.strictEqual(executionCalls, 1);

  const blockingDiscovery = {
    async discover() {
      return {
        ok: true,
        feed: {
          sourceCounts: {
            contactRows: 20,
            signalRows: 0,
            enrichedRows: 0,
            qualifiedRows: 0
          },
          nextAction: "REFRESH_CAPTURE_CAPACITY_CONTACT_AND_SIGNAL_SOURCES",
          sourceBootstrap: {
            status: "CONTACT_SOURCES_BOOTSTRAPPED"
          },
          signalBridge: {
            status: "ORION_SIGNALS_REQUIRE_PUBLIC_VALIDATION",
            verifiedSignalCount: 0,
            validationQueueCount: 50
          }
        },
        work: [
          {
            id: "P2GC-CAPTURE-CAPACITY-SIGNAL-REFRESH",
            capability: "revenue.capture_capacity_signal_refresh",
            priority: "CRITICAL",
            priorityScore: 98,
            reason: "50 ORION rows require validation",
            metadata: {
              orionValidationQueue: 50
            }
          }
        ]
      };
    }
  };

  const blockedService = new CaptureCapacityProductionLoopService({
    rootDir: root,
    discovery: blockingDiscovery,
    execution,
    enableExecution: true,
    log: () => {}
  });

  const blocked = await blockedService.runOnce();

  assert.strictEqual(blocked.ok, true);
  assert.strictEqual(blocked.status, "revenue.capture_capacity_signal_refresh");
  assert.strictEqual(blocked.execution, null);
  assert.strictEqual(blocked.blockingWork.capability, "revenue.capture_capacity_signal_refresh");
  assert.strictEqual(blocked.discovery.orionValidationQueue, 50);
  assert.strictEqual(executionCalls, 1);

  blockedService.passRunning = true;
  const overlap = await blockedService.runOnce();
  blockedService.passRunning = false;

  assert.strictEqual(overlap.ok, true);
  assert.strictEqual(overlap.status, "CAPTURE_CAPACITY_PASS_ALREADY_RUNNING");
  assert.strictEqual(overlap.skipped, true);

  fs.rmSync(root, { recursive: true, force: true });

  console.log("PASS capture_capacity_production_loop_test");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
