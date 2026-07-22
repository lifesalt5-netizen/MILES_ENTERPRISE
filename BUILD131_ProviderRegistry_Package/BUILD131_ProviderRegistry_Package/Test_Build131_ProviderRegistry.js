"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const ProviderRegistry = require(path.join(root, "SERVICES", "ProviderRegistry"));

const requiredProviders = [
  "MILES", "ORION", "INSTANTLY", "GOOGLE", "GMAIL",
  "GOOGLE_CALENDAR", "NAMECHEAP", "B12", "LINKEDIN",
  "WEBSITE", "MARKETING", "SALES", "DREAMERS", "EXECUTIVE"
];

for (const id of requiredProviders) {
  assert(ProviderRegistry.get(id), `Missing provider: ${id}`);
}

assert.strictEqual(
  ProviderRegistry.resolve({ provider: "INSTANTLY" }).id,
  "INSTANTLY"
);

assert.strictEqual(
  ProviderRegistry.resolve({ objective: "Review Instantly campaign replies" }).id,
  "INSTANTLY"
);

assert.strictEqual(
  ProviderRegistry.resolve({ objective: "Review ORION recompetes" }).id,
  "ORION"
);

assert.strictEqual(
  ProviderRegistry.resolve({ objective: "Review sales pipeline proposals" }).id,
  "SALES"
);

assert.strictEqual(
  ProviderRegistry.resolve({ objective: "Internal operating review" }).id,
  "MILES"
);

console.log("BUILD 131 PROVIDER REGISTRY TEST PASSED");
