"use strict";

/**
 * MILES ENTERPRISE
 * BUILD045 — Unified Business Snapshot Service
 * COMPLETE NEW FILE
 *
 * Purpose:
 * Produce one authoritative CEO-level business snapshot from the current
 * MILES runtime, Autonomous COO cycle, live business state, ORION, Instantly,
 * work queue, executive brief, runtime metrics, and provider operations.
 *
 * Authoritative output:
 * DATA\runtime\latest_business_snapshot.json
 *
 * Design rules:
 * - Read-only aggregation.
 * - Never mutates operational source files.
 * - Never executes business actions.
 * - Never invents metrics.
 * - Uses full ORION totals from latest_orion_operation.metrics.
 * - Uses live Instantly collections from latest_live_business_state.business.
 * - Uses current COO-cycle health, autonomy, mission, queue, and dispatch state.
 * - Preserves source provenance and freshness.
 */

const fs = require("fs");
const path = require("path");

const ROOT =
    process.env.MILES_ROOT ||
    path.resolve(__dirname, "..");

const OUTPUT_DIR =
    path.join(ROOT, "DATA", "runtime");

const OUTPUT_FILE =
    path.join(
        OUTPUT_DIR,
        "latest_business_snapshot.json"
    );

/* ============================================================
   GENERAL HELPERS
============================================================ */

function ensureDir(directory) {
    fs.mkdirSync(
        directory,
        {
            recursive: true
        }
    );
}

