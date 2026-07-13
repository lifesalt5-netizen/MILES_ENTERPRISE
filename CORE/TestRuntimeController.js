const runtime = require("./RuntimeController");

async function main() {

    console.log("");

    console.log("===== RUNTIME STATUS =====");

    const status = await runtime.handle({
        action: "STATUS"
    });

    console.log(
        JSON.stringify(status, null, 2)
    );

    console.log("");

    console.log("===== RUNTIME PLAN =====");

    const plan = await runtime.handle({
        action: "PLAN",
        objective: "Create sales pipeline plan for Instantly outbound campaign",
        context: {
            priority: "HIGH",
            source: "ChatGPT"
        }
    });

    console.log(
        JSON.stringify(plan, null, 2)
    );

}

main().catch(console.error);