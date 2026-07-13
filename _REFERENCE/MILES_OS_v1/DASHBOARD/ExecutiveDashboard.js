const registry = require("../CORE/Kernel/ServiceRegistry");
const taskEngine = require("../TASK_QUEUE/Engine/TaskEngine");
const orion = require("../CONNECTORS/ORION/OrionConnector");

function fmt(num) {
    if (num === null || num === undefined) return "Unavailable";
    return Number(num).toLocaleString();
}

class ExecutiveDashboard {
    render() {
        console.clear();

        const orionHealth = orion.health();
        const tasks = taskEngine.listTasks();

        console.log("==================================================");
        console.log("              MILES EXECUTIVE COO");
        console.log("==================================================");
        console.log("");
        console.log("CEO: Kevin");
        console.log("Mode: Digital COO Operations");
        console.log("");

        console.log("System Health");
        console.log("-------------");
        registry.health().forEach(service => {
            console.log(`${service.service.padEnd(20)} ${service.status}`);
        });

        console.log("");
        console.log("ORION Intelligence");
        console.log("------------------");
        console.log(`Status              ${orionHealth.connected ? "Connected" : "Disconnected"}`);
        console.log(`Contractors         ${fmt(orionHealth.contractors)}`);
        console.log(`Buyers              ${fmt(orionHealth.buyers)}`);
        console.log(`Opportunities       ${fmt(orionHealth.opportunities)}`);
        console.log(`Recompetes          ${fmt(orionHealth.recompetes)}`);
        console.log(`Prime Recs          ${fmt(orionHealth.primeRecommendations)}`);
        console.log(`Last Check          ${orionHealth.checkedAt}`);

        console.log("");
        console.log("Other Business Systems");
        console.log("----------------------");
        console.log("Instantly          Waiting for connector");
        console.log("Website            Waiting for connector");
        console.log("Dreamers           Waiting for connector");
        console.log("Google Workspace   Waiting for connector");

        console.log("");
        console.log("Today's Tasks");
        console.log("-------------");

        if (tasks.length === 0) {
            console.log("No active tasks loaded yet.");
        } else {
            tasks.forEach((task, index) => {
                console.log(`${index + 1}. [${task.status}] ${task.title}`);
            });
        }

        console.log("");
        console.log("Executive Recommendations");
        console.log("-------------------------");
        console.log("1. ORION is live. Use it as the first intelligence source.");
        console.log("2. Connect Instantly next for outbound operations.");
        console.log("3. Replace remaining placeholders with live systems.");
        console.log("4. Begin daily COO briefing automation.");

        console.log("");
        console.log("Awaiting CEO approval or next command...");
        console.log("");
    }
}

module.exports = new ExecutiveDashboard();