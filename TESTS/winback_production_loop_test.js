"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const WinBackProductionLoopService = require("../SERVICES/revenue/WinBackProductionLoopService");

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-winback-production-"));
  let campaignInput = null;

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
        seedPath
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
        artifact: "reconstruction.json"
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
    campaign,
    intervalMs: 12345,
    log: () => {}
  });

  const result = await service.runOnce();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, "WINBACK_AUDIENCE_READY_FOR_DRAFT_STAGING");
  assert.strictEqual(result.localHistory.recordsRecovered, 9);
  assert.strictEqual(result.campaignPlan.totalEligible, 8);
  assert.strictEqual(result.nextAction, "REVIEW_RECOVERED_AUDIENCE_THEN_STAGE_WINBACK_DRAFTS");
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
