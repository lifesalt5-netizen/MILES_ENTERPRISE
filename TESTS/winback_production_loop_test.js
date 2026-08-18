"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const WinBackProductionLoopService = require("../SERVICES/revenue/WinBackProductionLoopService");

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-winback-production-"));
  let campaignInput = null;
  let exporterInput = null;

  const localDiscovery = {
    execute() {
      const seedPath = path.join(root, "DATA", "runtime", "revenue", "winback", "local_history_seed_latest.json");
      fs.mkdirSync(path.dirname(seedPath), { recursive: true });
      fs.writeFileSync(seedPath, JSON.stringify({ records: [] }), "utf8");
      return {
        ok: true,
        status: "LOCAL_HISTORY_RECOVERED",
        roots: ["C:\\P2GC_Intelligence"],
        obsidianVaults: ["C:\\Users\\Kevin\\Documents\\P2GC Vault"],
        filesDiscovered: 22,
        exactTargetFilesFound: ["C:\\P2GC_Intelligence\\companies.xls.xlsx"],
        recordsRecovered: 9,
        confirmedPriorConversationCount: 5,
        reactivationCount: 1,
        reviewCount: 3,
        seedPath,
        records: []
      };
    }
  };

  const reconstruction = {
    execute() {
      return {
        ok: true,
        status: "WINBACK_CANDIDATES_READY",
        seedCount: 28,
        contactRecordsScanned: 4100,
        priorConversationCount: 6,
        reactivationCount: 2,
        blockedCount: 20,
        priorConversationCandidates: [{ email: "prior@example.com" }],
        reactivationCandidates: [{ email: "reactivate@example.com" }],
        blocked: [{ email: "review@example.com" }],
        artifact: "reconstruction.json"
      };
    }
  };

  const exporter = {
    execute(input) {
      exporterInput = input;
      return {
        ok: true,
        masterCount: 28,
        priorReadyCount: 6,
        reactivationReadyCount: 2,
        reviewCount: 20,
        evidenceEnrichedCount: 7,
        files: {
          master: path.join(root, "WINBACK_MASTER_LATEST.csv"),
          priorReady: path.join(root, "WINBACK_READY_PRIOR_CONVERSATIONS.csv"),
          reactivationReady: path.join(root, "WINBACK_READY_REACTIVATION.csv"),
          review: path.join(root, "WINBACK_REVIEW_QUEUE.csv")
        }
      };
    }
  };

  const campaign = {
    async execute(input) {
      campaignInput = input;
      return {
        ok: true,
        prior: {
          campaignName: "P2GC Win-Back — Prior Conversations",
          audience: { eligibleCount: 6 },
          definition: { messagingStandard: { version: "2026-08-18-cross-generational-v1" } }
        },
        reactivation: {
          campaignName: "P2GC Win-Back — No-Show & Reschedule Reactivation",
          audience: { eligibleCount: 2 }
        },
        artifact: "campaign_plan.json"
      };
    }
  };

  const service = new WinBackProductionLoopService({
    rootDir: root,
    localDiscovery,
    reconstruction,
    exporter,
    campaign,
    intervalMs: 12345,
    log: () => {}
  });

  const result = await service.runOnce();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, "WINBACK_AUDIENCE_READY_FOR_DRAFT_STAGING");
  assert.strictEqual(result.localHistory.recordsRecovered, 9);
  assert.strictEqual(result.campaignPlan.totalEligible, 8);
  assert.strictEqual(result.exports.masterCount, 28);
  assert.strictEqual(result.exports.priorReadyCount, 6);
  assert.strictEqual(result.exports.reactivationReadyCount, 2);
  assert.strictEqual(result.exports.reviewCount, 20);
  assert.strictEqual(result.exports.evidenceEnrichedCount, 7);
  assert.strictEqual(result.nextAction, "REVIEW_WINBACK_MASTER_THEN_STAGE_DRAFTS");
  assert(exporterInput, "master exporter must run");
  assert.strictEqual(exporterInput.reconstruction.priorConversationCount, 6);
  assert.strictEqual(exporterInput.localHistory.recordsRecovered, 9);
  assert(campaignInput, "campaign plan must run");
  assert.strictEqual(campaignInput.apply, false, "production discovery sidecar may not mutate Instantly");
  assert.strictEqual(campaignInput.activate, false, "production discovery sidecar may not activate campaigns");
  assert.strictEqual(result.safety.instantlyMutationRequested, false);
  assert.strictEqual(result.safety.campaignActivationRequested, false);
  assert.strictEqual(result.safety.duplicateCampaignCreationPossibleFromThisLoop, false);
  assert(fs.existsSync(result.artifact), "production artifact should be persisted");

  const start = service.start();
  assert.strictEqual(start.status, "WINBACK_PRODUCTION_LOOP_STARTED");
  assert.strictEqual(start.autonomousActivationAllowed, false);
  const duplicateStart = service.start();
  assert.strictEqual(duplicateStart.status, "WINBACK_PRODUCTION_LOOP_ALREADY_STARTED");
  const stop = service.stop();
  assert.strictEqual(stop.status, "WINBACK_PRODUCTION_LOOP_STOPPED");

  fs.rmSync(root, { recursive: true, force: true });
  process.stdout.write("PASS winback_production_loop_test\n");
}

run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
