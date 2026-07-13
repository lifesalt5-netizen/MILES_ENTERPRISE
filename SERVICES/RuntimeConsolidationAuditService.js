"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ENTERPRISE_ROOT =
    process.env.MILES_ROOT ||
    process.cwd();

const LEGACY_ROOT =
    "D:\\P2GC_Intelligence\\MILES_OS";

function fileInfo(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return {
                exists: false,
                path: filePath,
                sizeBytes: 0,
                modifiedAt: null
            };
        }

        const stat = fs.statSync(filePath);

        return {
            exists: true,
            path: filePath,
            sizeBytes: stat.size,
            sizeMB: Number((stat.size / 1024 / 1024).toFixed(2)),
            modifiedAt: stat.mtime.toISOString()
        };
    } catch (error) {
        return {
            exists: false,
            path: filePath,
            sizeBytes: 0,
            modifiedAt: null,
            error: error.message
        };
    }
}

function readJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }

        return JSON.parse(
            fs.readFileSync(filePath, "utf8")
        );
    } catch {
        return fallback;
    }
}

function normalizeItems(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (value && Array.isArray(value.items)) {
        return value.items;
    }

    return [];
}

function summarizeQueue(filePath) {
    const queueFile =
        readJson(filePath, { items: [] });

    const items =
        normalizeItems(queueFile);

    const statusCounts = {};

    for (const item of items) {
        const status =
            String(item.status || "UNKNOWN");

        statusCounts[status] =
            (statusCounts[status] || 0) + 1;
    }

    const signatures = new Map();
    let duplicateCandidates = 0;

    for (const item of items) {
        const signature =
            item.signature ||
            [
                item.area,
                item.title,
                item.relatedProvider
            ]
                .map(value => String(value || "").trim())
                .join("::");

        if (!signature.replace(/:/g, "")) {
            continue;
        }

        const count =
            (signatures.get(signature) || 0) + 1;

        signatures.set(signature, count);

        if (count === 2) {
            duplicateCandidates++;
        }
    }

    return {
        ...fileInfo(filePath),
        itemCount: items.length,
        statusCounts,
        duplicateCandidates,
        metadata:
            queueFile && !Array.isArray(queueFile)
                ? queueFile.metadata || {}
                : {}
    };
}

class RuntimeConsolidationAuditService {
    run() {
        const enterpriseData =
            path.join(
                ENTERPRISE_ROOT,
                "DATA"
            );

        const legacyData =
            path.join(
                LEGACY_ROOT,
                "DATA"
            );

        const enterpriseQueue =
            path.join(
                enterpriseData,
                "runtime",
                "work_queue.json"
            );

        const legacyQueue =
            path.join(
                legacyData,
                "runtime",
                "work_queue.json"
            );

        const enterpriseSummary =
            summarizeQueue(enterpriseQueue);

        const legacySummary =
            summarizeQueue(legacyQueue);

        let recommendation;

        if (
            enterpriseSummary.exists &&
            legacySummary.exists
        ) {
            recommendation =
                enterpriseSummary.modifiedAt >=
                legacySummary.modifiedAt
                    ? "ENTERPRISE_APPEARS_NEWER"
                    : "LEGACY_APPEARS_NEWER";
        } else if (enterpriseSummary.exists) {
            recommendation =
                "ENTERPRISE_ONLY";
        } else if (legacySummary.exists) {
            recommendation =
                "LEGACY_ONLY";
        } else {
            recommendation =
                "NO_RUNTIME_QUEUE_FOUND";
        }

        return {
            ok: true,
            generatedAt:
                new Date().toISOString(),

            environment: {
                cwd: process.cwd(),
                milesRoot:
                    process.env.MILES_ROOT ||
                    null,
                enterpriseRoot:
                    ENTERPRISE_ROOT,
                legacyRoot:
                    LEGACY_ROOT
            },

            enterprise: {
                dataDir:
                    enterpriseData,
                queue:
                    enterpriseSummary
            },

            legacy: {
                dataDir:
                    legacyData,
                queue:
                    legacySummary
            },

            comparison: {
                bothQueuesExist:
                    enterpriseSummary.exists &&
                    legacySummary.exists,

                samePath:
                    path.resolve(enterpriseQueue) ===
                    path.resolve(legacyQueue),

                enterpriseItemCount:
                    enterpriseSummary.itemCount,

                legacyItemCount:
                    legacySummary.itemCount,

                enterpriseModifiedAt:
                    enterpriseSummary.modifiedAt,

                legacyModifiedAt:
                    legacySummary.modifiedAt,

                recommendation
            },

            nextAction:
                "Do not delete, move, archive, or split either queue until the authoritative runtime root is confirmed."
        };
    }
}

module.exports =
    new RuntimeConsolidationAuditService();