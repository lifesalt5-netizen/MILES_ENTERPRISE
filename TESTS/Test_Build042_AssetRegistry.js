"use strict";

const Assets =
    require("../SERVICES/AssetRegistry");

console.log("\n=== BUILD 042 Asset Registry ===\n");

const registry = Assets.getAll();

console.log(
    "Assets:",
    Object.keys(registry).length
);

console.log();

console.log(
    "ORION:",
    Assets.getAsset("ORION")
);

console.log();

console.log(
    "Healthy Assets:",
    Assets.getHealthyAssets()
);

console.log();

console.log(
    "Cloud Assets:",
    Assets.getAssetsByType("cloud")
);

console.log("\nPASS\n");