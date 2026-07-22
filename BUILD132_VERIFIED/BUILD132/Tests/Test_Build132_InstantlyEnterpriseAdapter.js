"use strict";

const assert = require("assert");
const path = require("path");

const root = process.argv[2];
if (!root) throw new Error("MILES root argument is required.");

const Adapter = require(path.join(
  root,
  "SERVICES",
  "InstantlyEnterpriseAdapterService.js"
));

class FakeProvider {
  constructor() {
    this.name = "Instantly";
    this.status = "Unknown";
    this.lastRefresh = null;
    this.dataFreshness = "Never";
    this.metrics = {};
    this.exceptions = [];
    this.recommendations = [];
  }

  async initialize() {
    return this.refresh();
  }

  async refresh() {
    this.status = "Healthy";
    this.lastRefresh = "2026-07-22T00:00:00.000Z";
    this.dataFreshness = "Live";
    this.metrics = {
      totalCampaigns: 2,
      activeCampaigns: 1,
      pausedCampaigns: 1,
      campaigns: [
        { id: "A", name: "Active Campaign", status: 1 },
        { id: "P", name: "Paused Campaign", status: 0 }
      ]
    };
    this.exceptions = [];
    this.recommendations = ["Maintain active campaign monitoring."];
    return true;
  }

  getProviderState() {
    return {
      provider: this.name,
      status: this.status,
      lastRefresh: this.lastRefresh,
      dataFreshness: this.dataFreshness,
      metrics: this.metrics,
      exceptions: this.exceptions,
      recommendations: this.recommendations
    };
  }

  getActiveCampaigns() {
    return this.metrics.campaigns.filter((campaign) => campaign.status === 1);
  }

  getCampaignByName(name) {
    return this.metrics.campaigns.find((campaign) => campaign.name === name) || null;
  }

  async shutdown() {
    return true;
  }
}

(async () => {
  const adapter = new Adapter({ providerFactory: () => new FakeProvider() });
  const state = await adapter.initialize();

  assert.strictEqual(state.status, "Healthy");
  assert.strictEqual(state.metrics.totalCampaigns, 2);
  assert.strictEqual(adapter.getCampaigns().length, 2);
  assert.strictEqual(adapter.getActiveCampaigns().length, 1);
  assert.strictEqual(adapter.getCampaignByName("Paused Campaign").id, "P");

  await adapter.shutdown();

  console.log("BUILD 132 INSTANTLY ENTERPRISE ADAPTER TEST PASSED");
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
