"use strict";

/**
 * MILES Unified Action Engine Service
 * EXEC_001
 * Complete replacement file.
 *
 * Purpose:
 * Converts routed MILES work into standard action records, dispatches safe actions,
 * verifies outcomes, records audit/history, and feeds execution state back into MILES.
 */

const fs = require("fs");
const path = require("path");

const ProviderRegistry = require("./ProviderRegistryService");
const Dispatcher = require("./ActionDispatcherService");
const Verification = require("./ActionVerificationService");
const Retry = require("./ActionRetryService");
const History = require("./ActionHistoryService");
const Audit = require("./ActionAuditService");
const WorkQueueService = require("./WorkQueueService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "action_engine");
const LATEST_FILE = path.join(OUT_DIR, "latest_action_engine_run.json");
const ACTION_QUEUE_FILE = path.join(OUT_DIR, "action_queue.json");
const REPORT_FILE = path.join(OUT_DIR, "action_engine_report.md");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch { return fallback; }
}
function writeJson(file, value) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

class ActionEngineService {
    constructor(options = {}) {
        this.queue = options.queue || new WorkQueueService({
            queuePath: path.join(ROOT, "DATA", "runtime", "work_queue.json"),
            archivePath: path.join(ROOT, "DATA", "runtime", "work_queue_archive.json")
        });
    }

    run(input = {}) {
        const startedAt = Date.now();

        console.log("");
        console.log("========================================");
        console.log(" EXEC_001 Unified Action Engine");
        console.log("========================================");

        ProviderRegistry.run();

        const mode = String(input.mode || process.env.MILES_ACTION_MODE || "SAFE").toUpperCase();
        const maxItems = Number(input.maxItems || process.env.MILES_ACTION_MAX_ITEMS || 10);
        const includeQueued = input.includeQueued !== false;

        const queuedWork = includeQueued ? this.queue.getAll().filter(item => item.status === "Queued") : [];
        const actionQueue = readJson(ACTION_QUEUE_FILE, { items: [] });
        const normalized = [];
        const dispatched = [];
        const waiting = [];
        const failed = [];

        for (const item of queuedWork.slice(0, maxItems)) {
            const actionRecord = this.normalizeWorkItem(item, mode);
            normalized.push(actionRecord);

            if (item.requiresKevin === true || item.executionType === "APPROVAL_REQUIRED") {
                actionRecord.status = "AWAITING_KEVIN_APPROVAL";
                waiting.push(actionRecord);
                continue;
            }

            const provider = ProviderRegistry.getProvider(actionRecord.provider);
            const dispatchResult = Dispatcher.dispatch(actionRecord, provider);
            const verification = Verification.verify(actionRecord, dispatchResult);

            const record = {
                ok: verification.ok === true,
                id: actionRecord.id,
                workItemId: actionRecord.workItemId,
                provider: actionRecord.provider,
                operation: actionRecord.operation,
                status: verification.verified ? "COMPLETED" : dispatchResult.status,
                actionRecord,
                dispatchResult,
                verification,
                generatedAt: new Date().toISOString()
            };

            History.append(record);
            Audit.append({
                event: "ACTION_EXECUTION",
                actionId: actionRecord.id,
                workItemId: actionRecord.workItemId,
                provider: actionRecord.provider,
                operation: actionRecord.operation,
                status: record.status,
                verified: verification.verified === true
            });

            if (verification.verified === true) {
                dispatched.push(record);
                this.queue.markCompleted(item.id, {
                    actionEngine: "EXEC_001",
                    actionId: actionRecord.id,
                    provider: actionRecord.provider,
                    operation: actionRecord.operation,
                    verified: true
                });
            } else if (dispatchResult.status === "NEEDS_PROVIDER_CONNECTOR") {
                waiting.push(record);
                this.queue.markBlocked(item.id, {
                    actionEngine: "EXEC_001",
                    actionId: actionRecord.id,
                    provider: actionRecord.provider,
                    reason: "Provider controller not yet executable."
                });
            } else if (Retry.shouldRetry(actionRecord, dispatchResult, verification)) {
                const retryAction = Retry.buildRetry(actionRecord, verification.message);
                actionQueue.items.push(retryAction);
                waiting.push({ ...record, retryQueued: true });
            } else {
                failed.push(record);
                this.queue.markFailed(item.id, {
                    actionEngine: "EXEC_001",
                    actionId: actionRecord.id,
                    provider: actionRecord.provider,
                    verification
                });
            }
        }

        actionQueue.metadata = {
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            itemCount: actionQueue.items.length
        };
        writeJson(ACTION_QUEUE_FILE, actionQueue);

        const result = {
            ok: true,
            action: "ACTION_ENGINE",
            type: "MILES_UNIFIED_ACTION_ENGINE_RUN",
            build: "EXEC_001",
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            mode,
            summary: {
                queuedWorkSeen: queuedWork.length,
                normalized: normalized.length,
                dispatched: dispatched.length,
                waiting: waiting.length,
                failed: failed.length,
                actionQueue: actionQueue.items.length
            },
            normalized,
            dispatched,
            waiting,
            failed,
            history: History.summarize(),
            outDir: OUT_DIR
        };

        this.save(result);

        console.log("");
        console.log("Action Engine Complete");
        console.log(`Normalized: ${result.summary.normalized}`);
        console.log(`Dispatched: ${result.summary.dispatched}`);
        console.log(`Waiting: ${result.summary.waiting}`);
        console.log(`Failed: ${result.summary.failed}`);
        console.log("");

        return result;
    }

