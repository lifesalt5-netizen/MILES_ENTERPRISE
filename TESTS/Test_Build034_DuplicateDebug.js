"use strict";

const WorkQueueService = require("../SERVICES/WorkQueueService");
const q = new WorkQueueService();

const a = q.createWorkItem({
    area: "Website",
    relatedProvider: "WebsiteProvider",
    title: "Prepare repairs for 1 broken internal link(s)",
    recommendedAction: "Review website broken links and prepare an approved repair plan",
    requiresKevin: false
});

const b = q.createWorkItem({
    area: "Website",
    relatedProvider: "WebsiteProvider",
    title: "Prepare repairs for 8 broken internal link(s)",
    recommendedAction: "Review website broken links and prepare an approved repair plan",
    requiresKevin: false
});

console.log("\nFIRST");
console.log({
    id: a.id,
    signature: a.signature,
    duplicateDetected: a.duplicateDetected,
    status: a.status
});

console.log("\nSECOND");
console.log({
    id: b.id,
    signature: b.signature,
    duplicateDetected: b.duplicateDetected,
    status: b.status
});

const matches = q.queue.filter(i => i.signature === a.signature);

console.log("\nMATCHES");
console.log(matches.map(i => ({
    id: i.id,
    status: i.status,
    duplicateDetected: i.duplicateDetected
})));