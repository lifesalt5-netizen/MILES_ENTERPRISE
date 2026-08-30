"use strict";

const fs = require("fs");
const path = require("path");

const OPEN_STATUSES = [
    "Pending",
    "Queued",
    "In Progress",
    "Blocked",
    "Awaiting Approval"
];

const CLOSED_STATUSES = [
    "Completed",
    "Failed",
    "Cancelled",
    "Archived"
];

const AUTONOMOUS_OPERATIONAL_EXCEPTION_TYPES = new Set([
    "WebsiteProviderLoadFailure",
    "ConnectorFailure",
    "HealthCheckFailure",
    "RepositorySearchFailure",
    "ProviderInitializationFailure",
    "RuntimeFailure",
    "ProviderLoadFailure",
    "ServiceInitializationFailure"
]);

const PROTECTED_GOVERNANCE_TERMS =
    /delete|pricing|price|contract|legal|publish|dns|domain|payment|hire|fire|sign|agreement|financial commitment/i;

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

class WorkQueueService {
    constructor(options = {}) {
        this.schemaVersion = 6;

        this.queuePath =
            options.queuePath ||
            path.join(process.cwd(), "DATA", "runtime", "work_queue.json");

        this.archivePath =
            options.archivePath ||
            path.join(process.cwd(), "DATA", "runtime", "work_queue_archive.json");

        this.queue = [];

        this.metadata = {
            schemaVersion: this.schemaVersion,
            createdAt: new Date().toISOString(),
            updatedAt: null,
            lastMigrated: null,
            itemCount: 0,
            archivedCount: 0
        };

        this.load();
    }

    ensureDir(filePath) {
        const dir = path.dirname(filePath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    normalizeBoolean(value) {
        if (value === true) return true;
        if (value === false) return false;

        if (typeof value === "string") {
            const text = value.trim().toLowerCase();

            if (text === "true" || text === "yes" || text === "1") {
                return true;
            }

            if (
                text === "false" ||
                text === "no" ||
                text === "0" ||
                text === ""
            ) {
                return false;
            }
        }

        if (typeof value === "number") {
            return value !== 0;
        }

        return Boolean(value);
    }

    readJsonWithRetry(filePath, fallback, label) {
        const maxRetries = 5;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (!fs.existsSync(filePath)) {
                    return fallback;
                }

                let raw = fs.readFileSync(filePath, "utf8");
                raw = raw.replace(/^\uFEFF/, "").trim();

                if (!raw) {
                    return fallback;
                }

                return JSON.parse(raw);
            } catch (err) {
                if (attempt < maxRetries) {
                    sleepSync(100);
                    continue;
                }

                const backupPath = `${filePath}.corrupt_${new Date()
                    .toISOString()
                    .replace(/[-:.TZ]/g, "")
                    .slice(0, 14)}.json`;

                try {
                    fs.copyFileSync(filePath, backupPath);
                    console.error(
                        `[WorkQueueService] ${label} was unreadable. Backup created: ${backupPath}`
                    );
                } catch (backupErr) {
                    console.error(
                        `[WorkQueueService] Failed to backup unreadable ${label}:`,
                        backupErr.message
                    );
                }

                console.error(
                    `[WorkQueueService] Failed to read ${label} after retries:`,
                    err.message
                );

                return fallback;
            }
        }

        return fallback;
    }

    writeJsonAtomic(filePath, value) {
        this.ensureDir(filePath);

        const payload = JSON.stringify(value, null, 2);
        const tempPath = `${filePath}.tmp_${process.pid}_${Date.now()}`;

        try {
            fs.writeFileSync(tempPath, payload, "utf8");

            try {
                fs.renameSync(tempPath, filePath);
                return;
            } catch (renameErr) {
                if (
                    renameErr &&
                    renameErr.code !== "EPERM" &&
                    renameErr.code !== "EACCES"
                ) {
                    throw renameErr;
                }

                console.warn(
                    `[WorkQueueService] Atomic rename failed (${renameErr.code}). Falling back to copy/write: ${filePath}`
                );

                try {
                    fs.copyFileSync(tempPath, filePath);
                    fs.unlinkSync(tempPath);
                    return;
                } catch (copyErr) {
                    console.warn(
                        `[WorkQueueService] Copy fallback failed (${copyErr.code || copyErr.message}). Trying direct write.`
                    );

                    fs.writeFileSync(filePath, payload, "utf8");

                    try {
                        if (fs.existsSync(tempPath)) {
                            fs.unlinkSync(tempPath);
                        }
                    } catch {}

                    return;
                }
            }
        } catch (err) {
            try {
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
            } catch {}

            throw err;
        }
    }

