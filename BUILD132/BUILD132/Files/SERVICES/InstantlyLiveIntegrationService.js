"use strict";

const fs = require("fs");
const path = require("path");

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

class InstantlyLiveIntegrationService {
  constructor(options = {}) {
    this.rootDir =
      options.rootDir ||
      process.env.MILES_ROOT ||
      path.resolve(__dirname, "..");

    this.outDir =
      options.outDir ||
      path.join(this.rootDir, "DATA", "instantly_live");

    this.provider = options.provider || this.loadEnterpriseProvider();
    this.legacyController = options.legacyController || null;
    this.actionBridge = options.actionBridge || null;
  }

  loadEnterpriseProvider() {
    const InstantlyProvider = require("../PROVIDERS/providers/InstantlyProvider");
    return new InstantlyProvider();
  }

  loadLegacyController() {
    if (!this.legacyController) {
      this.legacyController = require("./InstantlyLiveProviderController");
    }
    return this.legacyController;
  }

  loadActionBridge() {
    if (!this.actionBridge) {
      this.actionBridge = require("./InstantlyActionBridgeService");
    }
    return this.actionBridge;
  }

  normalizeProviderState() {
    const provider = this.provider;
    const status =
      typeof provider.getStatus === "function"
        ? provider.getStatus()
        : {
            name: provider.name || "Instantly",
            status: provider.status || "Unknown",
            lastRefresh: provider.lastRefresh || null,
            dataFreshness: provider.dataFreshness || null
          };

    const metrics =
      typeof provider.getMetrics === "function"
        ? provider.getMetrics()
        : provider.metrics || {};

    const exceptions =
      typeof provider.getExceptions === "function"
        ? provider.getExceptions()
        : provider.exceptions || [];

    const recommendations =
      typeof provider.getRecommendations === "function"
        ? provider.getRecommendations()
        : provider.recommendations || [];

    return {
      status,
      metrics,
      exceptions,
      recommendations
    };
  }

  async runEnterpriseRead(mode) {
    if (mode === "INITIALIZE" && typeof this.provider.initialize === "function") {
      await this.provider.initialize();
    } else if (typeof this.provider.refresh === "function") {
      await this.provider.refresh();
    }

    const state = this.normalizeProviderState();

    return {
      ok: String(state.status.status || state.status || "").toUpperCase() !== "CRITICAL",
      status: state.status.status || state.status || "UNKNOWN",
      mode,
      provider: "InstantlyProvider",
      sourceSystem: "PROVIDERS/providers/InstantlyProvider.js",
      metrics: state.metrics,
      exceptions: state.exceptions,
      recommendations: state.recommendations
    };
  }

  async run(input = {}) {
    const startedAt = Date.now();
    const mode = String(input.mode || input.operation || "HEALTH_CHECK").toUpperCase();

    const enterpriseReadModes = new Set([
      "HEALTH_CHECK",
      "ASSESS",
      "ASSESSMENT",
      "REFRESH",
      "INITIALIZE",
      "LIST_CAMPAIGNS",
      "CAMPAIGN_METRICS"
    ]);

    let result;
    let executionPath;

    if (mode === "BRIDGE_LATEST_ACTION") {
      result = await this.loadActionBridge().runLatestActionEngineInstantlyAction();
      executionPath = "LEGACY_ACTION_BRIDGE";
    } else if (enterpriseReadModes.has(mode)) {
      result = await this.runEnterpriseRead(mode);
      executionPath = "ENTERPRISE_INSTANTLY_PROVIDER";
    } else {
      result = await this.loadLegacyController().execute({
        operation: mode,
        payload: input.payload || {}
      });
      executionPath = "LEGACY_GUARDED_CONTROLLER";
    }

    const providerState = this.normalizeProviderState();
    const state = {
      ok: Boolean(result && result.ok !== false),
      action: "INSTANTLY_LIVE_INTEGRATION",
      type: "MILES_INSTANTLY_LIVE_STATE",
      build: "BUILD132",
      generatedAt: now(),
      durationMs: Date.now() - startedAt,
      executionPath,
      result,
      providerState,
      summary: {
        provider: "InstantlyProvider",
        providerStatus: providerState.status.status || providerState.status || null,
        totalCampaigns: Number(providerState.metrics.totalCampaigns || 0),
        activeCampaigns: Number(providerState.metrics.activeCampaigns || 0),
        pausedCampaigns: Number(providerState.metrics.pausedCampaigns || 0),
        exceptionCount: providerState.exceptions.length,
        recommendationCount: providerState.recommendations.length,
        resultStatus: result.status || result.summary?.status || null
      },
      outDir: this.outDir
    };

    writeJson(path.join(this.outDir, "instantly_live_state.json"), state);
    writeJson(path.join(this.outDir, "latest_instantly_live_run.json"), state);
    fs.writeFileSync(
      path.join(this.outDir, "instantly_live_report.md"),
      this.renderReport(state),
      "utf8"
    );

    return state;
  }

  renderReport(state) {
    return `# BUILD132 Instantly Live Integration Report\n\nGenerated: ${state.generatedAt}\nExecution Path: ${state.executionPath}\nProvider Status: ${state.summary.providerStatus}\nTotal Campaigns: ${state.summary.totalCampaigns}\nActive Campaigns: ${state.summary.activeCampaigns}\nPaused Campaigns: ${state.summary.pausedCampaigns}\nExceptions: ${state.summary.exceptionCount}\nRecommendations: ${state.summary.recommendationCount}\n`;
  }
}

const singleton = new InstantlyLiveIntegrationService();
singleton.InstantlyLiveIntegrationService = InstantlyLiveIntegrationService;

module.exports = singleton;
