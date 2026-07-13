"use strict";

const ConfigService = require("./ConfigService");
const CapabilityRegistry = require("./CapabilityRegistry");
const AssetRegistry = require("./AssetRegistry");

class ExecutiveEnvironmentService {
    summarize() {
        const config = ConfigService.describe();
        const capabilities = CapabilityRegistry.getAll();
        const assets = AssetRegistry.getAll();

        return {
            ok: true,
            generatedAt: new Date().toISOString(),
            environment: config,
            capabilityCount: Object.keys(capabilities).length,
            assetCount: Object.keys(assets).length,
            healthyAssets: AssetRegistry.getHealthyAssets(),
            cloudAssets: AssetRegistry.getAssetsByType("cloud"),
            services: Object.keys(capabilities),
            assets: Object.keys(assets)
        };
    }
}

module.exports = new ExecutiveEnvironmentService();