    load() {
        this.ensureDir(this.queuePath);

        if (!fs.existsSync(this.queuePath)) {
            this.queue = [];
            this.save();
            return;
        }

        const parsed = this.readJsonWithRetry(
            this.queuePath,
            {
                metadata: this.metadata,
                items: []
            },
            "work queue"
        );

        if (Array.isArray(parsed)) {
            this.queue = parsed;
            this.metadata = {
                schemaVersion: 1,
                createdAt: null,
                updatedAt: null,
                lastMigrated: null,
                itemCount: this.queue.length,
                archivedCount: 0
            };
        } else {
            this.metadata = parsed.metadata || this.metadata;
            this.queue = Array.isArray(parsed.items) ? parsed.items : [];
        }

        this.migrate();
        this.deduplicateOpenItems();
    }

    migrate() {
        let migrated = false;

        for (const item of this.queue) {
            if (!item.id) {
                item.id = this.generateId();
                migrated = true;
            }

            const migratedCapability =
                item.capability ||
                item.metadata?.capability ||
                null;

            const migratedProvider =
                item.provider ||
                item.relatedProvider ||
                item.metadata?.provider ||
                null;

            const migratedAction =
                item.action ||
                item.metadata?.action ||
                null;

            if (item.capability !== migratedCapability) {
                item.capability = migratedCapability;
                migrated = true;
            }

            if (item.provider !== migratedProvider) {
                item.provider = migratedProvider;
                migrated = true;
            }

            if (item.action !== migratedAction) {
                item.action = migratedAction;
                migrated = true;
            }

            const migratedSignature = this.buildSignature(item);

            if (item.signature !== migratedSignature) {
                item.signature = migratedSignature;
                migrated = true;
            }

            if (typeof item.requiresKevin !== "boolean") {
                item.requiresKevin = this.normalizeBoolean(item.requiresKevin);
                migrated = true;
            }

            if (!item.executionType) {
                item.executionType =
                    item.requiresKevin ? "APPROVAL_REQUIRED" : "WORKFLOW";

                migrated = true;
            }

            if (!item.createdAt) {
                item.createdAt = new Date().toISOString();
                migrated = true;
            }

            if (!item.updatedAt) {
                item.updatedAt = item.createdAt;
                migrated = true;
            }

            if (!item.status) {
                item.status = "Pending";
                migrated = true;
            }

            if (!item.metadata) {
                item.metadata = {};
                migrated = true;
            }

            if (!item.lifecycle) {
                item.lifecycle = [
                    {
                        status: item.status,
                        timestamp: item.updatedAt,
                        note: "Lifecycle initialized during migration."
                    }
                ];

                migrated = true;
            }

            if (this.applyGovernanceClassification(item, "migration")) {
                migrated = true;
            }
        }

        if (this.metadata.schemaVersion !== this.schemaVersion) {
            this.metadata.schemaVersion = this.schemaVersion;
            this.metadata.lastMigrated = new Date().toISOString();
            migrated = true;
        }

        if (migrated) {
            this.save();
            console.log(
                `[WorkQueueService] Migrated queue to schema v${this.schemaVersion}.`
            );
        }
    }

    save() {
        this.ensureDir(this.queuePath);

        this.metadata.schemaVersion = this.schemaVersion;
        this.metadata.updatedAt = new Date().toISOString();
        this.metadata.itemCount = this.queue.length;

        this.writeJsonAtomic(this.queuePath, {
            metadata: this.metadata,
            items: this.queue
        });
    }

