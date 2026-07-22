"use strict";

const fs = require("fs");
const path = require("path");

const root = process.argv[2];
if (!root) throw new Error("MILES root argument is required.");

const registryFile = path.join(root, "SERVICES", "ProviderRegistry.js");
if (!fs.existsSync(registryFile)) {
  throw new Error(`Missing required file: ${registryFile}`);
}

let source = fs.readFileSync(registryFile, "utf8");

const instantlyBlockPattern = /        this\.register\(\{\r?\n            id: "INSTANTLY",\r?\n            department: "Sales",\r?\n            connector: "INSTANTLY",\r?\n            capabilities: \["OUTBOUND_EMAIL"\]\r?\n        \}\);/;

const newBlock = `        this.register({
            id: "INSTANTLY",
            department: "Sales",
            connector: "INSTANTLY",
            adapterModule: "SERVICES/InstantlyEnterpriseAdapterService.js",
            providerModule: "PROVIDERS/providers/InstantlyProvider.js",
            capabilities: [
                "OUTBOUND_EMAIL",
                "CAMPAIGN_INVENTORY",
                "CAMPAIGN_METRICS",
                "CAMPAIGN_EXCEPTIONS",
                "CAMPAIGN_RECOMMENDATIONS"
            ],
            actions: [
                "INSTANTLY_REFRESH",
                "INSTANTLY_LIST_CAMPAIGNS",
                "INSTANTLY_GET_CAMPAIGN",
                "INSTANTLY_GET_ACTIVE_CAMPAIGNS"
            ]
        });`;

let changed = false;

if (source.includes('adapterModule: "SERVICES/InstantlyEnterpriseAdapterService.js"')) {
  console.log("[PATCH] ProviderRegistry already contains BUILD132 metadata.");
} else if (instantlyBlockPattern.test(source)) {
  source = source.replace(instantlyBlockPattern, newBlock);
  fs.writeFileSync(registryFile, source, "utf8");
  changed = true;
  console.log("[PATCH] ProviderRegistry Instantly registration upgraded.");
} else {
  throw new Error("Expected INSTANTLY provider registration block was not found.");
}

console.log(JSON.stringify({ ok: true, changed }, null, 2));