    normalizeWorkItem(item, mode) {
        const text = [
            item.area,
            item.title,
            item.description,
            item.reason,
            item.recommendedAction,
            JSON.stringify(item.metadata || {})
        ].join(" ");

        const provider = ProviderRegistry.resolveProviderFromText(text);
        const operation = this.detectOperation(text, provider);

        return {
            id: `ACTION-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
            workItemId: item.id,
            generatedAt: new Date().toISOString(),
            source: "ActionEngineService",
            provider: provider?.id || "general_operations",
            providerName: provider?.name || "General Operations",
            operation,
            mode,
            priority: item.priority || 3,
            requiresKevin: item.requiresKevin === true,
            verification: "REQUIRED",
            rollback: provider?.canDelete === false ? "LIMITED" : "PROVIDER_SPECIFIC",
            status: "NORMALIZED",
            attempts: 0,
            maxRetries: 1,
            payload: {
                title: item.title,
                description: item.description,
                area: item.area,
                recommendedAction: item.recommendedAction,
                route: item.metadata?.route || null,
                sourceWorkItem: item
            },
            governance: {
                destructive: false,
                approvalRequired: item.requiresKevin === true,
                reason: item.requiresKevin === true ? "Work item requires Kevin approval." : "Authorized operational workflow."
            }
        };
    }

    detectOperation(text, provider) {
        const value = String(text || "").toLowerCase();
        if (/create.*campaign|campaign.*create|launch.*campaign/.test(value)) return "CREATE_CAMPAIGN";
        if (/upload.*lead|lead.*upload/.test(value)) return "UPLOAD_LEADS";
        if (/pause.*campaign|bounce/.test(value)) return "PAUSE_CAMPAIGN";
        if (/domain|dns|dkim|spf|dmarc/.test(value)) return "UPDATE_DNS_OR_VERIFY_AUTH";
        if (/website|page|seo|form/.test(value)) return "QUEUE_PAGE_EDIT_OR_VERIFY";
        if (/orion|dataset|contractor|buyer/.test(value)) return "GENERATE_REPORT_OR_VALIDATE_DATASET";
        if (/report|brief|dashboard/.test(value)) return "CREATE_REPORT";
        if (provider?.id === "filesystem") return "CREATE_REPORT";
        return "CREATE_INTERNAL_RECORD";
    }

    save(result) {
        ensureDir(OUT_DIR);
        writeJson(LATEST_FILE, result);
        fs.writeFileSync(REPORT_FILE, this.renderReport(result), "utf8");
    }

    renderReport(result) {
        const dispatched = result.dispatched.length
            ? result.dispatched.map(r => `- ${r.id}: ${r.provider} / ${r.operation} / ${r.status}`).join("\n")
            : "- None";
        const waiting = result.waiting.length
            ? result.waiting.map(r => `- ${r.id || r.actionRecord?.id}: ${r.provider || r.actionRecord?.provider} / ${r.operation || r.actionRecord?.operation} / ${r.status || "WAITING"}`).join("\n")
            : "- None";
        const failed = result.failed.length
            ? result.failed.map(r => `- ${r.id}: ${r.provider} / ${r.operation} / ${r.status}`).join("\n")
            : "- None";

        return `# EXEC_001 Unified Action Engine Report\n\nGenerated: ${result.generatedAt}\n\n## Summary\n\nMode: ${result.mode}  \nQueued Work Seen: ${result.summary.queuedWorkSeen}  \nNormalized: ${result.summary.normalized}  \nDispatched: ${result.summary.dispatched}  \nWaiting: ${result.summary.waiting}  \nFailed: ${result.summary.failed}\n\n## Dispatched\n\n${dispatched}\n\n## Waiting\n\n${waiting}\n\n## Failed\n\n${failed}\n`;
    }
}

module.exports = new ActionEngineService();
