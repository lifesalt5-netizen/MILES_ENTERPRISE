"use strict";
const assert = require("assert");
const path = require("path");
const root = process.argv[2] || process.cwd();
const Adapter = require(path.join(root, "SERVICES", "InstantlyEnterpriseAdapterService"));
const ProviderRegistry = require(path.join(root, "SERVICES", "ProviderRegistry"));

class FakeProvider {
  constructor() { this.status = "NotInitialized"; this.metrics = {}; this.exceptions = []; this.recommendations = []; }
  async initialize() {
    this.status = "Healthy";
    this.dataFreshness = "Live";
    this.lastRefresh = new Date().toISOString();
    this.metrics = { totalCampaigns: 2, activeCampaigns: 1, pausedCampaigns: 1, campaigns: [
      { id: "c1", name: "Active Campaign", status: 1 },
      { id: "c2", name: "Paused Campaign", status: 0 }
    ]};
  }
  async refresh() { return this.initialize(); }
}

(async () => {
  const adapter = new Adapter({ providerFactory: FakeProvider, rootDir: root });
  const initialized = await adapter.initialize();
  assert.strictEqual(initialized.ok, true);
  assert.strictEqual(initialized.metrics.totalCampaigns, 2);

  const list = await adapter.execute({ action: "LIST_CAMPAIGNS" });
  assert.strictEqual(list.total, 2);

  const campaign = await adapter.execute({ action: "GET_CAMPAIGN", campaignId: "c1" });
  assert.strictEqual(campaign.ok, true);
  assert.strictEqual(campaign.campaign.name, "Active Campaign");

  const metrics = await adapter.execute({ action: "GET_CAMPAIGN_METRICS" });
  assert.strictEqual(metrics.metrics.activeCampaigns, 1);

  const registry = ProviderRegistry;
  const instantly = registry.get("INSTANTLY");
  assert(instantly, "INSTANTLY registry entry missing");
  assert.strictEqual(instantly.adapterModule, "InstantlyEnterpriseAdapterService");
  assert(instantly.actions.includes("LIST_CAMPAIGNS"));

  const resolved = registry.resolve({ objective: "Review Instantly campaign metrics" });
  assert.strictEqual(resolved.id, "INSTANTLY");

  console.log("BUILD 132 TESTS PASSED");
})().catch((error) => { console.error(error); process.exit(1); });
