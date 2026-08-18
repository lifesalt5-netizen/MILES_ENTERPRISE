"use strict";

const fs = require("fs");
const path = require("path");
const WinBackLocalHistoryDiscoveryService = require("./WinBackLocalHistoryDiscoveryService");
const WinBackProspectReconstructionService = require("./WinBackProspectReconstructionService");
const WinBackCampaignService = require("./WinBackCampaignCrossGenService");

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class WinBackProductionLoopService {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..")
    );
    this.intervalMs = positiveNumber(options.intervalMs, DEFAULT_INTERVAL_MS);
    this.localDiscovery = options.localDiscovery || null;
    this.reconstruction = options.reconstruction || null;
    this.campaign = options.campaign || null;
    this.timer = null;
    this.started = false;
    this.passRunning = false;
    this.passCount = 0;
    this.reportFile = options.reportFile || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "revenue",
      "winback",
      "production_lane_latest.json"
    );
    this.log = options.log || (message => console.log(`[WIN-BACK] ${message}`));
  }

  getLocalDiscovery() {
    if (!this.localDiscovery) this.localDiscovery = new WinBackLocalHistoryDiscoveryService({ rootDir: this.rootDir });
    return this.localDiscovery;
  }

  getReconstruction(seedPath) {
    if (this.reconstruction) return this.reconstruction;
    return new WinBackProspectReconstructionService({
      rootDir: this.rootDir,
      seedPaths: [
        path.join(this.rootDir, "DATA", "revenue", "winback", "calendly_seed_20260818.json"),
        path.join(this.rootDir, "DATA", "revenue", "winback", "calendar_recovered_seed_20260818.json"),
        seedPath
      ]
    });
  }

  getCampaign() {
    if (!this.campaign) this.campaign = new WinBackCampaignService({ rootDir: this.rootDir });
    return this.campaign;
  }

  writeReport(report) {
    fs.mkdirSync(path.dirname(this.reportFile), { recursive: true });
    const temporary = `${this.reportFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(report, null, 2), "utf8");
    fs.renameSync(temporary, this.reportFile);
    return this.reportFile;
  }

  async runOnce() {
    if (this.passRunning) {
      return {
        ok: true,
        status: "WINBACK_PASS_ALREADY_RUNNING",
        skipped: true,
        generatedAt: new Date().toISOString()
      };
    }

    this.passRunning = true;
    this.passCount += 1;

    try {
      const localHistory = await Promise.resolve(this.getLocalDiscovery().execute({ writeReport: true }));
      const reconstruction = await Promise.resolve(this.getReconstruction(localHistory.seedPath).execute({ writeReport: true }));
      const campaignPlan = await this.getCampaign().execute({
        priorConversationCandidates: reconstruction.priorConversationCandidates || [],
        reactivationCandidates: reconstruction.reactivationCandidates || [],
        apply: false,
        activate: false,
        writeReport: true
      });

      const priorReady = Number(campaignPlan?.prior?.audience?.eligibleCount || 0);
      const reactivationReady = Number(campaignPlan?.reactivation?.audience?.eligibleCount || 0);
      const totalReady = priorReady + reactivationReady;

      const report = {
        ok: Boolean(localHistory?.ok || reconstruction?.ok || totalReady > 0),
        service: "WINBACK_PRODUCTION_LOOP",
        status: totalReady > 0
          ? "WINBACK_AUDIENCE_READY_FOR_DRAFT_STAGING"
          : localHistory?.recordsRecovered > 0
            ? "WINBACK_HISTORY_RECOVERED_ENRICHMENT_OR_REVIEW_REQUIRED"
            : "WINBACK_HISTORY_DISCOVERY_REQUIRED",
        pass: this.passCount,
        intervalMs: this.intervalMs,
        localHistory: {
          status: localHistory?.status || null,
          roots: localHistory?.roots || [],
          obsidianVaults: localHistory?.obsidianVaults || [],
          filesDiscovered: Number(localHistory?.filesDiscovered || 0),
          exactTargetFilesFound: localHistory?.exactTargetFilesFound || [],
          recordsRecovered: Number(localHistory?.recordsRecovered || 0),
          confirmedPriorConversationCount: Number(localHistory?.confirmedPriorConversationCount || 0),
          reactivationCount: Number(localHistory?.reactivationCount || 0),
          reviewCount: Number(localHistory?.reviewCount || 0),
          seedPath: localHistory?.seedPath || null
        },
        reconstruction: {
          status: reconstruction?.status || null,
          seedCount: Number(reconstruction?.seedCount || 0),
          contactRecordsScanned: Number(reconstruction?.contactRecordsScanned || 0),
          priorConversationCount: Number(reconstruction?.priorConversationCount || 0),
          reactivationCount: Number(reconstruction?.reactivationCount || 0),
          blockedCount: Number(reconstruction?.blockedCount || 0),
          artifact: reconstruction?.artifact || null
        },
        campaignPlan: {
          mode: "PLAN_ONLY",
          priorEligible: priorReady,
          reactivationEligible: reactivationReady,
          totalEligible: totalReady,
          priorCampaignName: campaignPlan?.prior?.campaignName || null,
          reactivationCampaignName: campaignPlan?.reactivation?.campaignName || null,
          messagingStandard: campaignPlan?.prior?.definition?.messagingStandard?.version || null,
          artifact: campaignPlan?.artifact || null
        },
        nextAction: totalReady > 0
          ? "REVIEW_RECOVERED_AUDIENCE_THEN_STAGE_WINBACK_DRAFTS"
          : Number(localHistory?.reviewCount || 0) > 0
            ? "VALIDATE_REVIEW_ONLY_HISTORY_RECORDS"
            : "LOCATE_ADDITIONAL_B12_OBSIDIAN_HISTORY_SOURCES",
        safety: {
          localScanReadOnly: true,
          instantlyMutationRequested: false,
          campaignActivationRequested: false,
          productionLoopMayActivateCampaign: false,
          duplicateCampaignCreationPossibleFromThisLoop: false
        },
        generatedAt: new Date().toISOString()
      };

      report.artifact = this.writeReport(report);
      this.log(`${report.status}; recovered=${report.localHistory.recordsRecovered}; eligible=${totalReady}`);
      return report;
    } catch (error) {
      const report = {
        ok: false,
        service: "WINBACK_PRODUCTION_LOOP",
        status: "WINBACK_PRODUCTION_PASS_FAILED",
        pass: this.passCount,
        error: error.stack || error.message,
        safety: {
          localScanReadOnly: true,
          instantlyMutationRequested: false,
          campaignActivationRequested: false,
          productionLoopMayActivateCampaign: false
        },
        generatedAt: new Date().toISOString()
      };
      report.artifact = this.writeReport(report);
      this.log(`${report.status}: ${error.message}`);
      return report;
    } finally {
      this.passRunning = false;
    }
  }

  start() {
    if (this.started) {
      return {
        ok: true,
        status: "WINBACK_PRODUCTION_LOOP_ALREADY_STARTED",
        intervalMs: this.intervalMs
      };
    }

    this.started = true;
    Promise.resolve().then(() => this.runOnce()).catch(error => this.log(`Initial pass failed: ${error.message}`));
    this.timer = setInterval(() => {
      this.runOnce().catch(error => this.log(`Scheduled pass failed: ${error.message}`));
    }, this.intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();

    return {
      ok: true,
      status: "WINBACK_PRODUCTION_LOOP_STARTED",
      intervalMs: this.intervalMs,
      instantlyMutationRequested: false,
      autonomousActivationAllowed: false
    };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    return {
      ok: true,
      status: "WINBACK_PRODUCTION_LOOP_STOPPED"
    };
  }
}

module.exports = WinBackProductionLoopService;
module.exports.WinBackProductionLoopService = WinBackProductionLoopService;
module.exports.DEFAULT_INTERVAL_MS = DEFAULT_INTERVAL_MS;
module.exports.positiveNumber = positiveNumber;
