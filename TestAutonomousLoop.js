const loop = require("./CORE/AutonomousLoop");

async function main() {
    console.log("");
    console.log("===== AUTONOMOUS LOOP TEST =====");

    const result = await loop.start({
        intervalMs: 10000,
        executionLimit: 3,
        maxCycles: 1
    });

    console.log("");
    console.log("===== LOOP RESULT =====");
    console.log(JSON.stringify(result, null, 2));
    console.log("");
    console.log("Saved:");
    console.log("DATA/loop/autonomous_loop_report.json");
}

main().catch(console.error);