"use strict";

const fs = require("fs");
const ConfigService = require("./ConfigService");

class AssetRegistry {

    constructor() {
        this.file = ConfigService.getRuntimePath("asset_registry.json");
    }

    load() {
        if (!fs.existsSync(this.file))
            return {};

        return JSON.parse(
            fs.readFileSync(this.file, "utf8")
        );
    }

    getAll() {
        return this.load();
    }

    getAsset(name) {
        return this.load()[name] || null;
    }

    getHealthyAssets() {

        return Object.entries(this.load())
            .filter(([_, asset]) => asset.status === "healthy")
            .map(([name]) => name);

    }

    getAssetsByType(type) {

        return Object.entries(this.load())
            .filter(([_, asset]) => asset.type === type)
            .map(([name]) => name);

    }

}

module.exports = new AssetRegistry();