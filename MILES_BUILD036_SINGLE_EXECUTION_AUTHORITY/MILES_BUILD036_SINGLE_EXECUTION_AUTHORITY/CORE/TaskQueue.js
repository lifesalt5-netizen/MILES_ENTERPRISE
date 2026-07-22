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

function normalizePriority(value, fallback = 50) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

class TaskQueue {
    constructor() {
        this.queuePath = path.join(ROOT, "DATA", "runtime", "task_queue.json");
        this.lockPath = path.join(ROOT, "DATA", "runtime", "task_queue.lock");
        this.backupDir = path.join(ROOT, "DATA", "runtime", "queue_backups");

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

    acquireLock() {
        this.ensureRuntime();

        const maxAttempts = 100;

        for (let i = 0; i < maxAttempts; i++) {
            try {
                fs.mkdirSync(this.lockPath);
                fs.writeFileSync(
                    path.join(this.lockPath, "owner.json"),
                    JSON.stringify({
                        pid: process.pid,
                        acquiredAt: now()
                    }, null, 2),
                    "utf8"
                );
                return true;
            } catch {
                sleepSync(50);
            }
        }

        try {
            fs.rmSync(this.lockPath, { recursive: true, force: true });
            fs.mkdirSync(this.lockPath);
            fs.writeFileSync(
                path.join(this.lockPath, "owner.json"),
                JSON.stringify({
                    pid: process.pid,
                    acquiredAt: now(),
                    recoveredStaleLock: true
                }, null, 2),
                "utf8"
            );
            return true;
        } catch {
            return false;
        }
    }

    releaseLock() {
        try {
            fs.rmSync(this.lockPath, { recursive: true, force: true });
        } catch {}
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

    readJsonDirect() {
        if (!fs.existsSync(this.queuePath)) {
            return [];
        }

        let raw = fs.readFileSync(this.queuePath, "utf8");
        raw = this.sanitizeJsonText(raw);

        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw);

        if (!Array.isArray(parsed)) {
            throw new Error("Task queue root is not an array.");
        }

        return parsed;
    }

    writeJsonDirect(tasks) {
        if (!Array.isArray(tasks)) {
            tasks = [];
        }

        this.ensureRuntime();

        const tmp = `${this.queuePath}.tmp_${process.pid}_${Date.now()}`;
        const json = JSON.stringify(tasks, null, 2);

        fs.writeFileSync(tmp, json, "utf8");

        try {
            fs.copyFileSync(tmp, this.queuePath);
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

            this.backupCorruptQueue("parse_failure");

            console.error(
                "[TaskQueue] Read failed after retries; recovering with empty queue.",
                lastError ? lastError.message : ""
            );

            this.writeJsonDirect([]);
            return [];
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
            awaitingApproval:
                tasks.filter(t => t.status === "AWAITING_APPROVAL").length,
            healthScore: this.calculateHealthScore()
        };
    }

    add(type, payload = {}, priority = 50) {
        return this.withLock(() => {
            const tasks = this.readJsonDirect();

            const task = {
                id: `TASK-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
                type,
                payload,
                priority: normalizePriority(priority),
                status: "QUEUED",
                createdAt: now(),
                updatedAt: now()
            };

            tasks.push(task);
            tasks.sort(
                (a, b) =>
                    normalizePriority(b.priority) -
                    normalizePriority(a.priority)
            );

            this.writeJsonDirect(tasks);

            logger.info(`Task queued: ${task.id}`, task);
            eventBus.publish("TASK_QUEUED", task);

            return task;
        });
    }

    list(status = null) {
        const tasks = this._read();
        return status ? tasks.filter(t => t.status === status) : tasks;
    }

    getById(id) {
        return this.list().find(task => task.id === id) || null;
    }

    update(id, patch) {
        return this.withLock(() => {
            const tasks = this.readJsonDirect();
            const index = tasks.findIndex(t => t.id === id);

            if (index === -1) {
                throw new Error(`Task not found: ${id}`);
            }

            tasks[index] = {
                ...tasks[index],
                ...patch,
                updatedAt: now()
            };

            this.writeJsonDirect(tasks);
            eventBus.publish("TASK_UPDATED", tasks[index]);

            return tasks[index];
        });
    }

    claimNext(options = {}) {
        const owner =
            String(options.owner || "MILES_RESIDENT_WORKER").trim() ||
            "MILES_RESIDENT_WORKER";

        return this.withLock(() => {
            const tasks = this.readJsonDirect();

            const candidates = tasks
                .filter(task => task.status === "QUEUED")
                .sort((a, b) => {
                    const priorityDifference =
                        normalizePriority(b.priority) -
                        normalizePriority(a.priority);

                    if (priorityDifference !== 0) {
                        return priorityDifference;
                    }

                    return (
                        new Date(a.createdAt || 0).getTime() -
                        new Date(b.createdAt || 0).getTime()
                    );
                });

            const next = candidates[0] || null;

            if (!next) {
                return null;
            }

            const index = tasks.findIndex(task => task.id === next.id);

            if (index === -1 || tasks[index].status !== "QUEUED") {
                return null;
            }

            const claimedAt = now();

            tasks[index] = {
                ...tasks[index],
                status: "RUNNING",
                claimedBy: owner,
                claimedAt,
                startedAt: claimedAt,
                updatedAt: claimedAt,
                claimCount: Number(tasks[index].claimCount || 0) + 1
            };

            this.writeJsonDirect(tasks);
            eventBus.publish("TASK_CLAIMED", tasks[index]);
            eventBus.publish("TASK_UPDATED", tasks[index]);

            return tasks[index];
        });
    }

    recoverStaleRunning(options = {}) {
        const staleMinutes = Number.isFinite(Number(options.staleMinutes))
            ? Number(options.staleMinutes)
            : 15;

        const maxRetries = Number.isFinite(Number(options.maxRetries))
            ? Number(options.maxRetries)
            : 2;

        const recoveredBy =
            String(options.recoveredBy || "MILES_RESIDENT_WORKER");

        return this.withLock(() => {
            const tasks = this.readJsonDirect();
            const current = Date.now();
            const recovered = [];

            for (let index = 0; index < tasks.length; index++) {
                const task = tasks[index];

                if (task.status !== "RUNNING") {
                    continue;
                }

                const timestamp =
                    task.updatedAt ||
                    task.startedAt ||
                    task.claimedAt ||
                    task.createdAt;

                const parsed = new Date(timestamp || 0).getTime();

                if (!Number.isFinite(parsed)) {
                    continue;
                }

                const ageMinutes = (current - parsed) / 60000;

                if (ageMinutes < staleMinutes) {
                    continue;
                }

                const retryCount = Number(task.retryCount || 0);
                const canRetry = retryCount < maxRetries;
                const recoveredAt = now();

                tasks[index] = {
                    ...task,
                    status: canRetry ? "QUEUED" : "FAILED",
                    retryCount: retryCount + 1,
                    recoveredFromStale: true,
                    recoveredBy,
                    staleRecoveredAt: recoveredAt,
                    staleAgeMinutes:
                        Math.round(ageMinutes * 100) / 100,
                    claimedBy: null,
                    claimedAt: null,
                    startedAt: null,
                    updatedAt: recoveredAt,
                    error: canRetry
                        ? null
                        : "Stale RUNNING task exceeded retry limit."
                };

                recovered.push({
                    taskId: task.id,
                    previousStatus: "RUNNING",
                    newStatus: tasks[index].status,
                    retryCount: tasks[index].retryCount,
                    ageMinutes:
                        Math.round(ageMinutes * 100) / 100
                });
            }

            if (recovered.length > 0) {
                tasks.sort((a, b) => {
                    if (a.status === "QUEUED" && b.status !== "QUEUED") {
                        return -1;
                    }

                    if (b.status === "QUEUED" && a.status !== "QUEUED") {
                        return 1;
                    }

                    return (
                        normalizePriority(b.priority) -
                        normalizePriority(a.priority)
                    );
                });

                this.writeJsonDirect(tasks);

                for (const row of recovered) {
                    const updated = tasks.find(task => task.id === row.taskId);
                    eventBus.publish("TASK_STALE_RECOVERED", updated || row);
                    eventBus.publish("TASK_UPDATED", updated || row);
                }
            }

            return recovered;
        });
    }
}

module.exports = new TaskQueue();
