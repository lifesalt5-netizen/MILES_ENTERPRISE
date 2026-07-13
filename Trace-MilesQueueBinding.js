"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

function summarize(item) {
    return {
        id: item?.id || null,
        title: item?.title || null,
        area: item?.area || null,
        status: item?.status || null,
        requiresKevin: item?.requiresKevin,
        executionType: item?.executionType || null,
        relatedProvider: item?.relatedProvider || null,
        source: item?.source || null,
        metadataType:
            item?.metadata?.type ||
            item?.metadata?.exception?.type ||
            item?.metadata?.repair?.type ||
            null
    };
}

function main() {
    const WorkQueueService =
        require("./SERVICES/WorkQueueService");

    const queue = new WorkQueueService();

    const allItems = queue.getAll();
    const pending = queue.getPending();
    const authorized = queue.getAuthorizedPending();
    const escalations = queue.getEscalations();

    const websiteItems = allItems.filter(item =>
        /WebsiteProviderLoadFailure|Repair Website|WebsiteProvider/i.test(
            [
                item?.area,
                item?.title,
                item?.description,
                item?.metadata?.type,
                item?.metadata?.exception?.type,
                item?.metadata?.repair?.type,
                item?.metadata?.repair?.metadata?.exception?.type
            ]
                .filter(Boolean)
                .join(" ")
        )
    );

    const cooPath =
        path.join(
            ROOT,
            "SERVICES",
            "AutonomousCOOLoopService.js"
        );

    const cooSource =
        fs.readFileSync(cooPath, "utf8");

    const queueBindings =
        cooSource
            .split(/\r?\n/)
            .map((line, index) => ({
                line: index + 1,
                text: line.trim()
            }))
            .filter(row =>
                /WorkQueueService|new\s+WorkQueueService|this\.workQueue|workQueue\s*=/.test(
                    row.text
                )
            );

    const report = {
        generatedAt: new Date().toISOString(),
        root: ROOT,

        workQueue: {
            modulePath:
                require.resolve("./SERVICES/WorkQueueService"),

            queuePath:
                queue.queuePath,

            schemaVersion:
                queue.schemaVersion,

            stats:
                queue.getStats(),

            pending:
                pending.map(summarize),

            authorized:
                authorized.map(summarize),

            escalations:
                escalations.map(summarize),

            websiteItems:
                websiteItems.map(summarize)
        },

        autonomousCOO: {
            modulePath:
                require.resolve(
                    "./SERVICES/AutonomousCOOLoopService"
                ),

            queueBindings
        }
    };

    const outputPath =
        path.join(
            ROOT,
            "runtime",
            `MILES_QUEUE_BINDING_TRACE_${Date.now()}.json`
        );

    fs.mkdirSync(
        path.dirname(outputPath),
        { recursive: true }
    );

    fs.writeFileSync(
        outputPath,
        JSON.stringify(report, null, 2),
        "utf8"
    );

    console.log(
        JSON.stringify(report, null, 2)
    );

    console.log("");
    console.log("TRACE_FILE=" + outputPath);
}

main();
