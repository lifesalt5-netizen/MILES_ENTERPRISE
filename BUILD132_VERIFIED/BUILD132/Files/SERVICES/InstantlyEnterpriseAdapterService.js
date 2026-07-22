"use strict";

const path = require("path");

class InstantlyEnterpriseAdapterService {
  constructor(options = {}) {
    this.name = "InstantlyEnterpriseAdapterService";
    this.rootDir = options.rootDir || path.resolve(__dirname, "..");
    this.providerFactory = options.providerFactory || null;
    this.provider = options.provider || null;
    this.initialized = false;
  }

  createProvider() {
    if (this.provider) return this.provider;

    if (this.providerFactory) {
      this.provider = this.providerFactory();
      return this.provider;
    }

    const Provider = require(path.join(
      this.rootDir,
      "PROVIDERS",
      "providers",
      "InstantlyProvider.js"
    ));

    this.provider = new Provider();
    return this.provider;
  }

  async initialize() {
    const provider = this.createProvider();

    if (typeof provider.initialize === "function") {
      await provider.initialize();
    } else if (typeof provider.refresh === "function") {
      await provider.refresh();
    }

    this.initialized = true;
    return this.getState();
  }

  async refresh() {
    const provider = this.createProvider();

    if (typeof provider.refresh !== "function") {
      throw new Error("InstantlyProvider.refresh() is unavailable.");
    }

    await provider.refresh();
    this.initialized = true;
    return this.getState();
  }

  getState() {
    const provider = this.createProvider();

    if (typeof provider.getProviderState === "function") {
      return provider.getProviderState();
    }

    return {
      provider: provider.name || "Instantly",
      status: provider.status || "Unknown",
      lastRefresh: provider.lastRefresh || null,
      dataFreshness: provider.dataFreshness || "Never",
      metrics: provider.metrics || {},
      exceptions: provider.exceptions || [],
      recommendations: provider.recommendations || []
    };
  }

  getCampaigns() {
    const state = this.getState();
    return Array.isArray(state.metrics && state.metrics.campaigns)
      ? state.metrics.campaigns
      : [];
  }

  getActiveCampaigns() {
    const provider = this.createProvider();

    if (typeof provider.getActiveCampaigns === "function") {
      return provider.getActiveCampaigns();
    }

    return this.getCampaigns().filter((campaign) => campaign.status === 1);
  }

  getCampaignByName(name) {
    const provider = this.createProvider();

    if (typeof provider.getCampaignByName === "function") {
      return provider.getCampaignByName(name);
    }

    return this.getCampaigns().find((campaign) => campaign.name === name) || null;
  }

  async shutdown() {
    if (this.provider && typeof this.provider.shutdown === "function") {
      await this.provider.shutdown();
    }

    this.initialized = false;
    return true;
  }
}

module.exports = InstantlyEnterpriseAdapterService;
