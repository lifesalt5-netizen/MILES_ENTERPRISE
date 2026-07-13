"use strict";

require("dotenv").config();

const WorkQueueService = require("../SERVICES/WorkQueueService");

const queue = new WorkQueueService();
let changed = 0;

for (const item of queue.getAll()) {
    const text = [
        item.area,
        item.title,
        item.description,
        item.metadata?.type,
        item.metadata?.exception?.type
    ]
        .filter(Boolean)
        .join(" ");

    if (!/WebsiteProviderLoadFailure|Repair Website|WebsiteProvider/i.test(text)) {
        continue;
    }

    const protectedAction =
        /delete|pricing|price|contract|legal|publish|dns|domain|payment|hire|fire|sign|agreement|financial commitment/i.test(
            text
        );

    if (protectedAction) {
        continue;
    }

    const wasChanged =
        item.requiresKevin !== false ||
        item.executionType !== "WORKFLOW" ||
        item.status === "Awaiting Approval";

    item.requiresKevin = false;
    item.executionType = "WORKFLOW";

    if (item.status === "Awaiting Approval") {
        item.status = "Pending";
    }

    item.updatedAt = new Date().toISOString();
    item.metadata = {
        ...(item.metadata || {}),
        governanceClassification: {
            source: "Replace-WorkQueueService.ps1",
            reason:
                "Website provider diagnosis and repair is an autonomous operational workflow.",
            classifiedAt: new Date().toISOString()
        }
    };

    if (wasChanged) {
        queue.addLifecycle(
            item,
            item.status,
            "Reclassified as autonomous operational website repair."
        );

        changed++;
        console.log("[GOVERNANCE] Reclassified:", item.id, item.title);
    }
}

queue.save();

console.log("[GOVERNANCE] Changed:", changed);
console.log("[GOVERNANCE] Stats:", JSON.stringify(queue.getStats(), null, 2));

if (queue.getAuthorizedPending().length === 0) {
    console.error(
        "[GOVERNANCE] No authorized pending work exists after reclassification."
    );

    process.exitCode = 2;
}