function isObject(value) {
    return Boolean(
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

function object(value) {
    return isObject(value)
        ? value
        : {};
}

function array(value) {
    return Array.isArray(value)
        ? value
        : [];
}

function asNumber(
    value,
    fallback = 0
) {
    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function asBoolean(
    value,
    fallback = false
) {
    if (
        value === true ||
        value === false
    ) {
        return value;
    }

    if (
        typeof value === "string"
    ) {
        const normalized =
            value
                .trim()
                .toLowerCase();

        if (
            [
                "true",
                "yes",
                "y",
                "1",
                "enabled",
                "active"
            ].includes(normalized)
        ) {
            return true;
        }

        if (
            [
                "false",
                "no",
                "n",
                "0",
                "disabled",
                "inactive"
            ].includes(normalized)
        ) {
            return false;
        }
    }

    return fallback;
}

function firstDefined(...values) {
    for (
        const value of values
    ) {
        if (
            value !== undefined &&
            value !== null &&
            value !== ""
        ) {
            return value;
        }
    }

    return undefined;
}

function nowIso() {
    return new Date().toISOString();
}

function safeDate(value) {
    const milliseconds =
        Date.parse(value || "");

    if (
        !Number.isFinite(
            milliseconds
        )
    ) {
        return null;
    }

    return new Date(
        milliseconds
    ).toISOString();
}

function ageMinutes(value) {
    const milliseconds =
        Date.parse(value || "");

    if (
        !Number.isFinite(
            milliseconds
        )
    ) {
        return null;
    }

    return Math.max(
        0,
        Math.round(
            (
                Date.now() -
                milliseconds
            ) /
            60000
        )
    );
}

function normalizeStatus(
    value,
    fallback = "UNKNOWN"
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return fallback;
    }

    if (
        typeof value === "boolean"
    ) {
        return value
            ? "HEALTHY"
            : "UNHEALTHY";
    }

    if (
        typeof value === "number"
    ) {
        if (
            value >= 90
        ) {
            return "HEALTHY";
        }

        if (
            value >= 70
        ) {
            return "WATCH";
        }

        return "UNHEALTHY";
    }

    if (
        isObject(value)
    ) {
        return normalizeStatus(
            firstDefined(
                value.status,
                value.health,
                value.state,
                value.overallStatus,
                value.overall,
                value.severity,
                value.level,
                value.score
            ),
            fallback
        );
    }

    const normalized =
        String(value)
            .trim()
            .toUpperCase()
            .replace(
                /[\s-]+/g,
                "_"
            );

    const aliases = {
        OK: "HEALTHY",
        GOOD: "HEALTHY",
        PASS: "HEALTHY",
        PASSED: "HEALTHY",
        ONLINE: "HEALTHY",
        RUNNING: "HEALTHY",
        READY: "HEALTHY",
        CONNECTED: "HEALTHY",
        ACTIVE: "HEALTHY",
        COMPLETED: "HEALTHY",
        SUCCESS: "HEALTHY",

        WARN: "WATCH",
        WARNING: "WATCH",
        DEGRADED: "WATCH",
        ATTENTION: "WATCH",

        ERROR: "UNHEALTHY",
        FAILED: "UNHEALTHY",
        FAILURE: "UNHEALTHY",
        OFFLINE: "UNHEALTHY",
        DISCONNECTED: "UNHEALTHY",
        DOWN: "UNHEALTHY",
        CRITICAL: "UNHEALTHY"
    };

    return (
        aliases[normalized] ||
        normalized ||
        fallback
    );
}

function uniqueBy(
    rows,
    keyFactory
) {
    const output = [];
    const seen = new Set();

    for (
        const row of array(rows)
    ) {
        let key;

        try {
            key =
                keyFactory(row);
        } catch {
            key = null;
        }

        if (
            key === undefined ||
            key === null ||
            key === ""
        ) {
            try {
                key =
                    JSON.stringify(row);
            } catch {
                key =
                    `row-${output.length}`;
            }
        }

        const normalized =
            String(key)
                .trim()
                .toLowerCase();

        if (
            seen.has(normalized)
        ) {
            continue;
        }

        seen.add(normalized);
        output.push(row);
    }

    return output;
}

function sumFields(
    rows,
    fields
) {
    return array(rows).reduce(
        (
            total,
            row
        ) => {
            for (
                const field of fields
            ) {
                const value =
                    Number(
                        row?.[field]
                    );

                if (
                    Number.isFinite(value)
                ) {
                    return total + value;
                }
            }

            return total;
        },
        0
    );
}

function average(
    values,
    fallback = 0
) {
    const numeric =
        array(values)
            .map(value =>
                Number(value)
            )
            .filter(value =>
                Number.isFinite(value)
            );

    if (
        !numeric.length
    ) {
        return fallback;
    }

    return (
        numeric.reduce(
            (
                total,
                value
            ) =>
                total + value,
            0
        ) /
        numeric.length
    );
}

function percent(
    numerator,
    denominator
) {
    const top =
        asNumber(
            numerator,
            0
        );

    const bottom =
        asNumber(
            denominator,
            0
        );

    if (
        bottom <= 0
    ) {
        return 0;
    }

    return Math.round(
        (
            top /
            bottom
        ) *
        10000
    ) / 100;
}

/* ============================================================
   FILE HELPERS
============================================================ */

function absolutePath(
    relativePath
) {
    return path.join(
        ROOT,
        relativePath
    );
}

function exists(
    relativePath
) {
    try {
        return fs.existsSync(
            absolutePath(
                relativePath
            )
        );
    } catch {
        return false;
    }
}

function readJson(
    relativePath,
    fallback = {}
) {
    const fullPath =
        absolutePath(
            relativePath
        );

    try {
        if (
            !fs.existsSync(
                fullPath
            )
        ) {
            return fallback;
        }

        const text =
            fs
                .readFileSync(
                    fullPath,
                    "utf8"
                )
                .replace(
                    /^\uFEFF/,
                    ""
                );

        return JSON.parse(text);
    } catch (
        error
    ) {
        return {
            _readError: true,
            file: fullPath,
            error:
                error.message,
            fallback
        };
    }
}

function statSource(
    relativePath
) {
    const fullPath =
        absolutePath(
            relativePath
        );

    try {
        if (
            !fs.existsSync(
                fullPath
            )
        ) {
            return {
                relativePath,
                fullPath,
                exists: false,
                sizeBytes: 0,
                modifiedAt: null,
                ageMinutes: null,
                healthy: false
            };
        }

        const stat =
            fs.statSync(
                fullPath
            );

        const modifiedAt =
            stat.mtime.toISOString();

        return {
            relativePath,
            fullPath,
            exists: true,
            sizeBytes:
                stat.size,
            modifiedAt,
            ageMinutes:
                ageMinutes(
                    modifiedAt
                ),
            healthy:
                stat.size > 0
        };
    } catch (
        error
    ) {
        return {
            relativePath,
            fullPath,
            exists: false,
            sizeBytes: 0,
            modifiedAt: null,
            ageMinutes: null,
            healthy: false,
            error:
                error.message
        };
    }
}

function writeJsonAtomic(
    file,
    value
) {
    ensureDir(
        path.dirname(file)
    );

    const temporary =
        `${file}.tmp_${process.pid}_${Date.now()}`;

    const serialized =
        JSON.stringify(
            value,
            null,
            2
        );

    fs.writeFileSync(
        temporary,
        serialized,
        "utf8"
    );

    try {
        fs.renameSync(
            temporary,
            file
        );
    } catch (
        renameError
    ) {
        try {
            fs.copyFileSync(
                temporary,
                file
            );

            fs.unlinkSync(
                temporary
            );
        } catch (
            copyError
        ) {
            try {
                if (
                    fs.existsSync(
                        temporary
                    )
                ) {
                    fs.unlinkSync(
                        temporary
                    );
                }
            } catch {
                // Best-effort cleanup only.
            }

            throw new Error(
                [
                    "Unable to write business snapshot.",
                    `Rename error: ${renameError.message}`,
                    `Copy fallback error: ${copyError.message}`
                ].join(" ")
            );
        }
    }
}

/* ============================================================
   QUEUE HELPERS
============================================================ */

function queueItems(
    queue
) {
    return array(
        queue.items ||
        queue.queue ||
        queue.workItems ||
        queue.tasks
    );
}

function normalizeQueueStatus(
    value
) {
    return String(
        value || ""
    )
        .trim()
        .toLowerCase()
        .replace(
            /[_-]+/g,
            " "
        );
}

function countStatuses(
    items,
    statuses
) {
    const accepted =
        new Set(
            array(statuses).map(
                status =>
                    normalizeQueueStatus(
                        status
                    )
            )
        );

    return array(items).filter(
        item =>
            accepted.has(
                normalizeQueueStatus(
                    item?.status
                )
            )
    ).length;
}

function latestRows(
    rows,
    limit = 10
) {
    return [...array(rows)]
        .sort(
            (
                left,
                right
            ) => {
                const rightTime =
                    Date.parse(
                        firstDefined(
                            right?.updatedAt,
                            right?.createdAt,
                            right?.generatedAt,
                            right?.timestamp,
                            ""
                        )
                    ) || 0;

                const leftTime =
                    Date.parse(
                        firstDefined(
                            left?.updatedAt,
                            left?.createdAt,
                            left?.generatedAt,
                            left?.timestamp,
                            ""
                        )
                    ) || 0;

                return (
                    rightTime -
                    leftTime
                );
            }
        )
        .slice(
            0,
            limit
        );
}

/* ============================================================
   CAMPAIGN HELPERS
============================================================ */

function campaignStatus(
    campaign
) {
    return String(
        firstDefined(
            campaign?.status,
            campaign?.campaignStatus,
            campaign?.state,
            campaign?.severity,
            campaign?.rawStatus,
            ""
        )
    )
        .trim()
        .toUpperCase();
}

function campaignIsActive(
    campaign
) {
    if (
        campaign?.rawStatus === 0 ||
        campaign?.rawStatus === "0"
    ) {
        return true;
    }

    return [
        "ACTIVE",
        "RUNNING",
        "STARTED",
        "LIVE",
        "HEALTHY",
        "IN_PROGRESS"
    ].includes(
        campaignStatus(
            campaign
        )
    );
}

function campaignIsPaused(
    campaign
) {
    return [
        "PAUSED",
        "STOPPED",
        "DISABLED",
        "FAILED",
        "ERROR"
    ].includes(
        campaignStatus(
            campaign
        )
    );
}

function classificationOf(
    reply
) {
    return String(
        firstDefined(
            reply?.classification,
            reply?.category,
            reply?.replyClassification,
            reply?.intent,
            reply?.status,
            ""
        )
    )
        .trim()
        .toLowerCase();
}

/* ============================================================
   BUSINESS SNAPSHOT SERVICE
============================================================ */

class BusinessSnapshotService {
    constructor(
        options = {}
    ) {
        this.root =
            options.root ||
            ROOT;

        this.outputDir =
            options.outputDir ||
            OUTPUT_DIR;

        this.outputFile =
            options.outputFile ||
            OUTPUT_FILE;
    }

    run(
        input = {}
    ) {
        return this.build(
            input
        );
    }

    build(
        input = {}
    ) {
        const generatedAt =
            nowIso();

        /* ----------------------------------------------------
           AUTHORITATIVE SOURCES
        ----------------------------------------------------- */

        const sourcePaths = {
            cooCycle:
                "DATA\\runtime\\latest_coo_cycle.json",

            liveBusiness:
                "DATA\\runtime\\latest_live_business_state.json",

            runtimeMetrics:
                "DATA\\runtime\\runtime_metrics.json",

            workerRuntime:
                "DATA\\runtime\\worker_runtime_status.json",

            executiveBrief:
                "DATA\\runtime\\latest_executive_brief.json",

            workQueue:
                "DATA\\runtime\\work_queue.json",

            taskQueue:
                "DATA\\runtime\\task_queue.json",

            executionHistory:
                "DATA\\runtime\\execution_history.jsonl",

            orion:
                "DATA\\orion_coo\\latest_orion_operation.json",

            marketing:
                "DATA\\marketing_coo\\latest_marketing_operation.json",

            website:
                "DATA\\website_coo\\latest_website_operation.json",

            taskRouter:
                "DATA\\task_router\\latest_task_router_run.json",

            companyState:
                "DATA\\company_state\\company_state.json",

            companyHealth:
                "DATA\\company_state\\company_health.json",

            executiveDecision:
                "DATA\\executive_brain\\latest_executive_decision.json"
        };

        const cooCycle =
            object(
                readJson(
                    sourcePaths.cooCycle,
                    {}
                )
            );

        const liveBusinessState =
            object(
                readJson(
                    sourcePaths.liveBusiness,
                    {}
                )
            );

        const runtimeMetrics =
            object(
                readJson(
                    sourcePaths.runtimeMetrics,
                    {}
                )
            );

        const workerRuntime =
            object(
                readJson(
                    sourcePaths.workerRuntime,
                    {}
                )
            );

        const executiveBrief =
            object(
                readJson(
                    sourcePaths.executiveBrief,
                    {}
                )
            );

        const workQueue =
            object(
                readJson(
                    sourcePaths.workQueue,
                    {
                        items: []
                    }
                )
            );

        const taskQueue =
            object(
                readJson(
                    sourcePaths.taskQueue,
                    {
                        items: []
                    }
                )
            );

        const orionOperation =
            object(
                readJson(
                    sourcePaths.orion,
                    {}
                )
            );

        const marketingOperation =
            object(
                readJson(
                    sourcePaths.marketing,
                    {}
                )
            );

        const websiteOperation =
            object(
                readJson(
                    sourcePaths.website,
                    {}
                )
            );

        const taskRouter =
            object(
                readJson(
                    sourcePaths.taskRouter,
                    {}
                )
            );

        const companyState =
            object(
                readJson(
                    sourcePaths.companyState,
                    {}
                )
            );

        const companyHealth =
            object(
                readJson(
                    sourcePaths.companyHealth,
                    {}
                )
            );

        const executiveDecision =
            object(
                readJson(
                    sourcePaths.executiveDecision,
                    {}
                )
            );

        /* ----------------------------------------------------
           LIVE BUSINESS COLLECTIONS
        ----------------------------------------------------- */

        const liveBusiness =
            object(
                liveBusinessState.business
            );

        const campaigns =
            array(
                liveBusiness.campaigns
            );

        const replies =
            array(
                liveBusiness.replies
            );

        const mailboxes =
            array(
                liveBusiness.mailboxes
            );

        const segments =
            array(
                liveBusiness.segments
            );

        const deals =
            array(
                liveBusiness.deals
            );

        const proposals =
            array(
                liveBusiness.proposals
            );

        const opportunities =
            array(
                liveBusiness.opportunities
            );

        const contractors =
            array(
                liveBusiness.contractors
            );

        /* ----------------------------------------------------
           RUNTIME HEALTH
        ----------------------------------------------------- */

        const cooHealth =
            object(
                cooCycle.health
            );

        const runtimeMetricRuntime =
            object(
                runtimeMetrics.runtime
            );

        const runtimeStatus =
            normalizeStatus(
                firstDefined(
                    cooHealth.overallStatus,
                    cooHealth.status,
                    workerRuntime.health,
                    workerRuntime.status,
                    workerRuntime
                        .runtime
                        ?.health,
                    runtimeMetricRuntime.health,
                    cooCycle.status,
                    cooCycle.ok === true
                        ? "HEALTHY"
                        : undefined
                ),
                "UNKNOWN"
            );

        const runtimeScore =
            asNumber(
                firstDefined(
                    cooHealth.overallScore,
                    cooHealth.score,
                    workerRuntime.healthScore,
                    workerRuntime.score
                ),
                runtimeStatus ===
                    "HEALTHY"
                    ? 100
                    : 0
            );

        const runtimeSystems =
            array(
                cooHealth.systems
            );

        const runtimeHighRisk =
            asNumber(
                firstDefined(
                    cooHealth.highRiskCount,
                    runtimeSystems.filter(
                        system =>
                            normalizeStatus(
                                firstDefined(
                                    system.status,
                                    system.health,
                                    system.severity
                                )
                            ) ===
                            "UNHEALTHY"
                    ).length
                ),
                0
            );

        const runtimeMediumRisk =
            asNumber(
                firstDefined(
                    cooHealth.mediumRiskCount,
                    runtimeSystems.filter(
                        system =>
                            normalizeStatus(
                                firstDefined(
                                    system.status,
                                    system.health,
                                    system.severity
                                )
                            ) ===
                            "WATCH"
                    ).length
                ),
                0
            );

        const runtimeLowRisk =
            asNumber(
                cooHealth.lowRiskCount,
                0
            );

        /* ----------------------------------------------------
           AUTONOMY
        ----------------------------------------------------- */

        const autonomy =
            object(
                cooCycle.autonomy
            );

        const autonomyScores =
            object(
                autonomy.scores
            );

        const autonomyOverall =
            asNumber(
                firstDefined(
                    autonomy.overall,
                    autonomy.score,
                    average(
                        Object.values(
                            autonomyScores
                        )
                    )
                ),
                0
            );

        /* ----------------------------------------------------
           COO MISSION AND EXECUTIVE DISPATCH
        ----------------------------------------------------- */

        const mission =
            object(
                cooCycle.mission
            );

        const revenueOperations =
            object(
                cooCycle.revenueOperations
            );

        const revenueMetrics =
            object(
                revenueOperations.metrics
            );

        const revenueMissions =
            array(
                revenueOperations.missions
            );

        const executiveDispatch =
            object(
                cooCycle.executiveDispatch
            );

        const protectedItems =
            array(
                executiveDispatch.protectedItems
            );

        const repairPlan =
            array(
                cooCycle.repairPlan
            );

        const capabilityBacklog =
            array(
                cooCycle.capabilityBacklog
            );

        const workCreated =
            array(
                cooCycle.workCreated
            );

        const workflowResults =
            array(
                cooCycle.workflowResults
            );

        const executionResults =
            array(
                cooCycle.executionResults
            );

        /* ----------------------------------------------------
           QUEUE
        ----------------------------------------------------- */

        const queueSummary =
            object(
                cooCycle.queue
            );

        const workItems =
            queueItems(
                workQueue
            );

        const taskItems =
            queueItems(
                taskQueue
            );

        const openWorkItems =
            workItems.filter(
                item =>
                    [
                        "pending",
                        "queued",
                        "running",
                        "in progress",
                        "blocked",
                        "awaiting approval"
                    ].includes(
                        normalizeQueueStatus(
                            item?.status
                        )
                    )
            );

        const pendingWork =
            countStatuses(
                workItems,
                [
                    "Pending"
                ]
            );

        const queuedWork =
            countStatuses(
                workItems,
                [
                    "Queued"
                ]
            );

        const runningWork =
            countStatuses(
                workItems,
                [
                    "Running",
                    "In Progress"
                ]
            );

        const blockedWork =
            countStatuses(
                workItems,
                [
                    "Blocked"
                ]
            );

        const approvalWork =
            workItems.filter(
                item =>
                    normalizeQueueStatus(
                        item?.status
                    ) ===
                        "awaiting approval" ||
                    item?.requiresKevin ===
                        true ||
                    item?.approvalRequired ===
                        true
            );

        const completedWork =
            countStatuses(
                workItems,
                [
                    "Completed"
                ]
            );

        const failedWork =
            countStatuses(
                workItems,
                [
                    "Failed"
                ]
            );

        /* ----------------------------------------------------
           MARKETING / INSTANTLY
        ----------------------------------------------------- */

        const metricBusiness =
            object(
                runtimeMetrics.business
            );

        const metricConnectors =
            object(
                runtimeMetrics.connectors
            );

        const totalCampaigns =
            Math.max(
                campaigns.length,
                asNumber(
                    metricBusiness.campaigns,
                    0
                ),
                asNumber(
                    marketingOperation
                        .metrics
                        ?.campaignsTotal,
                    0
                )
            );

        const activeCampaigns =
            Math.max(
                campaigns.filter(
                    campaignIsActive
                ).length,
                asNumber(
                    marketingOperation
                        .metrics
                        ?.campaignsActive,
                    0
                )
            );

        const pausedCampaigns =
            Math.max(
                campaigns.filter(
                    campaignIsPaused
                ).length,
                asNumber(
                    marketingOperation
                        .metrics
                        ?.campaignsPaused,
                    0
                ),
                Math.max(
                    0,
                    totalCampaigns -
                    activeCampaigns
                )
            );

        const positiveReplies =
            replies.filter(
                reply =>
                    classificationOf(
                        reply
                    ).includes(
                        "positive"
                    ) ||
                    classificationOf(
                        reply
                    ).includes(
                        "meeting"
                    ) ||
                    classificationOf(
                        reply
                    ).includes(
                        "interested"
                    )
            ).length;

        const neutralReplies =
            replies.filter(
                reply =>
                    classificationOf(
                        reply
                    ).includes(
                        "neutral"
                    ) ||
                    classificationOf(
                        reply
                    ).includes(
                        "future"
                    ) ||
                    classificationOf(
                        reply
                    ).includes(
                        "later"
                    )
            ).length;

        const negativeReplies =
            replies.filter(
                reply =>
                    classificationOf(
                        reply
                    ).includes(
                        "negative"
                    ) ||
                    classificationOf(
                        reply
                    ).includes(
                        "not interested"
                    ) ||
                    classificationOf(
                        reply
                    ).includes(
                        "stop"
                    )
            ).length;

        const technicalReplies =
            replies.filter(
                reply =>
                    classificationOf(
                        reply
                    ).includes(
                        "technical"
                    ) ||
                    classificationOf(
                        reply
                    ).includes(
                        "bounce"
                    ) ||
                    classificationOf(
                        reply
                    ).includes(
                        "auto"
                    )
            ).length;

        const unclassifiedReplies =
            Math.max(
                0,
                replies.length -
                positiveReplies -
                neutralReplies -
                negativeReplies -
                technicalReplies
            );

        const verifiedEmailCount =
            sumFields(
                segments,
                [
                    "verifiedEmailCount",
                    "verified_email_count",
                    "verifiedEmails",
                    "verified_emails"
                ]
            );

        const depletedSegments =
            segments.filter(
                segment =>
                    asBoolean(
                        firstDefined(
                            segment.depleted,
                            segment.isDepleted,
                            segment.needsEnrichment,
                            segment.needsUpload
                        ),
                        false
                    ) ||
                    asNumber(
                        firstDefined(
                            segment.verifiedEmailCount,
                            segment.verified_email_count,
                            segment.remaining,
                            segment.leadsRemaining
                        ),
                        1
                    ) <= 0
            ).length;

        const unhealthyMailboxes =
            mailboxes.filter(
                mailbox =>
                    normalizeStatus(
                        firstDefined(
                            mailbox.status,
                            mailbox.health,
                            mailbox.severity
                        ),
                        "UNKNOWN"
                    ) !==
                    "HEALTHY"
            ).length;

        const sentObserved =
            asNumber(
                firstDefined(
                    revenueMetrics.sentObserved,
                    revenueMetrics.emailsSent,
                    sumFields(
                        campaigns,
                        [
                            "sent",
                            "emailsSent",
                            "sentObserved",
                            "totalSent"
                        ]
                    )
                ),
                0
            );

        const bouncesObserved =
            asNumber(
                firstDefined(
                    revenueMetrics.bouncesObserved,
                    revenueMetrics.bounces,
                    sumFields(
                        campaigns,
                        [
                            "bounces",
                            "bounceCount",
                            "bouncesObserved"
                        ]
                    )
                ),
                0
            );

        const bounceRate =
            asNumber(
                firstDefined(
                    revenueMetrics.bounceRate,
                    sentObserved > 0
                        ? (
                            bouncesObserved /
                            sentObserved
                        )
                        : 0
                ),
                0
            );

        /* ----------------------------------------------------
           REVENUE AND PIPELINE
        ----------------------------------------------------- */

        const pipelineValue =
            sumFields(
                deals,
                [
                    "pipelineValue",
                    "weightedValue",
                    "value",
                    "amount",
                    "estimatedValue"
                ]
            );

        const weightedPipeline =
            sumFields(
                deals,
                [
                    "weightedValue",
                    "weightedPipeline",
                    "weighted_amount"
                ]
            );

        const closedRevenue =
            sumFields(
                deals.filter(
                    deal =>
                        [
                            "closed won",
                            "won",
                            "closed_won"
                        ].includes(
                            normalizeQueueStatus(
                                firstDefined(
                                    deal.stage,
                                    deal.status
                                )
                            )
                        )
                ),
                [
                    "value",
                    "amount",
                    "revenue",
                    "closedValue"
                ]
            );

        const warmDeals =
            deals.filter(
                deal =>
                    String(
                        firstDefined(
                            deal.stage,
                            deal.status,
                            ""
                        )
                    )
                        .toLowerCase()
                        .includes(
                            "warm"
                        )
            ).length;

        const proposalDueSoon =
            proposals.filter(
                proposal => {
                    const dueDate =
                        Date.parse(
                            firstDefined(
                                proposal.dueDate,
                                proposal.deadline,
                                proposal.responseDate,
                                ""
                            )
                        );

                    if (
                        !Number.isFinite(
                            dueDate
                        )
                    ) {
                        return false;
                    }

                    const days =
                        (
                            dueDate -
                            Date.now()
                        ) /
                        86400000;

                    return (
                        days >= 0 &&
                        days <= 7
                    );
                }
            ).length;

        /* ----------------------------------------------------
           ORION
        ----------------------------------------------------- */

        const orionMetrics =
            object(
                orionOperation.metrics
            );

        const orionIntelligence =
            object(
                orionOperation.intelligence
            );

        const orionStatus =
            normalizeStatus(
                firstDefined(
                    orionOperation.status,
                    metricConnectors.ORION,
                    orionOperation.ok === true
                        ? "HEALTHY"
                        : undefined
                ),
                "UNKNOWN"
            );

        const orionDatabaseFreshness =
            object(
                orionMetrics.databaseFreshness
            );

        /* ----------------------------------------------------
           WEBSITE
        ----------------------------------------------------- */

        const websiteStatus =
            normalizeStatus(
                firstDefined(
                    websiteOperation.status,
                    websiteOperation.health,
                    websiteOperation.ok === true
                        ? "HEALTHY"
                        : undefined
                ),
                "UNKNOWN"
            );

        /* ----------------------------------------------------
           CONNECTORS
        ----------------------------------------------------- */

        const connectorRows =
            Object.entries(
                metricConnectors
            ).map(
                (
                    [
                        name,
                        status
                    ]
                ) => ({
                    name,
                    status:
                        normalizeStatus(
                            status,
                            "UNKNOWN"
                        )
                })
            );

        const connectedConnectorCount =
            connectorRows.filter(
                connector =>
                    connector.status ===
                    "HEALTHY"
            ).length;

        /* ----------------------------------------------------
           EXECUTIVE STATE
        ----------------------------------------------------- */

        const executiveState =
            object(
                cooCycle.executiveState
            );

        const executiveBusiness =
            object(
                executiveState.business
            );

        const executiveRevenue =
            object(
                firstDefined(
                    executiveBusiness.revenue,
                    executiveState.revenue,
                    executiveBrief.revenue,
                    {}
                )
            );

        const revenueGoal =
            asNumber(
                firstDefined(
                    executiveRevenue.goal,
                    executiveRevenue.revenueGoal,
                    10000
                ),
                10000
            );

        const revenueCurrent =
            asNumber(
                firstDefined(
                    executiveRevenue.current,
                    executiveRevenue.revenueThisMonth,
                    executiveRevenue.closed,
                    closedRevenue
                ),
                closedRevenue
            );

        const finalPipelineValue =
            asNumber(
                firstDefined(
                    executiveRevenue.pipeline,
                    executiveRevenue.pipelineValue,
                    pipelineValue
                ),
                pipelineValue
            );

        /* ----------------------------------------------------
           RISKS
        ----------------------------------------------------- */

        const risks = [];

        const addRisk = (
            severity,
            area,
            title,
            message,
            recommendedAction,
            requiresKevin = false
        ) => {
            risks.push({
                severity,
                area,
                title,
                message,
                recommendedAction,
                requiresKevin
            });
        };

        if (
            runtimeStatus !==
            "HEALTHY"
        ) {
            addRisk(
                runtimeStatus ===
                    "UNHEALTHY"
                    ? "CRITICAL"
                    : "WARNING",
                "Runtime",
                "Runtime health requires attention",
                `Current runtime status is ${runtimeStatus}.`,
                "Review the latest COO health systems and failed execution evidence."
            );
        }

        if (
            orionDatabaseFreshness.stale ===
            true
        ) {
            addRisk(
                "WARNING",
                "ORION",
                "ORION database is stale",
                `ORION database age is ${asNumber(
                    orionDatabaseFreshness.ageHours,
                    0
                )} hours.`,
                array(
                    orionOperation.recommendations
                )[0] ||
                "Run an authorized ORION data refresh."
            );
        }

        if (
            bounceRate >=
            0.03
        ) {
            addRisk(
                bounceRate >= 0.05
                    ? "CRITICAL"
                    : "WARNING",
                "Marketing",
                "Outbound bounce rate elevated",
                `Observed bounce rate is ${(
                    bounceRate *
                    100
                ).toFixed(2)}%.`,
                "Audit affected campaigns, lists, and sending accounts before scaling."
            );
        }

        if (
            unhealthyMailboxes > 0
        ) {
            addRisk(
                "WARNING",
                "Marketing",
                "Unhealthy sending mailboxes detected",
                `${unhealthyMailboxes} mailbox record(s) are not healthy.`,
                "Audit authentication, warmup, limits, and connection health."
            );
        }

        if (
            depletedSegments > 0
        ) {
            addRisk(
                "WARNING",
                "Marketing",
                "Outbound segments depleted",
                `${depletedSegments} segment(s) require replenishment or enrichment.`,
                "Prepare the next verified segment and apply deduplication and suppression rules."
            );
        }

        if (
            proposalDueSoon > 0
        ) {
            addRisk(
                "WARNING",
                "Proposals",
                "Proposal deadlines approaching",
                `${proposalDueSoon} proposal(s) are due within seven days.`,
                "Verify compliance, production, signatures, pricing, and submission readiness."
            );
        }

        if (
            blockedWork > 0
        ) {
            addRisk(
                "WARNING",
                "Operations",
                "Blocked work exists",
                `${blockedWork} work item(s) are blocked.`,
                "Review blockers and route resolvable issues to the appropriate provider."
            );
        }

        if (
            failedWork > 0
        ) {
            addRisk(
                "WARNING",
                "Operations",
                "Failed work exists",
                `${failedWork} work item(s) are marked failed.`,
                "Separate historical failures from current failures and route recoverable items."
            );
        }

        if (
            approvalWork.length > 0
        ) {
            addRisk(
                "WARNING",
                "Executive",
                "CEO approvals pending",
                `${approvalWork.length} work item(s) require Kevin approval.`,
                "Review only protected commitments, submissions, purchases, and external sends.",
                true
            );
        }

        for (
            const exception of array(
                orionOperation.exceptions
            )
        ) {
            addRisk(
                normalizeStatus(
                    exception.severity,
                    "WATCH"
                ) ===
                    "UNHEALTHY"
                    ? "CRITICAL"
                    : "WARNING",
                "ORION",
                exception.type ||
                    "ORION exception",
                exception.message ||
                    "ORION reported an exception.",
                array(
                    orionOperation.recommendations
                )[0] ||
                    "Review ORION operational evidence."
            );
        }

        /* ----------------------------------------------------
           PRIORITIES
        ----------------------------------------------------- */

        const priorities =
            uniqueBy(
                [
                    ...revenueMissions.map(
                        revenueMission => ({
                            priority:
                                asNumber(
                                    revenueMission.priority,
                                    3
                                ),

                            area:
                                revenueMission.area ||
                                "Revenue Operations",

                            title:
                                revenueMission.title ||
                                revenueMission.objective ||
                                "Revenue mission",

                            objective:
                                revenueMission.objective ||
                                null,

                            reason:
                                revenueMission.reason ||
                                null,

                            recommendedAction:
                                revenueMission.recommendedAction ||
                                null,

                            expectedImpact:
                                revenueMission.expectedImpact ||
                                null,

                            requiresKevin:
                                revenueMission.requiresKevin ===
                                true,

                            source:
                                "AutonomousCOO.revenueOperations"
                        })
                    ),

                    ...repairPlan.map(
                        repair => ({
                            priority:
                                asNumber(
                                    repair.priority,
                                    2
                                ),

                            area:
                                repair.area ||
                                repair.system ||
                                "Runtime",

                            title:
                                repair.title ||
                                repair.action ||
                                "Repair action",

                            objective:
                                repair.objective ||
                                null,

                            reason:
                                repair.reason ||
                                repair.issue ||
                                null,

                            recommendedAction:
                                repair.recommendedAction ||
                                repair.action ||
                                null,

                            expectedImpact:
                                repair.expectedImpact ||
                                null,

                            requiresKevin:
                                repair.requiresKevin ===
                                true,

                            source:
                                "AutonomousCOO.repairPlan"
                        })
                    ),

                    ...risks
                        .filter(
                            risk =>
                                [
                                    "CRITICAL",
                                    "WARNING"
                                ].includes(
                                    risk.severity
                                )
                        )
                        .map(
                            risk => ({
                                priority:
                                    risk.severity ===
                                        "CRITICAL"
                                        ? 1
                                        : 2,

                                area:
                                    risk.area,

                                title:
                                    risk.title,

                                objective:
                                    null,

                                reason:
                                    risk.message,

                                recommendedAction:
                                    risk.recommendedAction,

                                expectedImpact:
                                    null,

                                requiresKevin:
                                    risk.requiresKevin,

                                source:
                                    "BusinessSnapshot.risk"
                            })
                        )
                ],
                row =>
                    `${row.area}::${row.title}`
            )
                .sort(
                    (
                        left,
                        right
                    ) =>
                        asNumber(
                            left.priority,
                            99
                        ) -
                        asNumber(
                            right.priority,
                            99
                        )
                )
                .slice(
                    0,
                    25
                );

        /* ----------------------------------------------------
           CEO SUMMARY
        ----------------------------------------------------- */

        const companyHealthScore =
            asNumber(
                firstDefined(
                    cooHealth.overallScore,
                    companyState
                        .health
                        ?.score,
                    companyHealth
                        .health
                        ?.score,
                    runtimeScore
                ),
                runtimeScore
            );

        const companyHealthStatus =
            normalizeStatus(
                firstDefined(
                    cooHealth.overallStatus,
                    companyState
                        .health
                        ?.status,
                    companyHealth
                        .health
                        ?.status,
                    runtimeStatus
                ),
                runtimeStatus
            );

        const ceoSummary = {
            greeting:
                input.greeting ||
                "MILES DIGITAL COO",

            companyHealthScore,

            companyHealthStatus,

            runtimeStatus,

            autonomyLevel:
                autonomy.level ||
                "UNKNOWN",

            autonomyScore:
                autonomyOverall,

            currentMission:
                firstDefined(
                    mission.title,
                    mission.objective,
                    mission.mission,
                    revenueMissions[0]
                        ?.title,
                    revenueMissions[0]
                        ?.objective,
                    "Maintain governed autonomous business operations."
                ),

            currentRecommendation:
                firstDefined(
                    priorities[0]
                        ?.recommendedAction,
                    priorities[0]
                        ?.title,
                    "Continue governed autonomous operations."
                ),

            topRisk:
                risks[0] ||
                null,

            approvalsRequired:
                Math.max(
                    approvalWork.length,
                    asNumber(
                        executiveDispatch
                            .ceoProtectedBlocked,
                        0
                    )
                ),

            openWork:
                asNumber(
                    firstDefined(
                        queueSummary.open,
                        openWorkItems.length
                    ),
                    openWorkItems.length
                ),

            revenueGoal,

            revenueCurrent,

            pipeline:
                finalPipelineValue,

            campaigns:
                totalCampaigns,

            activeCampaigns,

            replies:
                replies.length,

            positiveReplies,

            proposals:
                proposals.length,

            opportunities:
                asNumber(
                    orionMetrics.opportunities,
                    opportunities.length
                ),

            contractors:
                asNumber(
                    orionMetrics.contractors,
                    contractors.length
                ),

            buyers:
                asNumber(
                    orionMetrics.buyers,
                    0
                ),

            recompetes:
                asNumber(
                    orionMetrics.recompetes,
                    0
                )
        };

        /* ----------------------------------------------------
           SNAPSHOT
        ----------------------------------------------------- */

        const snapshot = {
            ok: true,

            type:
                "MILES_UNIFIED_BUSINESS_SNAPSHOT",

            build:
                "BUILD045",

            generatedAt,

            cycleId:
                cooCycle.cycleId ||
                null,

            cycle:
                asNumber(
                    cooCycle.cycle,
                    0
                ),

            source:
                input.source ||
                "BusinessSnapshotService",

            readOnly:
                true,

            ceoSummary,

            company: {
                health: {
                    score:
                        companyHealthScore,

                    status:
                        companyHealthStatus,

                    highRiskCount:
                        runtimeHighRisk,

                    mediumRiskCount:
                        runtimeMediumRisk,

                    lowRiskCount:
                        runtimeLowRisk,

                    systems:
                        runtimeSystems
                },

                priorities,

                risks,

                approvalsRequired:
                    ceoSummary
                        .approvalsRequired
            },

            runtime: {
                status:
                    runtimeStatus,

                score:
                    runtimeScore,

                cycleId:
                    cooCycle.cycleId ||
                    null,

                cycle:
                    asNumber(
                        cooCycle.cycle,
                        0
                    ),

                startedAt:
                    safeDate(
                        cooCycle.startedAt
                    ),

                completedAt:
                    safeDate(
                        cooCycle.completedAt
                    ),

                durationMs:
                    Math.max(
                        0,
                        (
                            Date.parse(
                                cooCycle.completedAt ||
                                ""
                            ) || 0
                        ) -
                        (
                            Date.parse(
                                cooCycle.startedAt ||
                                ""
                            ) || 0
                        )
                    ),

                executionEnabled:
                    asBoolean(
                        cooCycle
                            .mode
                            ?.execution,
                        false
                    ),

                workflowQueueingEnabled:
                    asBoolean(
                        cooCycle
                            .mode
                            ?.workflowQueueing,
                        false
                    ),

                maxExecutionPasses:
                    asNumber(
                        cooCycle
                            .mode
                            ?.maxExecutionPasses,
                        0
                    ),

                systems:
                    runtimeSystems,

                risks: {
                    high:
                        runtimeHighRisk,

                    medium:
                        runtimeMediumRisk,

                    low:
                        runtimeLowRisk
                },

                workerRuntime: {
                    status:
                        normalizeStatus(
                            firstDefined(
                                workerRuntime.status,
                                workerRuntime.health
                            ),
                            "UNKNOWN"
                        ),

                    workers:
                        asNumber(
                            firstDefined(
                                workerRuntime.workers,
                                workerRuntime
                                    .summary
                                    ?.workers,
                                workerRuntime
                                    .counts
                                    ?.workers
                            ),
                            0
                        ),

                    capabilities:
                        asNumber(
                            firstDefined(
                                workerRuntime.capabilities,
                                workerRuntime
                                    .summary
                                    ?.capabilities,
                                workerRuntime
                                    .counts
                                    ?.capabilities
                            ),
                            0
                        )
                }
            },

            autonomy: {
                ok:
                    autonomy.ok !==
                    false,

                level:
                    autonomy.level ||
                    "UNKNOWN",

                overall:
                    autonomyOverall,

                scores:
                    autonomyScores,

                interpretation:
                    autonomy.interpretation ||
                    null
            },

            executive: {
                mission,

                executiveDecision,

                dispatch: {
                    authorizedIdentified:
                        asNumber(
                            executiveDispatch
                                .authorizedIdentified,
                            0
                        ),

                    authorizedQueued:
                        asNumber(
                            executiveDispatch
                                .authorizedQueued,
                            0
                        ),

                    ceoProtectedIdentified:
                        asNumber(
                            executiveDispatch
                                .ceoProtectedIdentified,
                            0
                        ),

                    ceoProtectedBlocked:
                        asNumber(
                            executiveDispatch
                                .ceoProtectedBlocked,
                            0
                        ),

                    created:
                        array(
                            executiveDispatch.created
                        ),

                    protectedItems
                },

                brief:
                    executiveBrief,

                currentRecommendation:
                    ceoSummary
                        .currentRecommendation
            },

            revenue: {
                goal:
                    revenueGoal,

                current:
                    revenueCurrent,

                progressPct:
                    percent(
                        revenueCurrent,
                        revenueGoal
                    ),

                pipeline:
                    finalPipelineValue,

                weightedPipeline,

                deals:
                    Math.max(
                        deals.length,
                        asNumber(
                            metricBusiness.deals,
                            0
                        )
                    ),

                warmDeals,

                proposals:
                    Math.max(
                        proposals.length,
                        asNumber(
                            metricBusiness.proposals,
                            0
                        )
                    ),

                proposalsDueSoon:
                    proposalDueSoon,

                missions:
                    revenueMissions,

                requiresKevin:
                    revenueOperations
                        .requiresKevin ===
                    true
            },

            marketing: {
                status:
                    normalizeStatus(
                        firstDefined(
                            metricConnectors.INSTANTLY,
                            marketingOperation.status,
                            totalCampaigns > 0
                                ? "CONNECTED"
                                : undefined
                        ),
                        "UNKNOWN"
                    ),

                campaigns: {
                    total:
                        totalCampaigns,

                    active:
                        activeCampaigns,

                    paused:
                        pausedCampaigns,

                    records:
                        campaigns
                },

                replies: {
                    total:
                        Math.max(
                            replies.length,
                            asNumber(
                                metricBusiness.replies,
                                0
                            )
                        ),

                    positive:
                        positiveReplies,

                    neutral:
                        neutralReplies,

                    negative:
                        negativeReplies,

                    technical:
                        technicalReplies,

                    unclassified:
                        unclassifiedReplies,

                    records:
                        replies
                },

                mailboxes: {
                    total:
                        Math.max(
                            mailboxes.length,
                            asNumber(
                                metricBusiness.mailboxes,
                                0
                            )
                        ),

                    unhealthy:
                        unhealthyMailboxes,

                    records:
                        mailboxes
                },

                segments: {
                    total:
                        Math.max(
                            segments.length,
                            asNumber(
                                metricBusiness.segments,
                                0
                            )
                        ),

                    depleted:
                        depletedSegments,

                    verifiedEmails:
                        verifiedEmailCount,

                    records:
                        segments
                },

                deliverability: {
                    sentObserved,
                    bouncesObserved,
                    bounceRate,
                    bounceRatePct:
                        Math.round(
                            bounceRate *
                            10000
                        ) /
                        100
                },

                latestOperation:
                    marketingOperation
            },

            orion: {
                status:
                    orionStatus,

                generatedAt:
                    orionOperation.generatedAt ||
                    null,

                provider:
                    orionOperation.provider ||
                    "OrionProvider",

                action:
                    orionOperation.action ||
                    null,

                database:
                    orionMetrics.database ||
                    null,

                tableCount:
                    asNumber(
                        orionMetrics.tableCount,
                        0
                    ),

                contractors:
                    asNumber(
                        orionMetrics.contractors,
                        contractors.length
                    ),

                buyers:
                    asNumber(
                        orionMetrics.buyers,
                        0
                    ),

                opportunities:
                    asNumber(
                        orionMetrics.opportunities,
                        opportunities.length
                    ),

                recompetes:
                    asNumber(
                        orionMetrics.recompetes,
                        0
                    ),

                recommendations:
                    asNumber(
                        orionMetrics.recommendations,
                        0
                    ),

                personas:
                    asNumber(
                        orionMetrics.personas,
                        0
                    ),

                recommendationCoverage:
                    asNumber(
                        orionMetrics
                            .recommendationCoverage,
                        0
                    ),

                personaCoverage:
                    asNumber(
                        orionMetrics
                            .personaCoverage,
                        0
                    ),

                databaseFreshness:
                    orionDatabaseFreshness,

                sampleSizes:
                    object(
                        orionMetrics.sampleSizes
                    ),

                samples: {
                    contractors:
                        array(
                            orionIntelligence.contractors
                        ),

                    buyers:
                        array(
                            orionIntelligence.buyers
                        ),

                    opportunities:
                        array(
                            orionIntelligence.opportunities
                        ),

                    recompetes:
                        array(
                            orionIntelligence.recompetes
                        ),

                    recommendations:
                        array(
                            orionIntelligence.recommendations
                        ),

                    personas:
                        array(
                            orionIntelligence.personas
                        )
                },

                exceptions:
                    array(
                        orionOperation.exceptions
                    ),

                recommendedActions:
                    array(
                        orionOperation.recommendations
                    )
            },

            operations: {
                queue: {
                    total:
                        asNumber(
                            firstDefined(
                                queueSummary.total,
                                workItems.length
                            ),
                            workItems.length
                        ),

                    open:
                        asNumber(
                            firstDefined(
                                queueSummary.open,
                                openWorkItems.length
                            ),
                            openWorkItems.length
                        ),

                    pending:
                        asNumber(
                            firstDefined(
                                queueSummary.pending,
                                pendingWork
                            ),
                            pendingWork
                        ),

                    authorizedPending:
                        asNumber(
                            queueSummary
                                .authorizedPending,
                            0
                        ),

                    queued:
                        asNumber(
                            firstDefined(
                                queueSummary.queued,
                                queuedWork
                            ),
                            queuedWork
                        ),

                    running:
                        asNumber(
                            firstDefined(
                                queueSummary.inProgress,
                                runningWork
                            ),
                            runningWork
                        ),

                    blocked:
                        asNumber(
                            firstDefined(
                                queueSummary.blocked,
                                blockedWork
                            ),
                            blockedWork
                        ),

                    awaitingApproval:
                        asNumber(
                            firstDefined(
                                queueSummary
                                    .awaitingApproval,
                                approvalWork.length
                            ),
                            approvalWork.length
                        ),

                    completed:
                        asNumber(
                            firstDefined(
                                queueSummary.completed,
                                completedWork
                            ),
                            completedWork
                        ),

                    failed:
                        asNumber(
                            firstDefined(
                                queueSummary.failed,
                                failedWork
                            ),
                            failedWork
                        ),

                    escalations:
                        asNumber(
                            queueSummary.escalations,
                            0
                        ),

                    recentItems:
                        latestRows(
                            workItems,
                            25
                        ),

                    approvalItems:
                        latestRows(
                            approvalWork,
                            25
                        )
                },

                tasks: {
                    total:
                        taskItems.length,

                    recentItems:
                        latestRows(
                            taskItems,
                            25
                        )
                },

                workCreated,

                workflowResults,

                executionResults,

                executionSummary: {
                    workCreated:
                        workCreated.length,

                    workflows:
                        workflowResults.length,

                    executions:
                        executionResults.length,

                    completed:
                        executionResults.filter(
                            result =>
                                normalizeStatus(
                                    firstDefined(
                                        result.status,
                                        result.ok
                                    )
                                ) ===
                                "HEALTHY"
                        ).length,

                    failed:
                        executionResults.filter(
                            result =>
                                normalizeStatus(
                                    firstDefined(
                                        result.status,
                                        result.ok
                                    )
                                ) ===
                                "UNHEALTHY"
                        ).length
                },

                businessOperationsBridge:
                    object(
                        cooCycle
                            .businessOperationsBridge
                    ),

                repairPlan,

                capabilityBacklog,

                taskRouter
            },

            website: {
                status:
                    websiteStatus,

                generatedAt:
                    websiteOperation.generatedAt ||
                    null,

                operation:
                    websiteOperation
            },

            connectors: {
                total:
                    connectorRows.length,

                connected:
                    connectedConnectorCount,

                unhealthy:
                    connectorRows.length -
                    connectedConnectorCount,

                records:
                    connectorRows
            },

            learning:
                object(
                    cooCycle.learning
                ),

            provenance: {
                sourceFiles:
                    Object.fromEntries(
                        Object.entries(
                            sourcePaths
                        ).map(
                            (
                                [
                                    name,
                                    relativePath
                                ]
                            ) => [
                                name,
                                statSource(
                                    relativePath
                                )
                            ]
                        )
                    ),

                authoritativeSources: {
                    runtime:
                        sourcePaths.cooCycle,

                    business:
                        sourcePaths.liveBusiness,

                    metrics:
                        sourcePaths.runtimeMetrics,

                    orion:
                        sourcePaths.orion,

                    queue:
                        sourcePaths.workQueue,

                    executiveBrief:
                        sourcePaths.executiveBrief
                }
            }
        };

        writeJsonAtomic(
            this.outputFile,
            snapshot
        );

        return snapshot;
    }
}

module.exports =
    new BusinessSnapshotService();