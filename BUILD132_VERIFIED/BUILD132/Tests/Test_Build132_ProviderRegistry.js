"use strict";

const assert = require("assert");
const path = require("path");

const root = process.argv[2];
if (!root) throw new Error("MILES root argument is required.");

const registry = require(path.join(root, "SERVICES", "ProviderRegistry.js"));
const instantly = registry.get("INSTANTLY");

assert(instantly, "INSTANTLY registry entry missing.");
assert.strictEqual(instantly.adapterModule, "SERVICES/InstantlyEnterpriseAdapterService.js");
assert.strictEqual(instantly.providerModule, "PROVIDERS/providers/InstantlyProvider.js");
assert(instantly.capabilities.includes("CAMPAIGN_METRICS"));
assert(instantly.actions.includes("INSTANTLY_REFRESH"));
assert.strictEqual(registry.resolve({ objective: "Review Instantly campaign metrics" }).id, "INSTANTLY");

console.log("BUILD 132 PROVIDER REGISTRY TEST PASSED");
