"use strict";

const logger = require("../CORE/Logger");
const eventBus = require("../CORE/EventBus");
const taskQueue = require("../CORE/TaskQueue");
const workPackageService = require("./WorkPackageService");

const RECONCILE_INTERVAL_MS = Number(
    process.env.MILES_WORK_PACKAGE_RECONCILE_MS || 30000
);

function now() {
    return new Date().toISOString();
}

function normalizeStatus(status) {
    return String(status || "QUEUED")
        .trim()
        .toUpperCase();
}

function getWorkPackageId(task) {
    if (!task || typeof task !== "object") {
        return null;
    }

    return (
        task.workPackageId ||
        task.packageId ||
        task.payload?.workPackageId ||
        task.payload?.packageId ||
        null
    );
}

function getRuntimeTaskData(task) {
    return {
        ...(task?.payload || {}),
        ...(task || {})
    };
}

function buildTaskIdentity(task) {
    const source = getRuntimeTaskData(task);

    return [
        source.step ?? "",
        source.capability ?? "",
        source.provider ?? "",
        source.action ?? "",
        source.taskType ?? source.type ?? ""
    ].join("|");
}

function calculatePackageStatus(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
        return null;
    }

    const statuses = tasks.map(task => normalizeStatus(task.status));

    if (statuses.some(status => status === "FAILED")) {
        return "FAILED";
    }

    if (statuses.every(status => status === "COMPLETED")) {
        return "COMPLETED";
    }

    if (statuses.some(status => status === "BLOCKED")) {
        return "BLOCKED";
    }

    if (
        statuses.some(
            status =>
                status === "AWAITING_APPROVAL" ||
                status === "PENDING_APPROVAL"
        )
    ) {
        return "AWAITING_APPROVAL";
    }

    if (statuses.some(status => status === "RUNNING")) {
        return "RUNNING";
    }

    const hasCompleted = statuses.some(status => status === "COMPLETED");
    const hasQueued = statuses.some(
        status => status === "QUEUED" || status === "PENDING"
    );

    if (hasCompleted && hasQueued) {
        return "RUNNING";
    }

    return "QUEUED";
}

function calculateVerificationStatus(packageStatus) {
    switch (normalizeStatus(packageStatus)) {
        case "COMPLETED":
            return "PASSED";

        case "FAILED":
            return "FAILED";

        case "RUNNING":
            return "IN_PROGRESS";

        case "BLOCKED":
            return "BLOCKED";

        case "AWAITING_APPROVAL":
            return "AWAITING_APPROVAL";

        default:
            return "PENDING";
    }
}

function synchronizeEmbeddedTasks(workPackage, runtimeTasks) {
    const embeddedTasks = Array.isArray(workPackage.tasks)
        ? workPackage.tasks
        : [];

    if (embeddedTasks.length === 0) {
        return [];
    }

    const runtimeByIdentity = new Map();

    for (const runtimeTask of runtimeTasks) {
        const identity = buildTaskIdentity(runtimeTask);

        if (!runtimeByIdentity.has(identity)) {
            runtimeByIdentity.set(identity, []);
        }

        runtimeByIdentity.get(identity).push(runtimeTask);
    }

    return embeddedTasks.map((embeddedTask, index) => {
        const identity = buildTaskIdentity(embeddedTask);
        const exactMatches = runtimeByIdentity.get(identity) || [];

        let runtimeTask = exactMatches.shift() || null;

        if (!runtimeTask) {
            runtimeTask =
                runtimeTasks.find(task => {
                    const source = getRuntimeTaskData(task);

                    return (
                        Number(source.step) === Number(embeddedTask.step) &&
                        String(source.capability || "") ===
                            String(embeddedTask.capability || "")
                    );
                }) || null;
        }

        if (
            !runtimeTask &&
            runtimeTasks.length === embeddedTasks.length
        ) {
            runtimeTask = runtimeTasks[index] || null;
        }

        if (!runtimeTask) {
            return embeddedTask;
        }

        const runtimeStatus = normalizeStatus(runtimeTask.status);

        return {
            ...embeddedTask,

            taskId:
                runtimeTask.id ||
                embeddedTask.taskId ||
                null,

            status: runtimeStatus,

            startedAt:
                runtimeTask.startedAt ||
                embeddedTask.startedAt ||
                null,

            completedAt:
                runtimeTask.completedAt ||
                (
                    runtimeStatus === "COMPLETED"
                        ? runtimeTask.updatedAt || now()
                        : embeddedTask.completedAt || null
                ),

            failedAt:
                runtimeTask.failedAt ||
                (
                    runtimeStatus === "FAILED"
                        ? runtimeTask.updatedAt || now()
                        : embeddedTask.failedAt || null
                ),

            result:
                runtimeTask.result !== undefined
                    ? runtimeTask.result
                    : embeddedTask.result,

            error:
                runtimeTask.error !== undefined
                    ? runtimeTask.error
                    : embeddedTask.error,

            updatedAt:
                runtimeTask.updatedAt ||
                embeddedTask.updatedAt ||
                null
        };
    });
}

