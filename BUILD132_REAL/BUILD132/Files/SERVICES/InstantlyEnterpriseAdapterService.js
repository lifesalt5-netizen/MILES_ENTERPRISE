"use strict";

const path = require("path");

class InstantlyEnterpriseAdapterService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..");
    this.providerFactory = options.providerFactory || null;
    this.provider = options.provider || null;
    this.initialized = false;
  }

  loadProviderClass() {
    if (this.providerFactory) return this.providerFactory;
    return require(path.join(this.rootDir, "PROVIDERS", "providers", "InstantlyProvider"));
  }

  getProvider() {
    if (this.provider) return this.provider;
    const ProviderClass = this.loadProviderClass();
    this.provider = new ProviderClass();
    return this.provider;
  }

  async initialize() {
    const provider = this.getProvider();
    if (typeof provider.initialize === "function") {
      await provider.initialize();
    } else if (typeof provider.refresh === "function") {
      await provider.refresh();
    }
    this.initialized = true;
    return this.status();
  }

  async refresh() {
    const provider = this.getProvider();
    if (typeof provider.refresh !== "function") {
      throw new Error("Instantly provider does not expose refresh().");
    }
    await provider.refresh();
    this.initialized = true;
    return this.status();
  }

  status() {
    const provider = this.getProvider();
    return {
      ok: String(provider.status || "").toLowerCase() !== "critical",
      provider: "INSTANTLY",
      adapter: "InstantlyEnterpriseAdapterService",
      initialized: this.initialized,
      status: provider.status || "NotInitialized",
      dataFreshness: provider.dataFreshness || null,
      lastRefresh: provider.lastRefresh || null,
      metrics: provider.metrics || {},
      exceptions: provider.exceptions || [],
      recommendations: provider.recommendations || []
    };
  }

  async listCampaigns() {
    if (!this.initialized) await this.initialize();
    const state = this.status();
    const campaigns = Array.isArray(state.metrics.campaigns)
      ? state.metrics.campaigns
      : [];
    return {
      ok: state.ok,
      provider: "INSTANTLY",
      campaigns,
      total: campaigns.length,
      generatedAt: new Date().toISOString()
    };
  }

  async getCampaign(input = {}) {
    if (!this.initialized) await this.initialize();
    const id = input.id || input.campaignId;
    const name = input.name || input.campaignName;
    const campaigns = (await this.listCampaigns()).campaigns;
    const campaign = campaigns.find((item) =>
      (id && String(item.id) === String(id)) ||
      (name && String(item.name).toLowerCase() === String(name).toLowerCase())
    ) || null;
    return {
      ok: Boolean(campaign),
      provider: "INSTANTLY",
      campaign,
      status: campaign ? "FOUND" : "NOT_FOUND"
    };
  }

  async getCampaignMetrics() {
    if (!this.initialized) await this.initialize();
    const state = this.status();
    return {
      ok: state.ok,
      provider: "INSTANTLY",
      metrics: state.metrics,
      exceptions: state.exceptions,
      recommendations: state.recommendations,
      generatedAt: new Date().toISOString()
    };
  }

  async execute(operation = {}) {
    const action = String(operation.action || operation.operation || "STATUS").toUpperCase();
    if (action === "INITIALIZE") return this.initialize();
    if (action === "REFRESH") return this.refresh();
    if (action === "STATUS" || action === "HEALTH_CHECK") {
      if (!this.initialized) await this.initialize();
      return this.status();
    }
    if (action === "LIST_CAMPAIGNS") return this.listCampaigns();
    if (action === "GET_CAMPAIGN") return this.getCampaign(operation.payload || operation);
    if (action === "GET_CAMPAIGN_METRICS" || action === "GENERATE_CAMPAIGN_REPORT") {
      return this.getCampaignMetrics();
    }
    return {
      ok: false,
      provider: "INSTANTLY",
      status: "UNSUPPORTED_OPERATION",
      action
    };
  }
}

module.exports = InstantlyEnterpriseAdapterService;
