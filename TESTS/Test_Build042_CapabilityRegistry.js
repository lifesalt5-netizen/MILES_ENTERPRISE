"use strict";

const Registry =
    require("../SERVICES/CapabilityRegistry");

console.log("\n=== BUILD 042 Capability Registry ===\n");

const registry = Registry.getAll();

console.log(
    "Services Registered:",
    Object.keys(registry).length
);

console.log();

const resolution =
    Registry.getService("ResolutionEngine");

console.log(
    "ResolutionEngine:",
    resolution
);

console.log();

console.log(
    "Capabilities:",
    Registry.getCapabilities("ResolutionEngine")
);

console.log();

const lookup =
    Registry.findByCapability("close_mission");

console.log(
    "Lookup:",
    lookup
);

if (
    lookup.length === 0
) {

    console.log("\nFAIL\n");
    process.exit(1);

}

console.log("\nPASS\n");