    classifyGovernance(input = {}) {
        const type = String(
            input.type ||
            input.area ||
            input.metadata?.type ||
            input.metadata?.exception?.type ||
            ""
        ).trim();

        const title = String(input.title || "");
        const description = String(input.description || input.message || "");
        const recommendedAction = String(input.recommendedAction || "");

        const fullText =
            `${type} ${title} ${description} ${recommendedAction}`.trim();

        /*
          Exact operational failures must be classified before broad protected
          terms. Provider messages may mention a website domain without asking
          MILES to change DNS, publish, transfer, or otherwise mutate it.
        */
        if (
            AUTONOMOUS_OPERATIONAL_EXCEPTION_TYPES.has(type) ||
            /WebsiteProviderLoadFailure|provider load failure|provider initialization|connector failure|health check failure|runtime failure/i.test(
                fullText
            )
        ) {
            return {
                requiresKevin: false,
                executionType: "WORKFLOW",
                reason: "Operational diagnosis and repair may proceed autonomously."
            };
        }

        /*
          BUILD 033 — SAFE OPERATIONAL AUTHORIZATION

          Read-only analysis and internal preparation may run autonomously.
          External, destructive, credential, financial, publishing, sending,
          submission, or infrastructure-changing actions remain protected.
        */
        const safeOperationalIntent =
            /\b(audit|review|verify|refresh|scan|inspect|monitor|analy[sz]e|diagnose|classify|reconcile|report|generate report|prepare (?:an? )?(?:repair |action |remediation )?plan)\b/i.test(
                fullText
            );

        const protectedMutationIntent =
            /\b(send|launch|resume|publish|deploy|delete|remove|purge|submit|sign|purchase|charge|pay|transfer|change dns|update dns|modify dns|create mailbox|delete mailbox|change credentials|modify credentials|rotate credentials|revoke access|grant access|drop table|alter schema)\b/i.test(
                fullText
            );

        if (
            safeOperationalIntent &&
            !protectedMutationIntent
        ) {
            return {
                requiresKevin: false,
                executionType: "WORKFLOW",
                reason: "Safe operational review, audit, refresh, verification, analysis, or planning authorized autonomously."
            };
        }

        if (protectedMutationIntent) {
            return {
                requiresKevin: true,
                executionType: "APPROVAL_REQUIRED",
                reason: "Explicit protected external or destructive action detected."
            };
        }

        return {
            requiresKevin: this.normalizeBoolean(input.requiresKevin),
            executionType:
                input.executionType ||
                (this.normalizeBoolean(input.requiresKevin)
                    ? "APPROVAL_REQUIRED"
                    : "WORKFLOW"),
            reason: "Existing governance classification retained."
        };
    }

    applyGovernanceClassification(item, source = "runtime") {
        const beforeRequiresKevin = this.normalizeBoolean(item.requiresKevin);
        const beforeExecutionType = item.executionType;

        const classification = this.classifyGovernance(item);

        item.requiresKevin = classification.requiresKevin;
        item.executionType = classification.executionType;

        const beforeStatus = item.status;

        if (
            classification.requiresKevin === false &&
            item.status === "Awaiting Approval"
        ) {
            item.status = "Pending";
        }

        const changed =
            beforeRequiresKevin !== item.requiresKevin ||
            beforeExecutionType !== item.executionType ||
            beforeStatus !== item.status;

        if (changed) {
            item.updatedAt = new Date().toISOString();
            item.metadata = {
                ...(item.metadata || {}),
                governanceClassification: {
                    source,
                    reason: classification.reason,
                    classifiedAt: new Date().toISOString()
                }
            };

            this.addLifecycle(
                item,
                item.status || "Pending",
                `Governance reclassified: ${classification.reason}`
            );
        }

        return changed;
    }

