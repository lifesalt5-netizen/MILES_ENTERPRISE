const ExecutiveIntelligenceService = require("./SERVICES/ExecutiveIntelligenceService");
const WorkQueueService = require("./SERVICES/WorkQueueService");

(async () => {
    const intelligence = new ExecutiveIntelligenceService();

    await intelligence.refresh();

    const executiveState = intelligence.getExecutiveState();

    const workQueue = new WorkQueueService();

    const created = workQueue.generateFromExecutiveState(executiveState);

    console.log("Created / Reused Work Items:");
    console.log(JSON.stringify(created, null, 2));

    console.log("");
    console.log("Queue Stats:");
    console.log(JSON.stringify(workQueue.getStats(), null, 2));

    console.log("");
    console.log("Open Work Queue:");
    console.log(JSON.stringify(workQueue.getOpen(), null, 2));
})();