function hasMeaningfulChange(workPackage, patch) {
    if (
        normalizeStatus(workPackage.status) !==
        normalizeStatus(patch.status)
    ) {
        return true;
    }

    const currentVerificationStatus = normalizeStatus(
        workPackage.verification?.status
    );

    const nextVerificationStatus = normalizeStatus(
        patch.verification?.status
    );

    if (currentVerificationStatus !== nextVerificationStatus) {
        return true;
    }

    if (
        JSON.stringify(workPackage.tasks || []) !==
        JSON.stringify(patch.tasks || [])
    ) {
        return true;
    }

    return false;
}

class WorkPackageLifecycleService {
    constructor() {
        this.started = false;
        this.intervalHandle = null;
        this.reconciliationRunning = false;
        this.subscriptionMode = "NONE";

        this.handleTaskUpdated = event => {
    try {

        const task =
            event &&
            event.type === "TASK_UPDATED"
                ? event.payload
                : event;

        const workPackageId = getWorkPackageId(task);

        if (!workPackageId) {

            logger.warn(
                "TASK_UPDATED missing workPackageId",
                {
                    eventType: event?.type,
                    taskId: task?.id,
                    status: task?.status
                }
            );

            return;
        }

        this.reconcilePackage(workPackageId);

    } catch (error) {

        logger.error(
            "WorkPackageLifecycleService TASK_UPDATED failed",
            {
                error: error.message,
                stack: error.stack
            }
        );
    }
};
    }

    getWorkPackage(workPackageId) {
        if (
            typeof workPackageService.get === "function"
        ) {
            return workPackageService.get(workPackageId);
        }

        if (
            typeof workPackageService.getById === "function"
        ) {
            return workPackageService.getById(workPackageId);
        }

        if (
            typeof workPackageService.list === "function"
        ) {
            return (
                workPackageService
                    .list()
                    .find(item => item.id === workPackageId) ||
                null
            );
        }

        throw new Error(
            "WorkPackageService does not expose get(), getById(), or list()."
        );
    }

    subscribeToTaskUpdates() {
        if (typeof eventBus.subscribe === "function") {
            eventBus.subscribe(
                "TASK_UPDATED",
                this.handleTaskUpdated
            );

            this.subscriptionMode = "SUBSCRIBE";
            return this.subscriptionMode;
        }

        if (typeof eventBus.on === "function") {
            eventBus.on(
                "TASK_UPDATED",
                this.handleTaskUpdated
            );

            this.subscriptionMode = "ON";
            return this.subscriptionMode;
        }

        if (typeof eventBus.addListener === "function") {
            eventBus.addListener(
                "TASK_UPDATED",
                this.handleTaskUpdated
            );

            this.subscriptionMode = "ADD_LISTENER";
            return this.subscriptionMode;
        }

        this.subscriptionMode = "PERIODIC_ONLY";

        logger.warn(
            "WorkPackageLifecycleService could not subscribe to TASK_UPDATED. Periodic reconciliation remains active."
        );

        return this.subscriptionMode;
    }