    createWorkItem(input) {
        const signature = this.buildSignature(input);
        const existing = this.findOpenBySignature(signature);

        if (existing) {
            existing.updatedAt = new Date().toISOString();
            existing.duplicateDetected = true;
            existing.requiresKevin = this.normalizeBoolean(existing.requiresKevin);

            this.applyGovernanceClassification(existing, "duplicate-refresh");

            const workflowResult = existing.metadata?.workflowResult || {};

            const queuedTasks =
                Array.isArray(workflowResult.queuedTasks)
                    ? workflowResult.queuedTasks.length
                    : 0;

            const workPackageTasks =
                Array.isArray(workflowResult.workPackage?.tasks)
                    ? workflowResult.workPackage.tasks.length
                    : 0;

            const orphanQueued =
                existing.executionType === "WORKFLOW" &&
                (existing.status === "Queued" || existing.status === "QUEUED") &&
                queuedTasks === 0 &&
                workPackageTasks === 0;

            existing.metadata = {
                ...(existing.metadata || {}),
                lastDuplicateDetectedAt: new Date().toISOString()
            };

            if (orphanQueued) {
                existing.status = "Pending";
                existing.metadata.recoveredFromOrphanQueued = true;
                existing.metadata.recoveredAt = new Date().toISOString();

                this.addLifecycle(
                    existing,
                    "Pending",
                    "Recovered orphan queued workflow with zero executable tasks. Reset to Pending for automatic re-queue."
                );

                console.log("[F001] Recovered orphan workflow:", existing.id);
            } else {
                this.addLifecycle(
                    existing,
                    existing.status,
                    "Duplicate detected; existing open item reused."
                );
            }

            this.save();
            return existing;
        }

        const governance = this.classifyGovernance(input);

        const item = {
            id: this.generateId(),
            signature,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: "Pending",
            priority: input.priority || 3,
            area: input.area || "Operations",
            title: input.title || "Untitled Work Item",
            description: input.description || "",
            reason: input.reason || "",
            source: input.source || "Unknown",
            owner: input.owner || "Miles",
            requiresKevin: governance.requiresKevin,
            recommendedAction: input.recommendedAction || "",
            expectedImpact: input.expectedImpact || "",
            relatedProvider: input.relatedProvider || null,
            capability:
                input.capability ||
                input.metadata?.capability ||
                null,
            provider:
                input.provider ||
                input.relatedProvider ||
                input.metadata?.provider ||
                null,
            action:
                input.action ||
                input.metadata?.action ||
                null,
            executionType: governance.executionType,
            metadata: {
                ...(input.metadata || {}),
                governanceClassification: {
                    source: "createWorkItem",
                    reason: governance.reason,
                    classifiedAt: new Date().toISOString()
                }
            },
            lifecycle: []
        };

        this.addLifecycle(item, "Pending", "Work item created.");

        this.queue.push(item);
        this.save();

        return item;
    }
        generateFromExecutiveState(executiveState) {
        const created = [];

        if (!executiveState) {
            return created;
        }

        const marketing = executiveState.marketing || {};

        if (
            (marketing.totalCampaigns || 0) > 0 &&
            (marketing.activeCampaigns || 0) < 2
        ) {
            created.push(
                this.createWorkItem({
                    priority: 1,
                    area: "Marketing",
                    title: "Review paused Instantly campaigns",
                    description:
                        `MILES detected ${marketing.pausedCampaigns || 0} paused campaigns and only ${marketing.activeCampaigns || 0} active campaign.`,
                    reason:
                        "Outbound coverage may be below desired operating level.",
                    source: "ExecutiveIntelligenceService",
                    owner: "Miles",
                    requiresKevin: false,
                    recommendedAction:
                        "Review paused campaigns and determine which should be resumed under current deliverability rules.",
                    expectedImpact:
                        "Improves outbound coverage and revenue generation.",
                    relatedProvider: "Marketing",
                    executionType: "WORKFLOW",
                    metadata: {
                        totalCampaigns: marketing.totalCampaigns || 0,
                        activeCampaigns: marketing.activeCampaigns || 0,
                        pausedCampaigns: marketing.pausedCampaigns || 0
                    }
                })
            );
        }

        const exceptions = executiveState.exceptions || [];

        for (const exception of exceptions) {
            const severity = exception.severity || "Info";

            if (severity === "Critical") {
                const governance = this.classifyGovernance({
                    type: exception.type,
                    area: exception.type || "Operations",
                    title:
                        `Resolve critical exception: ${exception.type || "Unknown"}`,
                    description: exception.message || "",
                    recommendedAction:
                        "Investigate and resolve the critical exception immediately.",
                    requiresKevin: true,
                    executionType: "APPROVAL_REQUIRED",
                    metadata: exception
                });

                created.push(
                    this.createWorkItem({
                        priority: 1,
                        area: exception.type || "Operations",
                        title:
                            `Resolve critical exception: ${exception.type || "Unknown"}`,
                        description: exception.message || "",
                        reason:
                            "Critical exception requires immediate operational response.",
                        source: "ExecutiveIntelligenceService",
                        owner: "Miles",
                        requiresKevin: governance.requiresKevin,
                        recommendedAction:
                            "Investigate and resolve the critical exception immediately.",
                        expectedImpact:
                            "Protects business continuity and executive visibility.",
                        relatedProvider: exception.provider || null,
                        executionType: governance.executionType,
                        metadata: exception
                    })
                );
            }

            if (severity === "Warning") {
                created.push(
                    this.createWorkItem({
                        priority: 2,
                        area: exception.type || "Operations",
                        title:
                            `Investigate warning: ${exception.type || "Unknown"}`,
                        description: exception.message || "",
                        reason:
                            "Warning may become operational risk if unresolved.",
                        source: "ExecutiveIntelligenceService",
                        owner: "Miles",
                        requiresKevin: false,
                        recommendedAction:
                            "Investigate warning and resolve if authorized.",
                        expectedImpact:
                            "Reduces operational risk.",
                        relatedProvider: exception.provider || null,
                        executionType: "WORKFLOW",
                        metadata: exception
                    })
                );
            }
        }

        return created;
    }

