const executionEngine = require("./CORE/ExecutionEngine");
const taskQueue = require("./CORE/TaskQueue");

async function main() {
    console.log("===== EXECUTION ENGINE STATUS =====");
    console.log(JSON.stringify(executionEngine.status(), null, 2));

    console.log("===== QUEUE TEST WORKFORCE TASK =====");

    const task = taskQueue.add(
        "WORKFORCE_STEP",
        {
            objective: "Create sales pipeline plan for Instantly outbound campaign",
            capability: "sales",
            assignedTo: "Alexis",
            department: "Sales",
            expectedOutput: "sales recommendation",
            verification: "Verify sales output is actionable.",
            system: "MILES",
            action: "Execute workforce sales step"
        },
        90
    );

    console.log(JSON.stringify(task, null, 2));

    console.log("===== RUN NEXT =====");
    console.log(JSON.stringify(await executionEngine.runNext(), null, 2));
}

main().catch(console.error);