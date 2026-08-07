"use strict";

const fs = require("fs");
const path = require("path");
const logger = require("./Logger");
const eventBus = require("./EventBus");

const ROOT = process.env.MILES_ROOT || process.cwd();

function now() {
    return new Date().toISOString();
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

class TaskQueue {
    constructor() {
        this.queuePath = path.join(ROOT, "DATA", "runtime", "task_queue.json");
        this.lockPath = path.join(ROOT, "DATA", "runtime", "task_queue.lock");
        this.backupDir = path.join(ROOT, "DATA", "runtime", "queue_backups");
        this.lastGoodPath = path.join(ROOT, "DATA", "runtime", "task_queue.last_good.json");
        this.lockToken = null;

        this.ensureRuntime();
        this.withLock(() => {
            if (!fs.existsSync(this.queuePath)) {
                this.writeJsonDirect([]);
            }
        });
    }

    ensureRuntime() {
        const dir = path.dirname(this.queuePath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    readLockOwner() {
        try {
            const ownerPath = path.join(this.lockPath, "owner.json");

            if (!fs.existsSync(ownerPath)) {
                return null;
            }

            return JSON.parse(fs.readFileSync(ownerPath, "utf8"));
        } catch {
            return null;
        }
    }

    lockAgeMs() {
        try {
            const owner = this.readLockOwner();
            const acquiredAt = new Date(owner?.acquiredAt || 0).getTime();

            if (Number.isFinite(acquiredAt) && acquiredAt > 0) {
                return Math.max(0, Date.now() - acquiredAt);
            }

            return Math.max(
                0,
                Date.now() - fs.statSync(this.lockPath).mtimeMs
            );
        } catch {
            return 0;
        }
    }

    isProcessAlive(pid) {
        const numericPid = Number(pid);

        if (!Number.isInteger(numericPid) || numericPid <= 0) {
            return false;
        }

        try {
            process.kill(numericPid, 0);
            return true;
        } catch (error) {
            return error?.code === "EPERM";
        }
    }

    canReclaimLock() {
        if (!fs.existsSync(this.lockPath)) {
            return false;
        }

        const staleAfterMs = Math.max(
            1000,
            Number(process.env.MILES_QUEUE_LOCK_STALE_MS || 5000)
        );

        if (this.lockAgeMs() < staleAfterMs) {
            return false;
        }

        const owner = this.readLockOwner();

        return !owner || !this.isProcessAlive(owner.pid);
    }

    acquireLock() {
        this.ensureRuntime();

        const timeoutMs = Math.max(
            250,
            Number(process.env.MILES_QUEUE_LOCK_TIMEOUT_MS || 10000)
        );
        const retryMs = Math.max(
            10,
            Number(process.env.MILES_QUEUE_LOCK_RETRY_MS || 50)
        );
        const deadline = Date.now() + timeoutMs;

        while (Date.now() <= deadline) {
            const token =
                `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

            try {
                fs.mkdirSync(this.lockPath);
                fs.writeFileSync(
                    path.join(this.lockPath, "owner.json"),
                    JSON.stringify({
                        pid: process.pid,
                        token,
                        acquiredAt: now()
                    }, null, 2),
                    "utf8"
                );
                this.lockToken = token;
                return true;
            } catch {
                if (this.canReclaimLock()) {
                    try {
                        fs.rmSync(this.lockPath, {
                            recursive: true,
                            force: true
                        });
                        continue;
                    } catch {}
                }

                sleepSync(retryMs);
            }
        }

        return false;
    }

    releaseLock() {
        try {
            const owner = this.readLockOwner();

            if (
                owner &&
                owner.pid === process.pid &&
                owner.token === this.lockToken
            ) {
                fs.rmSync(this.lockPath, {
                    recursive: true,
                    force: true
                });
            }
        } catch {
        } finally {
            this.lockToken = null;
        }
    }

    withLock(fn) {
        const locked = this.acquireLock();

        if (!locked) {
            throw new Error("TaskQueue lock could not be acquired.");
        }

        try {
            return fn();
        } finally {
            this.releaseLock();
        }
    }

    sanitizeJsonText(text) {
        return String(text || "")
            .replace(/^\uFEFF/, "")
            .trim();
    }

    backupCorruptQueue(reason) {
        try {
            if (!fs.existsSync(this.queuePath)) {
                return null;
            }

            const stamp = new Date()
                .toISOString()
                .replace(/[-:.TZ]/g, "")
                .slice(0, 14);

            const backupPath = path.join(
                this.backupDir,
                `task_queue_corrupt_${reason}_${stamp}.json`
            );

            fs.copyFileSync(this.queuePath, backupPath);
            console.error(`[TaskQueue] Corrupt queue backed up: ${backupPath}`);

            return backupPath;
        } catch (err) {
            console.error("[TaskQueue] Failed to backup corrupt queue:", err.message);
            return null;
        }
    }

    taskTimestamp(task) {
        const value =
            task?.updatedAt ||
            task?.createdAt ||
            "";

        const parsed = new Date(value).getTime();

        return Number.isFinite(parsed)
            ? parsed
            : 0;
    }

    statusRank(status) {
        const ranks = {
            QUEUED: 10,
            PENDING: 10,
            AUTHORIZED: 20,
            RUNNING: 30,
            AWAITING_APPROVAL: 40,
            AWAITING_CEO_APPROVAL: 40,
            BLOCKED: 40,
            COMPLETED: 50,
            FAILED: 50,
            CANCELLED: 50
        };

        return ranks[String(status || "").toUpperCase()] || 0;
    }

    normalizeTasks(tasks) {
        if (!Array.isArray(tasks)) {
            return [];
        }

        const byId = new Map();
        const withoutId = [];

        for (const task of tasks) {
            if (!task || typeof task !== "object") {
                continue;
            }

            const id = String(task.id || "").trim();

            if (!id) {
                withoutId.push(task);
                continue;
            }

            const existing = byId.get(id);

            if (!existing) {
                byId.set(id, task);
                continue;
            }

            const existingTime = this.taskTimestamp(existing);
            const incomingTime = this.taskTimestamp(task);

            let winner;

            if (incomingTime > existingTime) {
                winner = task;
            } else if (existingTime > incomingTime) {
                winner = existing;
            } else {
                winner =
                    this.statusRank(task.status) >
                    this.statusRank(existing.status)
                        ? task
                        : existing;
            }

            byId.set(id, winner);
        }

        return [
            ...byId.values(),
            ...withoutId
        ];
    }

    readJsonDirect() {
        if (!fs.existsSync(this.queuePath)) {
            return [];
        }

        let raw = fs.readFileSync(
            this.queuePath,
            "utf8"
        );

        raw = this.sanitizeJsonText(raw);

        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw);

        if (!Array.isArray(parsed)) {
            throw new Error(
                "Task queue root is not an array."
            );
        }

        return this.normalizeTasks(parsed);
    }

    writeJsonDirect(tasks) {
        if (!Array.isArray(tasks)) {
            tasks = [];
        }

        this.ensureRuntime();

        let currentTasks = [];

        try {
            if (fs.existsSync(this.queuePath)) {
                let raw = fs.readFileSync(
                    this.queuePath,
                    "utf8"
                );

                raw = this.sanitizeJsonText(raw);

                if (raw) {
                    const parsed = JSON.parse(raw);

                    if (Array.isArray(parsed)) {
                        currentTasks = parsed;
                    }
                }
            }
        } catch (error) {
            throw new Error(
                "[TaskQueue] Refusing to overwrite unreadable queue: " +
                error.message
            );
        }

        /*
         * Merge current disk state with the incoming snapshot.
         *
         * normalizeTasks keeps the newest version of each task ID,
         * preventing stale processes or duplicate records from restoring
         * an older QUEUED state.
         */
        const normalized = this.normalizeTasks([
            ...currentTasks,
            ...tasks
        ]);

        const tmp =
            `${this.queuePath}.tmp_` +
            `${process.pid}_` +
            `${Date.now()}`;

        const json = JSON.stringify(
            normalized,
            null,
            2
        );

        const descriptor = fs.openSync(tmp, "wx");

        try {
            fs.writeFileSync(descriptor, json, "utf8");
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }

        try {
            /*
             * POSIX rename replaces atomically. Windows may reject replacement
             * of an existing file, so retain a verified last-good snapshot
             * before the remove-and-rename fallback.
             */
            if (fs.existsSync(this.queuePath)) {
                fs.copyFileSync(
                    this.queuePath,
                    this.lastGoodPath
                );
            }

            try {
                fs.renameSync(tmp, this.queuePath);
            } catch (error) {
                if (!["EEXIST", "EPERM", "EACCES"].includes(error?.code)) {
                    throw error;
                }

                fs.rmSync(this.queuePath, { force: true });
                fs.renameSync(tmp, this.queuePath);
            }

            fs.copyFileSync(
                this.queuePath,
                this.lastGoodPath
            );
        } catch (error) {
            if (
                !fs.existsSync(this.queuePath) &&
                fs.existsSync(this.lastGoodPath)
            ) {
                fs.copyFileSync(
                    this.lastGoodPath,
                    this.queuePath
                );
            }

            throw error;
        } finally {
            try {
                fs.unlinkSync(tmp);
            } catch {}
        }
    }
    _read() {
        return this.withLock(() => {
            const maxRetries = 5;
            let lastError = null;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    return this.readJsonDirect();
                } catch (err) {
                    lastError = err;
                    sleepSync(100);
                }
            }

            const corruptBackup =
                this.backupCorruptQueue("parse_failure");

            const message =
                "[TaskQueue] Production queue could not be parsed after retries. " +
                "The queue was quarantined but was NOT replaced with an empty queue. " +
                "Backup: " +
                String(corruptBackup || "unavailable") +
                ". Cause: " +
                String(
                    lastError
                        ? lastError.message
                        : "Unknown queue parse failure."
                );

            console.error(message);

            /*
             * BUILD134
             *
             * Never convert an unreadable production queue into [].
             *
             * Returning [] makes a queue-corruption incident appear to be
             * a legitimate empty queue and causes permanent task loss.
             *
             * Fail closed so the supervisor can stop execution, preserve
             * evidence and allow deterministic recovery.
             */
            throw new Error(message);
        });
    }

    _write(tasks) {
        return this.withLock(() => {
            this.writeJsonDirect(tasks);
        });
    }

    calculateHealthScore() {
        const tasks = this._read();
        const current = Date.now();

        let score = 100;

        for (const t of tasks) {
            const baseTime = t.updatedAt || t.createdAt || now();
            const parsedTime = new Date(baseTime).getTime();

            const ageHours =
                Number.isFinite(parsedTime)
                    ? (current - parsedTime) / 3600000
                    : 0;

            const decay =
                ageHours < 6 ? 1.0 :
                ageHours < 24 ? 0.6 :
                ageHours < 72 ? 0.3 :
                0.1;

            if (t.status === "FAILED") score -= 6 * decay;
            if (t.status === "COMPLETED") score += 1.5 * decay;
            if (t.status === "RUNNING") score += 0.2;
        }

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    getStatus() {
        const tasks = this._read();

        return {
            total: tasks.length,
            pending: tasks.filter(t => t.status === "QUEUED").length,
            running: tasks.filter(t => t.status === "RUNNING").length,
            completed: tasks.filter(t => t.status === "COMPLETED").length,
            failed: tasks.filter(t => t.status === "FAILED").length,
            healthScore: this.calculateHealthScore()
        };
    }

    add(type, payload = {}, priority = 50) {
    return this.withLock(() => {
    const tasks = this.readJsonDirect();

    let task;

    // BUILD115 - Accept complete task objects
    if (
        typeof type === "object" &&
        type !== null &&
        !Array.isArray(type)
    ) {

        task = {
            id:
                type.id ||
                `TASK-${Date.now()}-${Math.floor(Math.random() * 100000)}`,

            ...type,

            payload:
                type.payload || {},

            priority:
                Number(type.priority ?? priority),

            status:
                type.status || "QUEUED",

            createdAt:
                type.createdAt || now(),

            updatedAt:
                now()
        };

    } else {

        task = {
            id:
                `TASK-${Date.now()}-${Math.floor(Math.random() * 100000)}`,

            type,
            payload,
            priority,

            status: "QUEUED",

            createdAt: now(),

            updatedAt: now()
        };
    }

    // BUILD123A - Prevent duplicate active autonomous repair tasks
    const activeStatuses = new Set([
        "QUEUED",
        "RUNNING",
        "AWAITING_APPROVAL",
        "AWAITING_CEO_APPROVAL"
    ]);

    const deduplicatedTaskTypes = new Set([
        "ENGINEERING_REPAIR",
        "CAPABILITY_GAP_REVIEW"
    ]);

    const taskType = String(task.type || "");
    const taskCapability = String(
        task.payload?.capability ||
        task.capability ||
        ""
    );

    if (deduplicatedTaskTypes.has(taskType)) {
        const existingTask = tasks.find(existing => {
            const existingType = String(existing.type || "");
            const existingCapability = String(
                existing.payload?.capability ||
                existing.capability ||
                ""
            );

            return (
                existingType === taskType &&
                existingCapability === taskCapability &&
                activeStatuses.has(String(existing.status || ""))
            );
        });

        if (existingTask) {
            return {
                ...existingTask,
                duplicateSuppressed: true,
                duplicateRequestedAt: now()
            };
        }
    }

    tasks.push(task);

    tasks.sort(
        (a, b) =>
            Number(b.priority || 0) -
            Number(a.priority || 0)
    );
this.writeJsonDirect(tasks);

    logger.info(
        `Task queued: ${task.id}`,
        task
    );

    eventBus.publish(
        "TASK_QUEUED",
        task
    );

    return task;
    });
}

    recoverStaleRunningTasks(options = {}) {
        const staleAfterMs =
            Number(options.staleAfterMs) > 0
                ? Number(options.staleAfterMs)
                : Number(
                    process.env.MILES_STALE_TASK_TIMEOUT_MS ||
                    600000
                );

        const recoveredBy =
            options.recoveredBy ||
            "TaskQueue.recoverStaleRunningTasks";

        const currentTime = Date.now();

        return this.withLock(() => {
            const tasks = this.readJsonDirect();
            const recovered = [];

            for (const task of tasks) {
                if (
                    !task ||
                    String(task.status || "").toUpperCase() !==
                        "RUNNING"
                ) {
                    continue;
                }

                const timestamp =
                    task.startedAt ||
                    task.updatedAt ||
                    task.createdAt;

                const parsed =
                    new Date(timestamp || 0).getTime();

                const ageMs =
                    Number.isFinite(parsed)
                        ? currentTime - parsed
                        : Number.MAX_SAFE_INTEGER;

                if (ageMs < staleAfterMs) {
                    continue;
                }

                const recoveredAt = now();

                task.status = "QUEUED";
                task.updatedAt = recoveredAt;
                task.startedAt = null;
                task.completedAt = null;
                task.failedAt = null;
                task.error = null;

                task.recovery = {
                    recovered: true,
                    recoveredAt,
                    recoveredBy,
                    previousStatus: "RUNNING",
                    staleAfterMs,
                    observedAgeMs: ageMs,
                    reason:
                        "Recovered stale RUNNING task after interrupted or terminated execution."
                };

                task.recoveryCount =
                    Number(task.recoveryCount || 0) + 1;

                recovered.push({
                    id: task.id,
                    provider:
                        task.provider ||
                        task.payload?.provider ||
                        null,
                    action:
                        task.action ||
                        task.payload?.action ||
                        null,
                    observedAgeMs: ageMs,
                    recoveryCount:
                        task.recoveryCount
                });
            }

            if (recovered.length) {
                this.writeJsonDirect(tasks);

                for (const item of recovered) {
                    logger.info(
                        `[BUILD141_STALE_RECOVERY] ${item.id} RUNNING => QUEUED`,
                        item
                    );

                    try {
                        eventBus.publish(
                            "TASK_RECOVERED",
                            item
                        );
                    } catch {}
                }
            }

            return {
                ok: true,
                staleAfterMs,
                recoveredCount:
                    recovered.length,
                recovered
            };
        });
    }

    dependencyIds(task = {}) {
        const raw =
            task.dependsOn ||
            task.dependencies ||
            task.payload?.dependsOn ||
            task.payload?.dependencies ||
            [];

        return (Array.isArray(raw) ? raw : [raw])
            .map(value => {
                if (value && typeof value === "object") {
                    return String(
                        value.id ||
                        value.taskId ||
                        ""
                    ).trim();
                }

                return String(value || "").trim();
            })
            .filter(Boolean);
    }

    recoverRetryableFailedTasks(options = {}) {
        const retryDelayMs = Math.max(
            0,
            Number(
                options.retryDelayMs ??
                process.env.MILES_QUEUE_RETRY_DELAY_MS ??
                5000
            )
        );
        const currentTime = Date.now();

        return this.withLock(() => {
            const tasks = this.readJsonDirect();
            const recovered = [];

            for (const task of tasks) {
                if (
                    String(task?.status || "").toUpperCase() !== "FAILED"
                ) {
                    continue;
                }

                const retryable =
                    task.retryable === true ||
                    task.result?.retryable === true ||
                    task.failure?.retryable === true ||
                    task.result?.failure?.retryable === true;

                if (!retryable) {
                    continue;
                }

                const retryCount = Number(task.retryCount || 0);
                const maxRetries = Math.max(
                    0,
                    Number(
                        task.maxRetries ??
                        task.payload?.maxRetries ??
                        1
                    )
                );

                if (retryCount >= maxRetries) {
                    continue;
                }

                const failedAt = new Date(
                    task.failedAt ||
                    task.updatedAt ||
                    task.result?.createdAt ||
                    0
                ).getTime();
                const eligibleAt = new Date(
                    task.nextRetryAt ||
                    (
                        Number.isFinite(failedAt)
                            ? failedAt + retryDelayMs
                            : currentTime
                    )
                ).getTime();

                if (
                    Number.isFinite(eligibleAt) &&
                    eligibleAt > currentTime
                ) {
                    continue;
                }

                task.status = "QUEUED";
                task.retryCount = retryCount + 1;
                task.updatedAt = now();
                task.startedAt = null;
                task.completedAt = null;
                task.failedAt = null;
                task.nextRetryAt = null;
                task.retry = {
                    scheduled: true,
                    retryCount: task.retryCount,
                    maxRetries,
                    recoveredAt: task.updatedAt,
                    recoveredBy:
                        options.recoveredBy ||
                        "TaskQueue.recoverRetryableFailedTasks"
                };

                recovered.push(task.id);
            }

            if (recovered.length) {
                this.writeJsonDirect(tasks);
            }

            return {
                ok: true,
                recoveredCount: recovered.length,
                recovered
            };
        });
    }

    claimNextExecutableTask(options = {}) {
        if (options.recoverStale !== false) {
            this.recoverStaleRunningTasks({
                staleAfterMs: options.staleAfterMs,
                recoveredBy:
                    options.recoveredBy ||
                    "TaskQueue.claimNextExecutableTask"
            });
        }

        if (options.recoverRetries !== false) {
            this.recoverRetryableFailedTasks({
                retryDelayMs: options.retryDelayMs,
                recoveredBy:
                    options.recoveredBy ||
                    "TaskQueue.claimNextExecutableTask"
            });
        }

        return this.withLock(() => {
            const tasks = this.readJsonDirect();
            const byId = new Map(
                tasks
                    .filter(task => task?.id)
                    .map(task => [String(task.id), task])
            );
            const candidates = [];
            let changed = false;
            const currentTime = Date.now();

            for (const task of tasks) {
                if (
                    String(task?.status || "").toUpperCase() !== "QUEUED"
                ) {
                    continue;
                }

                const nextAttemptAt = new Date(
                    task.nextAttemptAt ||
                    task.nextRetryAt ||
                    0
                ).getTime();

                if (
                    Number.isFinite(nextAttemptAt) &&
                    nextAttemptAt > currentTime
                ) {
                    continue;
                }

                const dependencies = this.dependencyIds(task);
                let waiting = false;
                let blockedReason = null;

                for (const dependencyId of dependencies) {
                    const dependency = byId.get(dependencyId);

                    if (!dependency) {
                        blockedReason =
                            `Required dependency not found: ${dependencyId}`;
                        break;
                    }

                    const dependencyStatus =
                        String(dependency.status || "").toUpperCase();

                    if (
                        ["FAILED", "CANCELLED", "BLOCKED"].includes(
                            dependencyStatus
                        )
                    ) {
                        blockedReason =
                            `Dependency ${dependencyId} ended as ${dependencyStatus}`;
                        break;
                    }

                    if (
                        !["COMPLETED", "COMPLETE"].includes(
                            dependencyStatus
                        )
                    ) {
                        waiting = true;
                    }
                }

                if (blockedReason) {
                    task.status = "BLOCKED";
                    task.error = blockedReason;
                    task.updatedAt = now();
                    task.dependencyState = {
                        ok: false,
                        blocked: true,
                        reason: blockedReason,
                        checkedAt: task.updatedAt
                    };
                    changed = true;
                    continue;
                }

                if (!waiting) {
                    candidates.push(task);
                }
            }

            candidates.sort((a, b) => {
                const priority =
                    Number(a.priority ?? 99) -
                    Number(b.priority ?? 99);

                if (priority !== 0) {
                    return priority;
                }

                return (
                    this.taskTimestamp(a) -
                    this.taskTimestamp(b)
                );
            });

            const selected = candidates[0] || null;

            if (selected) {
                const claimedAt = now();

                selected.status = "RUNNING";
                selected.startedAt = claimedAt;
                selected.updatedAt = claimedAt;
                selected.attemptCount =
                    Number(selected.attemptCount || 0) + 1;
                selected.claim = {
                    pid: process.pid,
                    claimedAt,
                    claimedBy:
                        options.claimedBy ||
                        options.recoveredBy ||
                        "TaskQueue.claimNextExecutableTask"
                };
                changed = true;
            }

            if (changed) {
                this.writeJsonDirect(tasks);
            }

            return selected
                ? { ...selected }
                : null;
        });
    }

    list(status = null) {
        const tasks = this._read();
        return status ? tasks.filter(t => t.status === status) : tasks;
    }

    update(id, patch) {
        const updatedTask = this.withLock(() => {
            const tasks = this.readJsonDirect();
            const index = tasks.findIndex(task => task.id === id);

            if (index === -1) {
                throw new Error(`Task not found: ${id}`);
            }

            tasks[index] = {
                ...tasks[index],
                ...patch,
                updatedAt: now()
            };

            this.writeJsonDirect(tasks);

            return tasks[index];
        });

        if (patch.status) {
            console.log(
                "[BUILD127_ATOMIC_UPDATE]",
                id,
                "=>",
                patch.status
            );
        }

        eventBus.publish(
            "TASK_UPDATED",
            updatedTask
        );

        return updatedTask;
    }
}
module.exports = new TaskQueue();