    getById(id) {
        return this.queue.find(item => item.id === id) || null;
    }

    getBySignature(signature) {
        return this.queue.find(item => item.signature === signature) || null;
    }

    findOpenBySignature(signature) {
        return (
            this.queue.find(
                item =>
                    (item.signature || this.buildSignature(item)) === signature &&
                    OPEN_STATUSES.includes(item.status)
            ) || null
        );
    }

    getPending() {
        return this.queue.filter(item => item.status === "Pending");
    }

    getAuthorizedPending() {
        return this.queue.filter(
            item =>
                item.status === "Pending" &&
                this.normalizeBoolean(item.requiresKevin) === false &&
                item.executionType !== "APPROVAL_REQUIRED"
        );
    }

    getEscalations() {
        return this.queue.filter(
            item =>
                this.normalizeBoolean(item.requiresKevin) === true &&
                ["Pending", "Blocked", "Awaiting Approval"].includes(item.status)
        );
    }

    getOpen() {
        return this.queue.filter(item => OPEN_STATUSES.includes(item.status));
    }

    getClosed() {
        return this.queue.filter(item => CLOSED_STATUSES.includes(item.status));
    }

    getAll() {
        return this.queue;
    }

    list() {
        return this.getAll();
    }

    getStats() {
        return {
            total: this.queue.length,
            open: this.getOpen().length,
            pending: this.getPending().length,
            authorizedPending: this.getAuthorizedPending().length,
            queued: this.queue.filter(item => item.status === "Queued").length,
            inProgress: this.queue.filter(item => item.status === "In Progress")
                .length,
            blocked: this.queue.filter(item => item.status === "Blocked").length,
            awaitingApproval: this.queue.filter(
                item => item.status === "Awaiting Approval"
            ).length,
            completed: this.queue.filter(item => item.status === "Completed")
                .length,
            failed: this.queue.filter(item => item.status === "Failed").length,
            escalations: this.getEscalations().length
        };
    }

    updateStatus(id, status, metadata = {}, note = "") {
        const item = this.getById(id);

        if (!item) {
            return null;
        }

        item.status = status;
        item.updatedAt = new Date().toISOString();
        item.requiresKevin = this.normalizeBoolean(item.requiresKevin);
        item.metadata = {
            ...(item.metadata || {}),
            ...metadata
        };

        this.addLifecycle(
            item,
            status,
            note || `Status changed to ${status}.`
        );

        this.save();

        return item;
    }

    markQueued(id, metadata = {}) {
        return this.updateStatus(
            id,
            "Queued",
            metadata,
            "Work item queued for execution."
        );
    }

    markBlocked(id, metadata = {}) {
        return this.updateStatus(
            id,
            "Blocked",
            metadata,
            "Work item blocked."
        );
    }

