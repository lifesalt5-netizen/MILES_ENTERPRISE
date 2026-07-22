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
            healthScore: this.calculateHealthScore()
        };
    }

    add(type, payload = {}, priority = 50) {
    const tasks = this._read();

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
    );// BUILD126_TRACE
        if (patch.status) {
            console.log(
                "[BUILD126_TRACE]",
                id,
                "=>",
                patch.status
            );
        }



    this._write(tasks);

    logger.info(
        `Task queued: ${task.id}`,
        task
    );

    eventBus.publish(
        "TASK_QUEUED",
        task
    );

    return task;
}

    list(status = null) {
        const tasks = this._read();
        return status ? tasks.filter(t => t.status === status) : tasks;
    }

    update(id, patch) {
        const tasks = this._read();
        const index = tasks.findIndex(t => t.id === id);

        if (index === -1) {
            throw new Error(`Task not found: ${id}`);
        }

        tasks[index] = {
            ...tasks[index],
            ...patch,
            updatedAt: now()
        };// BUILD126_TRACE
        if (patch.status) {
            console.log(
                "[BUILD126_TRACE]",
                id,
                "=>",
                patch.status
            );
        }



        this._write(tasks);

        eventBus.publish("TASK_UPDATED", tasks[index]);

        return tasks[index];
    }
}

module.exports = new TaskQueue();

