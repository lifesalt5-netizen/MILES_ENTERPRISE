"use strict";
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || process.cwd();
const registryFile = path.join(root, "SERVICES", "ProviderRegistry.js");
if (!fs.existsSync(registryFile)) throw new Error(`Missing ${registryFile}`);
let source = fs.readFileSync(registryFile, "utf8").replace(/^\uFEFF/, "");

const marker = 'capabilities: ["OUTBOUND_EMAIL"]';
if (!source.includes(marker)) throw new Error("INSTANTLY registry marker not found.");
if (!source.includes('adapterModule: "InstantlyEnterpriseAdapterService"')) {
  source = source.replace(marker, `${marker},\n            adapterModule: "InstantlyEnterpriseAdapterService",\n            implementationModule: "PROVIDERS/providers/InstantlyProvider",\n            actions: ["INITIALIZE", "REFRESH", "STATUS", "HEALTH_CHECK", "LIST_CAMPAIGNS", "GET_CAMPAIGN", "GET_CAMPAIGN_METRICS", "GENERATE_CAMPAIGN_REPORT"]`);
}
fs.writeFileSync(registryFile, source, "utf8");
console.log("ProviderRegistry patched for Instantly enterprise adapter.");
