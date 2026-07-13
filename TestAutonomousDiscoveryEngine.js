const discovery = require("./CORE/AutonomousDiscoveryEngine");

async function main() {
    console.log("");
    console.log("===== AUTONOMOUS DISCOVERY ENGINE =====");

    console.log("");
    console.log("Status:");
    console.log(JSON.stringify(discovery.status(), null, 2));

    console.log("");
    console.log("Discovery Run:");
    console.log(
        JSON.stringify(
            discovery.discover(),
            null,
            2
        )
    );

    console.log("");
    console.log("Saved:");
    console.log("DATA/discovery/autonomous_discovery_report.json");
}

main().catch(console.error);