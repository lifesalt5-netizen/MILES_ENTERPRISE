"use strict";

/**
 * MILES Dashboard Data Service
 * BUILD_044
 * COMPLETE REPLACEMENT FILE
 *
 * Purpose:
 * Read-only aggregation layer for the MILES Executive Dashboard.
 *
 * Authoritative sources:
 * - DATA\runtime\latest_live_business_state.json
 * - DATA\runtime\runtime_metrics.json
 * - DATA\runtime\worker_runtime_status.json
 * - DATA\runtime\latest_coo_cycle.json
 * - DATA\runtime\latest_executive_brief.json
 * - DATA\runtime\work_queue.json
 * - DATA\orion_coo\latest_orion_operation.json
 *
 * Rules:
 * - Instantly and outreach state come from LiveBusinessState.
 * - Runtime health comes from current runtime outputs.
 * - ORION totals come from latest_orion_operation.metrics.
 * - ORION intelligence arrays are samples only.
 * - Dashboard remains read-only.
 */

const fs = require("fs");
const path = require("path");

const ROOT =
    process.env.MILES_ROOT ||
    path.resolve(__dirname, "..");

const DATA_DIR = path.join(ROOT, "DATA");

/* ============================================================
   FILE HELPERS
============================================================ */

function exists(file) {
    try {
        return fs.existsSync(file);
    } catch {
        return false;
    }
}

function readJson(relativePath, fallback = {}) {
    const fullPath = path.join(ROOT, relativePath);

    try {
        if (!exists(fullPath)) {
            return fallback;
        }

        const text = fs
            .readFileSync(fullPath, "utf8")
            .replace(/^\uFEFF/, "");

        return JSON.parse(text);
    } catch (error) {
        return {
            _readError: true,
            file: fullPath,
            error: error.message,
            fallback
        };
    }
}

function fileInfo(relativePath) {
    const fullPath = path.join(ROOT, relativePath);

    try {
        if (!exists(fullPath)) {
            return {
                exists: false,
                path: fullPath,
                modifiedAt: null,
                sizeBytes: 0
            };
        }

        const stat = fs.statSync(fullPath);

        return {
            exists: true,
            path: fullPath,
            modifiedAt: stat.mtime.toISOString(),
            sizeBytes: stat.size
        };
    } catch (error) {
        return {
            exists: false,
            path: fullPath,
            modifiedAt: null,
            sizeBytes: 0,
            error: error.message
        };
    }
}

/* ============================================================
   VALUE HELPERS
============================================================ */

function array(value) {
    return Array.isArray(value)
        ? value
        : [];
}

function object(value) {
    return value &&
        typeof value === "object" &&
        !Array.isArray(value)
        ? value
        : {};
}

function asNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function firstDefined(...values) {
    for (const value of values) {
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

    if (typeof value === "boolean") {
        return value
            ? "HEALTHY"
            : "UNHEALTHY";
    }

    if (typeof value === "number") {
        if (value >= 90) {
            return "HEALTHY";
        }

        if (value >= 70) {
            return "WATCH";
        }

        return "UNHEALTHY";
    }

    if (typeof value === "object") {
        return normalizeStatus(
            firstDefined(
                value.status,
                value.health,
                value.state,
                value.overall,
                value.severity,
                value.level,
                value.score
            ),
            fallback
        );
    }

    const normalized = String(value)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_");

    const aliases = {
        OK: "HEALTHY",
        ONLINE: "HEALTHY",
        RUNNING: "HEALTHY",
        CONNECTED: "HEALTHY",
        ACTIVE: "HEALTHY",
        READY: "HEALTHY",
        PASS: "HEALTHY",
        PASSED: "HEALTHY",
        GOOD: "HEALTHY",

        DEGRADED: "WATCH",
        WARNING: "WATCH",
        WARN: "WATCH",
        ATTENTION: "WATCH",

        DOWN: "UNHEALTHY",
        OFFLINE: "UNHEALTHY",
        DISCONNECTED: "UNHEALTHY",
        FAILED: "UNHEALTHY",
        ERROR: "UNHEALTHY",
        CRITICAL: "UNHEALTHY"
    };

    return (
        aliases[normalized] ||
        normalized ||
        fallback
    );
}

function durationMs(startedAt, completedAt) {
    const start = Date.parse(startedAt || "");
    const end = Date.parse(completedAt || "");

    if (
        !Number.isFinite(start) ||
        !Number.isFinite(end)
    ) {
        return 0;
    }

    return Math.max(
        0,
        end - start
    );
}

function sumNumbers(items, fields) {
    return array(items).reduce(
        (total, item) => {
            for (const field of fields) {
                const value = Number(
                    item?.[field]
                );

                if (Number.isFinite(value)) {
                    return total + value;
                }
            }

            return total;
        },
        0
    );
}

/* ============================================================
   WORK QUEUE HELPERS
============================================================ */

function queueItems(workQueue) {
    return array(
        workQueue.items ||
        workQueue.queue ||
        workQueue.workItems
    );
}

function normalizedItemStatus(item) {
    return String(
        item?.status || ""
    )
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ");
}

function openStatuses() {
    return new Set([
        "pending",
        "queued",
        "in progress",
        "running",
        "blocked",
        "awaiting approval"
    ]);
}

function countByStatus(items, ...statuses) {
    const accepted = new Set(
        statuses.map(status =>
            String(status)
                .trim()
                .toLowerCase()
                .replace(/[_-]+/g, " ")
        )
    );

    return array(items).filter(item =>
        accepted.has(
            normalizedItemStatus(item)
        )
    ).length;
}

function latestItems(items, limit = 10) {
    return [...array(items)]
        .sort((a, b) => {
            const timeB = String(
                b?.updatedAt ||
                b?.createdAt ||
                b?.generatedAt ||
                ""
            );

            const timeA = String(
                a?.updatedAt ||
                a?.createdAt ||
                a?.generatedAt ||
                ""
            );

            return timeB.localeCompare(
                timeA
            );
        })
        .slice(0, limit);
}

/* ============================================================
   CAMPAIGN HELPERS
============================================================ */

function campaignStatus(campaign) {
    return String(
        firstDefined(
            campaign?.status,
            campaign?.campaignStatus,
            campaign?.state,
            campaign?.severity,
            campaign?.rawStatus
        ) ?? ""
    )
        .trim()
        .toUpperCase();
}

function isCampaignActive(campaign) {
    if (
        campaign?.rawStatus === 0 ||
        campaign?.rawStatus === "0"
    ) {
        return true;
    }

    const status =
        campaignStatus(campaign);

    return [
        "ACTIVE",
        "RUNNING",
        "STARTED",
        "LIVE",
        "HEALTHY",
        "IN_PROGRESS"
    ].includes(status);
}

function isCampaignPaused(campaign) {
    const status =
        campaignStatus(campaign);

    return [
        "PAUSED",
        "STOPPED",
        "DISABLED",
        "FAILED",
        "ERROR"
    ].includes(status);
}

/* ============================================================
   ENGINEERING MISSION READER
============================================================ */

function missionFiles() {
    const directory = path.join(
        ROOT,
        "ENGINEERING",
        "Missions"
    );

    try {
        if (!exists(directory)) {
            return [];
        }

        return fs
            .readdirSync(directory)
            .filter(file =>
                file
                    .toLowerCase()
                    .endsWith(".json")
            )
            .map(file => {
                try {
                    const fullPath =
                        path.join(
                            directory,
                            file
                        );

                    const text = fs
                        .readFileSync(
                            fullPath,
                            "utf8"
                        )
                        .replace(/^\uFEFF/, "");

                    return JSON.parse(text);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

/* ============================================================
   DASHBOARD DATA SERVICE
============================================================ */

class DashboardDataService {
    run(input = {}) {
        return this.build(input);
    }

    build(input = {}) {
        const generatedAt =
            new Date().toISOString();

        /* ----------------------------------------------------
           READ SOURCES
        ----------------------------------------------------- */

        const repository = readJson(
            "DATA\\repository\\repository_registry.json",
            {}
        );

        const capability = readJson(
            "DATA\\capability\\capability_registry.json",
            {}
        );

        const companyState = readJson(
            "DATA\\company_state\\company_state.json",
            {}
        );

        const companyHealth = readJson(
            "DATA\\company_state\\company_health.json",
            {}
        );

        const executiveDecision = readJson(
            "DATA\\executive_brain\\latest_executive_decision.json",
            {}
        );

        const cooCycle = readJson(
            "DATA\\runtime\\latest_coo_cycle.json",
            {}
        );

        const cooHistory = readJson(
            "DATA\\runtime\\coo_cycle_history.json",
            []
        );

        const taskRouter = readJson(
            "DATA\\task_router\\latest_task_router_run.json",
            {}
        );

        const taskRouterHistory = readJson(
            "DATA\\task_router\\task_router_history.json",
            []
        );

        const workQueue = readJson(
            "DATA\\runtime\\work_queue.json",
            {
                metadata: {},
                items: []
            }
        );

        const workArchive = readJson(
            "DATA\\runtime\\work_queue_archive.json",
            []
        );

        const latestExecutiveState = readJson(
            "DATA\\latest_executive_state.json",
            {}
        );

        const runtimeExecutiveState = readJson(
            "DATA\\runtime\\latest_executive_state.json",
            {}
        );

        const liveBusinessState = readJson(
            "DATA\\runtime\\latest_live_business_state.json",
            {}
        );

        const runtimeMetrics = readJson(
            "DATA\\runtime\\runtime_metrics.json",
            {}
        );

        const workerRuntimeStatus = readJson(
            "DATA\\runtime\\worker_runtime_status.json",
            {}
        );

        const cooRuntimeHealth = readJson(
            "DATA\\runtime\\coo_runtime_health.json",
            {}
        );

        const runtimeExecutiveBrief = readJson(
            "DATA\\runtime\\latest_executive_brief.json",
            {}
        );

        const legacyExecutiveBrief = readJson(
            "DATA\\latest_executive_brief.json",
            {}
        );

        const orionOperation = readJson(
            "DATA\\orion_coo\\latest_orion_operation.json",
            {}
        );

        const engineeringMissions =
            missionFiles();

        /* ----------------------------------------------------
           QUEUE STATE
        ----------------------------------------------------- */

        const items =
            queueItems(workQueue);

        const open = items.filter(item =>
            openStatuses().has(
                normalizedItemStatus(item)
            )
        );

        const approvals =
            items.filter(item =>
                normalizedItemStatus(item) ===
                    "awaiting approval" ||
                item?.requiresKevin === true ||
                item?.approvalRequired === true
            );

        const blocked =
            items.filter(item =>
                normalizedItemStatus(item) ===
                "blocked"
            );

        const failed =
            items.filter(item =>
                normalizedItemStatus(item) ===
                "failed"
            );

        /* ----------------------------------------------------
           BUSINESS STATE
        ----------------------------------------------------- */

        const business = object(
            liveBusinessState.business ||
            companyState.business ||
            runtimeExecutiveState.business ||
            latestExecutiveState.business ||
            runtimeExecutiveBrief.business ||
            legacyExecutiveBrief.business ||
            {}
        );

        const revenue = object(
            business.revenue ||
            runtimeExecutiveState.revenue ||
            latestExecutiveState.revenue ||
            runtimeExecutiveBrief.revenue ||
            legacyExecutiveBrief.revenue ||
            {}
        );

        const marketing = object(
            business.marketing ||
            runtimeExecutiveState.marketing ||
            latestExecutiveState.marketing ||
            runtimeExecutiveBrief.marketing ||
            legacyExecutiveBrief.marketing ||
            {}
        );

        const legacyOrion = object(
            business.orion ||
            runtimeExecutiveState.orion ||
            latestExecutiveState.orion ||
            runtimeExecutiveBrief.orion ||
            legacyExecutiveBrief.orion ||
            {}
        );

        const campaigns =
            array(business.campaigns);

        const replies =
            array(business.replies);

        const mailboxes =
            array(business.mailboxes);

        const segments =
            array(business.segments);

        const deals =
            array(business.deals);

        const proposals =
            array(business.proposals);

        const opportunities =
            array(business.opportunities);

        const contractors =
            array(business.contractors);

        const metricBusiness =
            object(
                runtimeMetrics.business
            );

        const metricExecution =
            object(
                runtimeMetrics.execution
            );

        const metricQueue =
            object(
                runtimeMetrics.queue
            );

        const metricConnectors =
            object(
                runtimeMetrics.connectors
            );

        const metricMissions =
            object(
                runtimeMetrics.missions
            );

        /* ----------------------------------------------------
           ORION STATE
        ----------------------------------------------------- */

        const orionMetrics =
            object(orionOperation.metrics);

        const orionIntelligence =
            object(orionOperation.intelligence);

        const orionContractorSamples =
            array(
                orionIntelligence.contractors
            );

        const orionBuyerSamples =
            array(
                orionIntelligence.buyers
            );

        const orionOpportunitySamples =
            array(
                orionIntelligence.opportunities
            );

        const orionRecompeteSamples =
            array(
                orionIntelligence.recompetes
            );

        const orionRecommendationSamples =
            array(
                orionIntelligence.recommendations
            );

        const orionPersonaSamples =
            array(
                orionIntelligence.personas
            );

        const contractorCount =
            asNumber(
                firstDefined(
                    orionMetrics.contractors,
                    legacyOrion.contractors,
                    metricBusiness.contractors,
                    contractors.length
                ),
                0
            );

        const buyerCount =
            asNumber(
                firstDefined(
                    orionMetrics.buyers,
                    legacyOrion.buyers,
                    array(business.buyers).length
                ),
                0
            );

        const opportunityCount =
            asNumber(
                firstDefined(
                    orionMetrics.opportunities,
                    legacyOrion.opportunities,
                    metricBusiness.opportunities,
                    opportunities.length
                ),
                0
            );

        const recompeteCount =
            asNumber(
                firstDefined(
                    orionMetrics.recompetes,
                    legacyOrion.recompetes
                ),
                0
            );

        const recommendationCount =
            asNumber(
                firstDefined(
                    orionMetrics.recommendations,
                    legacyOrion.recommendations
                ),
                0
            );

        const personaCount =
            asNumber(
                firstDefined(
                    orionMetrics.personas,
                    legacyOrion.personas
                ),
                0
            );

        const vehicleCount =
            asNumber(
                firstDefined(
                    legacyOrion.vehicles,
                    array(business.vehicles).length
                ),
                0
            );

        const orionStatus =
            normalizeStatus(
                firstDefined(
                    orionOperation.status,
                    legacyOrion.status,
                    metricConnectors.ORION,
                    contractorCount > 0
                        ? "CONNECTED"
                        : undefined
                ),
                "UNKNOWN"
            );

        /* ----------------------------------------------------
           HEALTH STATE
        ----------------------------------------------------- */

        const health = object(
            companyState.health ||
            companyHealth.health ||
            cooCycle.businessHealth ||
            {}
        );

        const runtimeHealth =
            object(
                cooCycle.runtimeHealth ||
                cooRuntimeHealth.runtimeHealth ||
                cooRuntimeHealth.health ||
                {}
            );

        const restartGuardian =
            object(
                cooCycle.restartGuardian ||
                cooRuntimeHealth.restartGuardian ||
                {}
            );

        const runtimeStatus =
            normalizeStatus(
                firstDefined(
                    workerRuntimeStatus.health,
                    workerRuntimeStatus.status,
                    workerRuntimeStatus
                        .runtime
                        ?.health,
                    cooCycle
                        .health
                        ?.status,
                    cooCycle
                        .health
                        ?.health,
                    cooCycle
                        .health
                        ?.overall,
                    cooCycle
                        .businessHealth
                        ?.status,
                    runtimeHealth.status,
                    cooRuntimeHealth.status,
                    cooCycle.status,
                    runtimeMetrics
                        .runtime
                        ?.health
                ),
                metricConnectors.MILES ===
                    "CONNECTED"
                    ? "HEALTHY"
                    : "UNKNOWN"
            );

        /* ----------------------------------------------------
           CAMPAIGN METRICS
        ----------------------------------------------------- */

        const detectedActiveCampaigns =
            campaigns.filter(
                isCampaignActive
            ).length;

        const detectedPausedCampaigns =
            campaigns.filter(
                isCampaignPaused
            ).length;

        const totalCampaigns =
            Math.max(
                campaigns.length,
                asNumber(
                    metricBusiness.campaigns,
                    0
                ),
                asNumber(
                    marketing.totalCampaigns,
                    0
                )
            );

        const activeCampaigns =
            detectedActiveCampaigns > 0
                ? detectedActiveCampaigns
                : asNumber(
                    marketing.activeCampaigns,
                    0
                );

        const pausedCampaigns =
            detectedPausedCampaigns > 0
                ? detectedPausedCampaigns
                : Math.max(
                    0,
                    totalCampaigns -
                        activeCampaigns
                );

        /* ----------------------------------------------------
           REVENUE AND PROPOSALS
        ----------------------------------------------------- */

        const proposalCount =
            Math.max(
                proposals.length,
                asNumber(
                    metricBusiness.proposals,
                    0
                ),
                asNumber(
                    revenue.proposalsOutstanding,
                    0
                )
            );

        const dealCount =
            Math.max(
                deals.length,
                asNumber(
                    metricBusiness.deals,
                    0
                )
            );

        const pipelineValue =
            firstDefined(
                revenue.pipeline,
                revenue.pipelineValue,
                sumNumbers(
                    deals,
                    [
                        "weightedValue",
                        "pipelineValue",
                        "value",
                        "amount",
                        "estimatedValue"
                    ]
                )
            );

        /* ----------------------------------------------------
           COMPANY HEALTH
        ----------------------------------------------------- */

        const companyHealthScore =
            asNumber(
                firstDefined(
                    health.score,
                    companyState.healthScore,
                    companyHealth.score,
                    cooCycle
                        .businessHealth
                        ?.score,
                    cooCycle
                        .health
                        ?.score
                ),
                0
            );

        const companyHealthStatus =
            normalizeStatus(
                firstDefined(
                    health.status,
                    companyState.healthStatus,
                    companyHealth.status,
                    cooCycle
                        .businessHealth
                        ?.status
                ),
                companyHealthScore >= 75
                    ? "HEALTHY"
                    : companyHealthScore > 0
                        ? "WATCH"
                        : "UNKNOWN"
            );

        const latestCycleDuration =
            asNumber(
                firstDefined(
                    cooCycle.durationMs,
                    cooCycle
                        .runtime
                        ?.durationMs,
                    runtimeMetrics
                        .runtime
                        ?.durationMs,
                    durationMs(
                        cooCycle.startedAt,
                        cooCycle.completedAt
                    )
                ),
                0
            );

        /* ----------------------------------------------------
           ALERTS AND ACTIVITY
        ----------------------------------------------------- */

        const alerts =
            this.buildAlerts({
                health: {
                    ...health,
                    score:
                        companyHealthScore,
                    status:
                        companyHealthStatus
                },
                runtimeStatus,
                runtimeHealth,
                restartGuardian,
                approvals,
                blocked,
                failed,
                companyState,
                cooCycle,
                orionOperation
            });

        const activityFeed =
            this.buildActivityFeed({
                executiveDecision,
                cooCycle,
                cooHistory,
                taskRouter,
                taskRouterHistory,
                items,
                orionOperation
            });

        /* ====================================================
           DASHBOARD CONTRACT
        ===================================================== */

        return {
            ok: true,

            action:
                "EXECUTIVE_DASHBOARD_DATA",

            type:
                "MILES_EXECUTIVE_DASHBOARD_DATA",

            build:
                "BUILD_044",

            generatedAt,

            root:
                ROOT,

            executiveSummary: {
                companyHealthScore,

                companyHealthStatus,

                revenueGoal:
                    asNumber(
                        firstDefined(
                            revenue.goal,
                            revenue.revenueGoal
                        ),
                        10000
                    ),

                revenueCurrent:
                    asNumber(
                        firstDefined(
                            revenue.current,
                            revenue.revenueThisMonth,
                            revenue.closed
                        ),
                        0
                    ),

                pipeline:
                    asNumber(
                        pipelineValue,
                        0
                    ),

                openWork:
                    open.length,

                approvalQueue:
                    approvals.length,

                criticalAlerts:
                    alerts.filter(
                        alert =>
                            alert.severity ===
                            "CRITICAL"
                    ).length,

                warningAlerts:
                    alerts.filter(
                        alert =>
                            alert.severity ===
                            "WARNING"
                    ).length,

                runtimeStatus
            },

            cooRuntime: {
                latestCycleId:
                    firstDefined(
                        cooCycle.cycleId,
                        runtimeMetrics
                            .runtime
                            ?.cycleId,
                        null
                    ),

                latestCycleGeneratedAt:
                    firstDefined(
                        cooCycle.generatedAt,
                        cooCycle.completedAt,
                        runtimeMetrics.generatedAt,
                        null
                    ),

                latestCycleCompletedAt:
                    cooCycle.completedAt ||
                    null,

                latestCycleStatus:
                    normalizeStatus(
                        firstDefined(
                            cooCycle.status,
                            cooCycle.ok === true
                                ? "HEALTHY"
                                : undefined,
                            runtimeStatus
                        ),
                        runtimeStatus
                    ),

                latestCycleDurationMs:
                    latestCycleDuration,

                cyclesInHistory:
                    array(
                        cooHistory
                    ).length,

                runtimeHealthStatus:
                    runtimeStatus,

                restartRecommended:
                    Boolean(
                        restartGuardian
                            .restartRecommended
                    ),

                restartRecommendation:
                    restartGuardian
                        .recommendation ||
                    "No restart recommended.",

                consecutiveFailures:
                    asNumber(
                        restartGuardian
                            .consecutiveFailures,
                        0
                    ),

                heartbeat:
                    this.extractHeartbeat(
                        cooCycle
                    )
            },

            executiveBrain: {
                generatedAt:
                    executiveDecision
                        .generatedAt ||
                    null,

                decision:
                    executiveDecision
                        .decision
                        ?.decision ||
                    executiveDecision
                        .decision ||
                    null,

                approvalRequired:
                    Boolean(
                        executiveDecision
                            .decision
                            ?.approval
                            ?.approvalRequired ||
                        executiveDecision
                            .approvalRequired
                    ),

                priority:
                    executiveDecision
                        .plan
                        ?.priority ||
                    executiveDecision
                        .priority ||
                    null,

                workItemId:
                    executiveDecision
                        .workItem
                        ?.id ||
                    executiveDecision
                        .workItemId ||
                    null,

                workItemStatus:
                    executiveDecision
                        .workItem
                        ?.status ||
                    executiveDecision
                        .workItemStatus ||
                    null,

                nextAction:
                    executiveDecision
                        .nextAction ||
                    null,

                objective:
                    executiveDecision
                        .objective ||
                    null
            },

            companyState: {
                generatedAt:
                    companyState
                        .generatedAt ||
                    liveBusinessState
                        .generatedAt ||
                    null,

                health: {
                    ...health,

                    score:
                        companyHealthScore,

                    status:
                        companyHealthStatus
                },

                risks:
                    array(
                        companyState.risks ||
                        companyHealth.risks
                    ),

                priorities:
                    array(
                        companyState.priorities ||
                        companyHealth.priorities
                    ),

                operations:
                    companyState.operations ||
                    {},

                systems:
                    companyState.systems ||
                    {}
            },

            revenue: {
                goal:
                    asNumber(
                        firstDefined(
                            revenue.goal,
                            revenue.revenueGoal
                        ),
                        10000
                    ),

                current:
                    asNumber(
                        firstDefined(
                            revenue.current,
                            revenue.revenueThisMonth,
                            revenue.closed
                        ),
                        0
                    ),

                pipeline:
                    asNumber(
                        pipelineValue,
                        0
                    ),

                pipelineDeals:
                    dealCount,

                proposalsOutstanding:
                    proposalCount,

                status:
                    normalizeStatus(
                        firstDefined(
                            revenue.status,
                            proposalCount > 0 ||
                            dealCount > 0
                                ? "ACTIVE"
                                : undefined
                        ),
                        "UNKNOWN"
                    ),

                progressPct:
                    this.percent(
                        asNumber(
                            firstDefined(
                                revenue.current,
                                revenue.revenueThisMonth,
                                revenue.closed
                            ),
                            0
                        ),

                        asNumber(
                            firstDefined(
                                revenue.goal,
                                revenue.revenueGoal
                            ),
                            10000
                        )
                    )
            },

            marketing: {
                totalCampaigns,

                activeCampaigns,

                pausedCampaigns,

                emailsSentToday:
                    asNumber(
                        firstDefined(
                            marketing
                                .emailsSentToday,

                            sumNumbers(
                                campaigns,
                                [
                                    "emailsSentToday",
                                    "sentToday",
                                    "dailySent",
                                    "sent"
                                ]
                            )
                        ),
                        0
                    ),

                replies:
                    Math.max(
                        replies.length,
                        asNumber(
                            metricBusiness.replies,
                            0
                        )
                    ),

                mailboxes:
                    Math.max(
                        mailboxes.length,
                        asNumber(
                            metricBusiness.mailboxes,
                            0
                        )
                    ),

                segments:
                    Math.max(
                        segments.length,
                        asNumber(
                            metricBusiness.segments,
                            0
                        )
                    ),

                status:
                    normalizeStatus(
                        firstDefined(
                            metricConnectors
                                .INSTANTLY,
                            marketing.status,
                            totalCampaigns > 0
                                ? "CONNECTED"
                                : undefined
                        ),
                        "UNKNOWN"
                    ),

                instantlyStatus:
                    normalizeStatus(
                        firstDefined(
                            metricConnectors
                                .INSTANTLY,
                            marketing
                                .instantlyStatus,
                            marketing.status,
                            totalCampaigns > 0
                                ? "CONNECTED"
                                : undefined
                        ),
                        "UNKNOWN"
                    )
            },

            engineering: {
                totalMissions:
                    engineeringMissions.length,

                accepted:
                    engineeringMissions.filter(
                        mission =>
                            mission.status ===
                            "ACCEPTED"
                    ).length,

                completed:
                    engineeringMissions.filter(
                        mission =>
                            mission.status ===
                            "COMPLETED"
                    ).length,

                failed:
                    engineeringMissions.filter(
                        mission =>
                            mission.status ===
                            "FAILED"
                    ).length,

                active:
                    engineeringMissions.filter(
                        mission =>
                            ![
                                "COMPLETED",
                                "FAILED"
                            ].includes(
                                mission.status
                            )
                    ).length,

                runtimeMissions: {
                    revenue:
                        asNumber(
                            metricMissions.revenue,
                            0
                        ),

                    proposal:
                        asNumber(
                            metricMissions.proposal,
                            0
                        ),

                    capture:
                        asNumber(
                            metricMissions.capture,
                            0
                        ),

                    operations:
                        asNumber(
                            metricMissions.operations,
                            0
                        ),

                    total:
                        asNumber(
                            metricMissions.total,
                            0
                        )
                },

                recentMissions:
                    latestItems(
                        engineeringMissions,
                        10
                    ).map(mission => ({
                        id:
                            mission.id,

                        title:
                            mission.title,

                        status:
                            mission.status,

                        updatedAt:
                            mission.updatedAt ||
                            mission.generatedAt ||
                            null
                    }))
            },

            orion: {
                status:
                    orionStatus,

                generatedAt:
                    orionOperation.generatedAt ||
                    null,

                lastRefresh:
                    firstDefined(
                        orionOperation.generatedAt,
                        legacyOrion.lastRefresh,
                        legacyOrion.generatedAt,
                        null
                    ),

                database:
                    orionMetrics.database ||
                    null,

                databaseFreshness:
                    object(
                        orionMetrics
                            .databaseFreshness
                    ),

                tableCount:
                    asNumber(
                        orionMetrics.tableCount,
                        0
                    ),

                datasetsReady:
                    Boolean(
                        contractorCount > 0 &&
                        opportunityCount > 0
                    ),

                contractors:
                    contractorCount,

                buyers:
                    buyerCount,

                opportunities:
                    opportunityCount,

                recompetes:
                    recompeteCount,

                recommendations:
                    recommendationCount,

                personas:
                    personaCount,

                vehicles:
                    vehicleCount,

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

                sampleSizes:
                    object(
                        orionMetrics.sampleSizes
                    ),

                samples: {
                    contractors:
                        orionContractorSamples,

                    buyers:
                        orionBuyerSamples,

                    opportunities:
                        orionOpportunitySamples,

                    recompetes:
                        orionRecompeteSamples,

                    recommendations:
                        orionRecommendationSamples,

                    personas:
                        orionPersonaSamples
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

            website:
                this.buildWebsiteSection(),

            repository: {
                generatedAt:
                    repository.generatedAt ||
                    null,

                health:
                    repository.health ||
                    {},

                statistics:
                    repository.statistics ||
                    {}
            },

            capability: {
                generatedAt:
                    capability.generatedAt ||
                    null,

                autonomy:
                    capability.autonomy ||
                    {},

                statistics:
                    capability.statistics ||
                    {}
            },

            workQueue: {
                metadata:
                    workQueue.metadata ||
                    {},

                total:
                    items.length,

                open:
                    open.length,

                pending:
                    countByStatus(
                        items,
                        "Pending"
                    ),

                queued:
                    countByStatus(
                        items,
                        "Queued"
                    ),

                inProgress:
                    countByStatus(
                        items,
                        "In Progress",
                        "Running"
                    ),

                blocked:
                    blocked.length,

                awaitingApproval:
                    approvals.length,

                completed:
                    countByStatus(
                        items,
                        "Completed"
                    ),

                failed:
                    failed.length,

                archived:
                    array(
                        workArchive
                    ).length,

                runtimeMetrics: {
                    pending:
                        asNumber(
                            metricQueue.pending,
                            0
                        ),

                    running:
                        asNumber(
                            metricQueue.running,
                            0
                        ),

                    completed:
                        asNumber(
                            metricQueue.completed,
                            0
                        ),

                    failed:
                        asNumber(
                            metricQueue.failed,
                            0
                        )
                },

                executionMetrics: {
                    queued:
                        asNumber(
                            metricExecution.queued,
                            0
                        ),

                    completed:
                        asNumber(
                            metricExecution.completed,
                            0
                        ),

                    failed:
                        asNumber(
                            metricExecution.failed,
                            0
                        ),

                    requiresKevin:
                        asNumber(
                            metricExecution
                                .requiresKevin,
                            0
                        )
                },

                approvalItems:
                    latestItems(
                        approvals,
                        10
                    ),

                blockedItems:
                    latestItems(
                        blocked,
                        10
                    ),

                recentItems:
                    latestItems(
                        items,
                        20
                    )
            },

            taskRouter: {
                generatedAt:
                    taskRouter.generatedAt ||
                    null,

                summary:
                    taskRouter.summary ||
                    {},

                routed:
                    array(
                        taskRouter.routed
                    ),

                awaitingApproval:
                    array(
                        taskRouter
                            .awaitingApproval
                    ),

                skipped:
                    array(
                        taskRouter.skipped
                    )
            },

            alerts,

            activityFeed,

            files: {
                repository:
                    fileInfo(
                        "DATA\\repository\\repository_registry.json"
                    ),

                capability:
                    fileInfo(
                        "DATA\\capability\\capability_registry.json"
                    ),

                companyState:
                    fileInfo(
                        "DATA\\company_state\\company_state.json"
                    ),

                executiveBrain:
                    fileInfo(
                        "DATA\\executive_brain\\latest_executive_decision.json"
                    ),

                cooCycle:
                    fileInfo(
                        "DATA\\runtime\\latest_coo_cycle.json"
                    ),

                liveBusiness:
                    fileInfo(
                        "DATA\\runtime\\latest_live_business_state.json"
                    ),

                runtimeMetrics:
                    fileInfo(
                        "DATA\\runtime\\runtime_metrics.json"
                    ),

                workerRuntimeStatus:
                    fileInfo(
                        "DATA\\runtime\\worker_runtime_status.json"
                    ),

                executiveBrief:
                    fileInfo(
                        "DATA\\runtime\\latest_executive_brief.json"
                    ),

                orionOperation:
                    fileInfo(
                        "DATA\\orion_coo\\latest_orion_operation.json"
                    ),

                workQueue:
                    fileInfo(
                        "DATA\\runtime\\work_queue.json"
                    ),

                taskRouter:
                    fileInfo(
                        "DATA\\task_router\\latest_task_router_run.json"
                    )
            },

            metadata: {
                source:
                    input.source ||
                    "DashboardDataService",

                readOnly:
                    true,

                dataDir:
                    DATA_DIR,

                authoritativeBusinessSource:
                    "DATA\\runtime\\latest_live_business_state.json",

                authoritativeMetricsSource:
                    "DATA\\runtime\\runtime_metrics.json",

                authoritativeOrionSource:
                    "DATA\\orion_coo\\latest_orion_operation.json"
            }
        };
    }

    /* ========================================================
       PERCENTAGE
    ========================================================= */

    percent(current, goal) {
        if (
            !goal ||
            goal <= 0
        ) {
            return 0;
        }

        return Math.max(
            0,
            Math.min(
                999,
                Math.round(
                    (
                        current /
                        goal
                    ) * 100
                )
            )
        );
    }

    /* ========================================================
       HEARTBEAT
    ========================================================= */

    extractHeartbeat(cooCycle) {
        const heartbeat =
            array(
                cooCycle.results
            ).find(result =>
                result.name ===
                "HEARTBEAT"
            );

        return (
            heartbeat?.result ||
            cooCycle.heartbeat ||
            null
        );
    }

    /* ========================================================
       WEBSITE SECTION
    ========================================================= */

    buildWebsiteSection() {
        const queue = readJson(
            "DATA\\website\\website_change_queue.json",
            []
        );

        const master = readJson(
            "DATA\\website\\website_master.json",
            {}
        );

        const latestOperation =
            readJson(
                "DATA\\website_coo\\latest_website_operation.json",
                {}
            );

        const pendingChanges =
            array(
                queue.items ||
                queue
            ).filter(item =>
                ![
                    "Completed",
                    "Cancelled",
                    "Archived"
                ].includes(
                    item.status
                )
            ).length;

        return {
            status:
                normalizeStatus(
                    firstDefined(
                        latestOperation.status,
                        master.status,
                        latestOperation.ok ===
                            true
                            ? "HEALTHY"
                            : undefined
                    ),
                    "UNKNOWN"
                ),

            pendingChanges,

            lastPublish:
                firstDefined(
                    master.lastPublish,
                    master.lastPublishedAt,
                    latestOperation
                        .generatedAt,
                    null
                ),

            formsStatus:
                master.formsStatus ||
                "UNKNOWN",

            seoStatus:
                master.seoStatus ||
                "UNKNOWN"
        };
    }

    /* ========================================================
       ALERT BUILDER
    ========================================================= */

    buildAlerts(context) {
        const alerts = [];

        const add = (
            severity,
            area,
            title,
            message,
            action
        ) => {
            alerts.push({
                severity,
                area,
                title,
                message,
                action
            });
        };

        if (
            context.health.score > 0 &&
            context.health.score < 60
        ) {
            add(
                "CRITICAL",
                "Company",
                "Company health critical",
                `Health score is ${context.health.score}.`,
                "Review risks immediately."
            );
        } else if (
            context.health.score > 0 &&
            context.health.score < 75
        ) {
            add(
                "WARNING",
                "Company",
                "Company health needs attention",
                `Health score is ${context.health.score}.`,
                "Review dashboard risks."
            );
        }

        if (
            context.runtimeStatus &&
            ![
                "HEALTHY",
                "UNKNOWN"
            ].includes(
                context.runtimeStatus
            )
        ) {
            add(
                context.runtimeStatus ===
                    "UNHEALTHY"
                    ? "CRITICAL"
                    : "WARNING",

                "Runtime",

                "Runtime health needs attention",

                `Runtime status is ${context.runtimeStatus}.`,

                "Review the latest COO cycle and worker runtime."
            );
        }

        if (
            context
                .restartGuardian
                .restartRecommended
        ) {
            add(
                "CRITICAL",

                "Runtime",

                "Restart recommended",

                context
                    .restartGuardian
                    .recommendation ||
                "Restart guardian recommends action.",

                "Inspect runtime errors and perform a guarded restart."
            );
        }

        if (
            context.approvals.length > 0
        ) {
            add(
                "WARNING",

                "Executive",

                "Kevin approval queue",

                `${context.approvals.length} item(s) require approval.`,

                "Review the approval queue."
            );
        }

        if (
            context.blocked.length > 0
        ) {
            add(
                "WARNING",

                "Operations",

                "Blocked work items",

                `${context.blocked.length} work item(s) are blocked.`,

                "Route blockers to the Executive Brain."
            );
        }

        if (
            context.failed.length > 0
        ) {
            add(
                "WARNING",

                "Operations",

                "Failed work exists",

                `${context.failed.length} failed item(s) remain in the queue.`,

                "Review or archive historical failures."
            );
        }

        for (
            const exception of array(
                context
                    .orionOperation
                    ?.exceptions
            )
        ) {
            add(
                normalizeStatus(
                    exception.severity
                ) === "UNHEALTHY"
                    ? "CRITICAL"
                    : "WARNING",

                "ORION",

                exception.type ||
                    "ORION exception",

                exception.message ||
                    "ORION reported an exception.",

                array(
                    context
                        .orionOperation
                        ?.recommendations
                )[0] ||
                    "Review ORION health."
            );
        }

        for (
            const risk of array(
                context
                    .companyState
                    .risks
            )
        ) {
            add(
                risk.severity === "HIGH"
                    ? "WARNING"
                    : "INFO",

                risk.area ||
                    "Company",

                risk.message ||
                    "Company risk",

                risk.message ||
                    "Risk detected.",

                risk.action ||
                    "Review."
            );
        }

        if (!alerts.length) {
            add(
                "INFO",

                "System",

                "No active critical alerts",

                "The dashboard did not detect critical alerts.",

                "Continue autonomous COO operations."
            );
        }

        return alerts;
    }

    /* ========================================================
       ACTIVITY FEED
    ========================================================= */

    buildActivityFeed({
        executiveDecision,
        cooCycle,
        cooHistory,
        taskRouter,
        taskRouterHistory,
        items,
        orionOperation
    }) {
        const feed = [];

        const push = (
            timestamp,
            type,
            title,
            detail
        ) => {
            feed.push({
                timestamp:
                    timestamp ||
                    null,

                type,

                title,

                detail
            });
        };

        if (
            executiveDecision
                .generatedAt
        ) {
            push(
                executiveDecision
                    .generatedAt,

                "EXECUTIVE_BRAIN",

                "Latest executive decision",

                executiveDecision
                    .nextAction ||

                executiveDecision
                    .decision
                    ?.decision ||

                "Decision recorded."
            );
        }

        if (
            cooCycle.generatedAt ||
            cooCycle.completedAt
        ) {
            push(
                cooCycle.generatedAt ||
                cooCycle.completedAt,

                "COO_LOOP",

                `COO cycle ${
                    cooCycle.status ||
                    (
                        cooCycle.ok === true
                            ? "COMPLETED"
                            : "UNKNOWN"
                    )
                }`,

                `Work created: ${
                    array(
                        cooCycle.workCreated
                    ).length
                }; workflow results: ${
                    array(
                        cooCycle.workflowResults
                    ).length
                }; execution results: ${
                    array(
                        cooCycle.executionResults
                    ).length
                }`
            );
        }

        if (
            orionOperation.generatedAt
        ) {
            push(
                orionOperation.generatedAt,

                "ORION",

                `ORION status ${
                    orionOperation.status ||
                    "UNKNOWN"
                }`,

                `Contractors: ${
                    asNumber(
                        orionOperation
                            .metrics
                            ?.contractors,
                        0
                    )
                }; opportunities: ${
                    asNumber(
                        orionOperation
                            .metrics
                            ?.opportunities,
                        0
                    )
                }`
            );
        }

        for (
            const cycle of array(
                cooHistory
            ).slice(-5)
        ) {
            push(
                cycle.generatedAt ||
                cycle.completedAt,

                "COO_HISTORY",

                `Cycle ${
                    cycle.status ||
                    (
                        cycle.ok === true
                            ? "COMPLETED"
                            : "UNKNOWN"
                    )
                }`,

                `Runtime health: ${
                    cycle
                        .summary
                        ?.runtimeHealth ||

                    cycle
                        .runtimeHealth
                        ?.status ||

                    "UNKNOWN"
                }`
            );
        }

        if (
            taskRouter.generatedAt
        ) {
            push(
                taskRouter.generatedAt,

                "TASK_ROUTER",

                "Task router run",

                `Routed: ${
                    taskRouter
                        .summary
                        ?.routed ||
                    0
                }; Approval: ${
                    taskRouter
                        .summary
                        ?.awaitingApproval ||
                    0
                }; Skipped: ${
                    taskRouter
                        .summary
                        ?.skipped ||
                    0
                }`
            );
        }

        for (
            const run of array(
                taskRouterHistory
            ).slice(-5)
        ) {
            push(
                run.generatedAt,

                "TASK_ROUTER_HISTORY",

                "Router history",

                `Routed: ${
                    run.summary?.routed ||
                    0
                }; Open after: ${
                    run
                        .summary
                        ?.openAfter ||
                    0
                }`
            );
        }

        for (
            const item of latestItems(
                items,
                10
            )
        ) {
            push(
                item.updatedAt ||
                item.createdAt,

                "WORK_QUEUE",

                `${item.status}: ${item.title}`,

                item.reason ||
                item.recommendedAction ||
                item.area ||
                "Work item updated."
            );
        }

        return feed
            .filter(item =>
                item.timestamp
            )
            .sort((a, b) =>
                String(
                    b.timestamp
                ).localeCompare(
                    String(
                        a.timestamp
                    )
                )
            )
            .slice(0, 30);
    }
}

module.exports =
    new DashboardDataService();