    markRunning(id, metadata = {}) {
        return this.updateStatus(
            id,
            "In Progress",
            metadata,
            "Work item execution started."
        );
    }

    markCompleted(id, metadata = {}) {
        return this.updateStatus(
            id,
            "Completed",
            metadata,
            "Work item completed."
        );
    }

    markFailed(id, errorOrMetadata = {}) {
        const metadata =
            typeof errorOrMetadata === "string"
                ? { error: errorOrMetadata }
                : errorOrMetadata;

        return this.updateStatus(
            id,
            "Failed",
            metadata,
            "Work item failed."
        );
    }

    markAwaitingApproval(id, metadata = {}) {
        return this.updateStatus(
            id,
            "Awaiting Approval",
            metadata,
            "Work item requires approval."
        );
    }

    markCancelled(id, metadata = {}) {
        return this.updateStatus(
            id,
            "Cancelled",
            metadata,
            "Work item cancelled."
        );
    }

    archiveClosed() {
        const closed = this.getClosed();

        if (!closed.length) {
            return {
                ok: true,
                archived: 0
            };
        }

        const archive = this.loadArchive();

        archive.push(
            ...closed.map(item => ({
                ...item,
                archivedAt: new Date().toISOString()
            }))
        );

        this.queue = this.queue.filter(
            item => !CLOSED_STATUSES.includes(item.status)
        );

        this.metadata.archivedCount =
            (this.metadata.archivedCount || 0) + closed.length;

        this.saveArchive(archive);
        this.save();

        return {
            ok: true,
            archived: closed.length
        };
    }

    loadArchive() {
        return this.readJsonWithRetry(
            this.archivePath,
            [],
            "work queue archive"
        );
    }

    saveArchive(items) {
        this.writeJsonAtomic(this.archivePath, items);
    }
        deduplicateOpenItems() {
        const seen = new Map();
        const deduped = [];
        const duplicates = [];

        for (const item of this.queue) {
            const signature = item.signature || this.buildSignature(item);
            item.signature = signature;

            if (OPEN_STATUSES.includes(item.status)) {
                if (seen.has(signature)) {
                    duplicates.push(item);
                    continue;
                }

                seen.set(signature, item);
            }

            deduped.push(item);
        }

        if (duplicates.length) {
            const archive = this.loadArchive();

            for (const duplicate of duplicates) {
                duplicate.status = "Archived";
                duplicate.archivedAt = new Date().toISOString();
                duplicate.archiveReason =
                    "Duplicate open work item merged by WorkQueueService.";

                this.addLifecycle(
                    duplicate,
                    "Archived",
                    "Duplicate archived during queue deduplication."
                );

                archive.push(duplicate);
            }

            this.queue = deduped;
            this.metadata.archivedCount =
                (this.metadata.archivedCount || 0) + duplicates.length;

            this.saveArchive(archive);
            this.save();

            console.log(
                `[WorkQueueService] Archived ${duplicates.length} duplicate open work item(s).`
            );
        }
    }

    addLifecycle(item, status, note) {
        if (!item.lifecycle) {
            item.lifecycle = [];
        }

        item.lifecycle.push({
            status,
            timestamp: new Date().toISOString(),
            note
        });
    }

    buildSignature(input = {}) {
        const normalize = value =>
            String(value || "")
                .toLowerCase()
                .replace(/\d+/g, "#")
                .replace(/\([^)]*\)/g, "")
                .replace(/[^a-z0-9#]+/g, " ")
                .replace(/\s+/g, " ")
                .trim();

        const capability = normalize(
            input.capability ||
            input.metadata?.capability
        );

        const provider = normalize(
            input.provider ||
            input.relatedProvider ||
            input.metadata?.provider
        );

        const action = normalize(
            input.action ||
            input.metadata?.action
        );

        const area = normalize(
            input.area ||
            "Operations"
        );

        const objective = normalize(
            input.recommendedAction ||
            input.title ||
            "Untitled Work Item"
        );

        return [
            area,
            provider || "unknown",
            capability || action || objective
        ].join("::");
    }

    generateId() {
        return `WORK-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    }
}

module.exports = WorkQueueService;