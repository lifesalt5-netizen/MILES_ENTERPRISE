"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-build132-"));
  const modulePath = path.resolve(__dirname, "..", "Files", "SERVICES", "InstantlyLiveIntegrationService.js");

  // Load source as a class without invoking its repository-relative default provider.
  let source = fs.readFileSync(modulePath, "utf8");
  source = source.replace(
    "const singleton = new InstantlyLiveIntegrationService();",
    "const singleton = Object.create(InstantlyLiveIntegrationService.prototype);"
  );
  const tempModule = path.join(root, "InstantlyLiveIntegrationService.js");
  fs.writeFileSync(tempModule, source, "utf8");
  const exported = require(tempModule);
  const Service = exported.InstantlyLiveIntegrationService;

  const fakeProvider = {
    name: "Instantly",
    status: "Healthy",
    lastRefresh: null,
    dataFreshness: null,
    metrics: {},
    exceptions: [],
    recommendations: [],
    async refresh() {
      this.status = "Healthy";
      this.lastRefresh = new Date().toISOString();
      this.dataFreshness = "Live";
      this.metrics = { totalCampaigns: 4, activeCampaigns: 2, pausedCampaigns: 2, campaigns: [] };
      this.exceptions = [];
      this.recommendations = ["Maintain campaign monitoring."];
    }
  };

  const service = new Service({ rootDir: root, provider: fakeProvider });
  const result = await service.run({ mode: "HEALTH_CHECK" });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.build, "BUILD132");
  assert.strictEqual(result.executionPath, "ENTERPRISE_INSTANTLY_PROVIDER");
  assert.strictEqual(result.summary.totalCampaigns, 4);
  assert.strictEqual(result.summary.activeCampaigns, 2);
  assert.ok(fs.existsSync(path.join(root, "DATA", "instantly_live", "instantly_live_state.json")));

  const mutationProvider = { ...fakeProvider };
  const service2 = new Service({
    rootDir: root,
    provider: mutationProvider,
    legacyController: {
      async execute(input) { return { ok: true, status: "DRY_RUN", input }; }
    }
  });
  const mutation = await service2.run({ mode: "PAUSE_CAMPAIGN", payload: { id: "abc" } });
  assert.strictEqual(mutation.executionPath, "LEGACY_GUARDED_CONTROLLER");
  assert.strictEqual(mutation.result.status, "DRY_RUN");

  console.log("BUILD132 TESTS PASSED");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