    reconcilePackage(workPackageId, suppliedTasks = null) {
        const workPackage = this.getWorkPackage(workPackageId);

        if (!workPackage) {
            logger.warn(
                "Work package referenced by task was not found",
                {
                    workPackageId
                }
            );

            return {
                workPackageId,
                changed: false,
                reason: "WORK_PACKAGE_NOT_FOUND"
            };
        }

        const allTasks = Array.isArray(suppliedTasks)
            ? suppliedTasks
            : taskQueue.list();

        const linkedTasks = allTasks.filter(
            task => getWorkPackageId(task) === workPackageId
        );

        if (linkedTasks.length === 0) {
            return {
                workPackageId,
                changed: false,
                reason: "NO_LINKED_TASKS"
            };
        }

        const packageStatus =
            calculatePackageStatus(linkedTasks);

        if (!packageStatus) {
            return {
                workPackageId,
                changed: false,
                reason: "STATUS_NOT_CALCULATED"
            };
        }

        const completedTaskCount = linkedTasks.filter(
            task =>
                normalizeStatus(task.status) === "COMPLETED"
        ).length;

        const failedTaskCount = linkedTasks.filter(
            task =>
                normalizeStatus(task.status) === "FAILED"
        ).length;

        const runningTaskCount = linkedTasks.filter(
            task =>
                normalizeStatus(task.status) === "RUNNING"
        ).length;

        const queuedTaskCount = linkedTasks.filter(
            task => {
                const status = normalizeStatus(task.status);

                return (
                    status === "QUEUED" ||
                    status === "PENDING"
                );
            }
        ).length;

        const synchronizedTasks =
            synchronizeEmbeddedTasks(
                workPackage,
                linkedTasks
            );

        const patch = {
            status: packageStatus,

            tasks: synchronizedTasks,

            verification: {
                ...(workPackage.verification || {}),

                required:
                    workPackage.verification?.required !== false,

                status:
                    calculateVerificationStatus(
                        packageStatus
                    ),

                checkedAt: now()
            },

            lifecycle: {
                ...(workPackage.lifecycle || {}),

                linkedTaskCount:
                    linkedTasks.length,

                completedTaskCount,

                failedTaskCount,

                runningTaskCount,

                queuedTaskCount,

                lastReconciledAt: now()
            }
        };

        if (
            packageStatus === "RUNNING" &&
            !workPackage.startedAt
        ) {
            patch.startedAt = now();
        }

        if (
            packageStatus === "COMPLETED" &&
            !workPackage.completedAt
        ) {
            patch.completedAt = now();
        }

        if (
            packageStatus === "FAILED" &&
            !workPackage.failedAt
        ) {
            patch.failedAt = now();
        }

        if (!hasMeaningfulChange(workPackage, patch)) {
            return {
                workPackageId,
                changed: false,
                status: packageStatus,
                linkedTasks: linkedTasks.length
            };
        }

        if (
            typeof workPackageService.update !== "function"
        ) {
            throw new Error(
                "WorkPackageService does not expose update()."
            );
        }

        const updatedWorkPackage =
            workPackageService.update(
                workPackageId,
                patch
            );

        logger.info(
            "Work package lifecycle synchronized",
            {
                workPackageId,
                status: packageStatus,
                linkedTaskCount: linkedTasks.length,
                completedTaskCount,
                failedTaskCount,
                runningTaskCount,
                queuedTaskCount
            }
        );

        return {
            workPackageId,
            changed: true,
            status: packageStatus,
            linkedTasks: linkedTasks.length,
            updatedWorkPackage
        };
    }

    reconcileAll() {
        if (this.reconciliationRunning) {
            return {
                skipped: true,
                reason:
                    "RECONCILIATION_ALREADY_RUNNING"
            };
        }

        this.reconciliationRunning = true;

        try {
            const allTasks = taskQueue.list();
            const parentIds = new Set();

            for (const task of allTasks) {
                const workPackageId =
                    getWorkPackageId(task);

                if (workPackageId) {
                    parentIds.add(workPackageId);
                }
            }

            const summary = {
                scannedTasks: allTasks.length,
                linkedPackages: parentIds.size,
                changed: 0,
                unchanged: 0,
                errors: 0,
                statuses: {}
            };

            for (const workPackageId of parentIds) {
                try {
                    const result =
                        this.reconcilePackage(
                            workPackageId,
                            allTasks
                        );

                    if (result.changed) {
                        summary.changed += 1;
                    } else {
                        summary.unchanged += 1;
                    }

                    if (result.status) {
                        summary.statuses[result.status] =
                            (
                                summary.statuses[
                                    result.status
                                ] || 0
                            ) + 1;
                    }
                } catch (error) {
                    summary.errors += 1;

                    logger.error(
                        "Work package reconciliation failed",
                        {
                            workPackageId,
                            error: error.message,
                            stack: error.stack
                        }
                    );
                }
            }

            logger.info(
                "Work package lifecycle reconciliation completed",
                summary
            );

            return summary;
        } finally {
            this.reconciliationRunning = false;
        }
    }

    start() {
        if (this.started) {
            return this.getStatus();
        }

        this.started = true;

        this.subscribeToTaskUpdates();

        const startupSummary = this.reconcileAll();

        this.intervalHandle = setInterval(() => {
            try {
                this.reconcileAll();
            } catch (error) {
                logger.error(
                    "Periodic work package reconciliation failed",
                    {
                        error: error.message,
                        stack: error.stack
                    }
                );
            }
        }, RECONCILE_INTERVAL_MS);

        if (
            this.intervalHandle &&
            typeof this.intervalHandle.unref ===
                "function"
        ) {
            this.intervalHandle.unref();
        }

        logger.info(
            "WorkPackageLifecycleService started",
            {
                subscriptionMode:
                    this.subscriptionMode,

                intervalMs:
                    RECONCILE_INTERVAL_MS,

                startupSummary
            }
        );

        return this.getStatus();
    }

    stop() {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }

        this.started = false;

        return this.getStatus();
    }

    getStatus() {
        return {
            started: this.started,

            subscriptionMode:
                this.subscriptionMode,

            intervalMs:
                RECONCILE_INTERVAL_MS,

            periodicReconciliationActive:
                Boolean(this.intervalHandle),

            reconciliationRunning:
                this.reconciliationRunning
        };
    }
}

const service =
    new WorkPackageLifecycleService();

module.exports = service;
