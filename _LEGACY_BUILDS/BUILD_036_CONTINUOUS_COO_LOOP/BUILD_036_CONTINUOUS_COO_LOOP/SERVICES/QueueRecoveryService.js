"use strict";

/**
 * MILES Queue Recovery Service
 * BUILD_036
 * Complete replacement file.
 *
 * Purpose:
 * Protects the COO loop from malformed runtime queue JSON.
 */

const fs = require("fs");
const path = require("path");
const json = require("./JsonFileService");
const time = require("./TimeUtil");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const RUNTIME_DIR = path.join(ROOT, "DATA", "runtime");
const QUEUE_FILE = path.join(RUNTIME_DIR, "work_queue.json");
const RECOVERY_LOG = path.join(RUNTIME_DIR, "queue_recovery_log.json");

class QueueRecoveryService {
    run(input = {}) {
        const startedAt = Date.now();
        const result = this.recover(input);
        result.durationMs = Date.now() - startedAt;
        return result;
    }

    recover(input = {}) {
        json.ensureDir(RUNTIME_DIR);

        const generatedAt = time.nowIso();
        const queuePath = input.queuePath || QUEUE_FILE;

        if (!fs.existsSync(queuePath)) {
            const created = this.createFreshQueue(queuePath, "Queue file missing; initialized by QueueRecoveryService.");
            const record = {
                ok: true,
                action: "QUEUE_RECOVERY",
                generatedAt,
                status: "CREATED",
                queuePath,
                backupPath: null,
                error: null,
                result: created
            };
            this.log(record);
            return record;
        }

        try {
            const parsed = json.readJsonStrict(queuePath);
            const normalized = this.normalize(parsed);

            if (normalized.changed) {
                json.writeJson(queuePath, normalized.queue);
            }

            const record = {
                ok: true,
                action: "QUEUE_RECOVERY",
                generatedAt,
                status: normalized.changed ? "NORMALIZED" : "OK",
                queuePath,
                backupPath: null,
                error: null,
                itemCount: normalized.queue.items.length
            };
            this.log(record);
            return record;
        } catch (err) {
            const backupPath = this.backupCorruptQueue(queuePath);
            const created = this.createFreshQueue(queuePath, `Recovered after parse failure: ${err.message}`);

            const record = {
                ok: true,
                action: "QUEUE_RECOVERY",
                generatedAt,
                status: "RECOVERED_CORRUPT_QUEUE",
                queuePath,
                backupPath,
                error: err.message,
                result: created
            };

            this.log(record);
            return record;
        }
    }

    normalize(parsed) {
        const now = time.nowIso();

        if (Array.isArray(parsed)) {
            return {
                changed: true,
                queue: {
                    metadata: {
                        schemaVersion: 3,
                        createdAt: now,
                        updatedAt: now,
                        lastMigrated: now,
                        itemCount: parsed.length,
                        archivedCount: 0,
                        normalizedBy: "QueueRecoveryService"
                    },
                    items: parsed
                }
            };
        }

        const queue = {
            metadata: {
                schemaVersion: 3,
                createdAt: parsed.metadata?.createdAt || now,
                updatedAt: now,
                lastMigrated: parsed.metadata?.lastMigrated || null,
                itemCount: Array.isArray(parsed.items) ? parsed.items.length : 0,
                archivedCount: parsed.metadata?.archivedCount || 0,
                ...(parsed.metadata || {})
            },
            items: Array.isArray(parsed.items) ? parsed.items : []
        };

        const changed = !parsed.metadata || !Array.isArray(parsed.items);
        return { changed, queue };
    }

    backupCorruptQueue(queuePath) {
        const dir = path.dirname(queuePath);
        const backupPath = path.join(
            dir,
            `work_queue_corrupt_${time.timestampForFile()}.json`
        );

        fs.copyFileSync(queuePath, backupPath);
        return backupPath;
    }

    createFreshQueue(queuePath, reason) {
        const now = time.nowIso();
        const queue = {
            metadata: {
                schemaVersion: 3,
                createdAt: now,
                updatedAt: now,
                lastMigrated: null,
                itemCount: 0,
                archivedCount: 0,
                recoveryReason: reason,
                recoveredBy: "QueueRecoveryService"
            },
            items: []
        };

        json.writeJson(queuePath, queue);
        return {
            createdAt: now,
            itemCount: 0,
            reason
        };
    }

    log(record) {
        json.appendJsonArray(RECOVERY_LOG, record, 500);
    }
}

module.exports = new QueueRecoveryService();
