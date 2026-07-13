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

class WorkQueueService {
    constructor(options = {}) {
        this.schemaVersion = 3;

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

    load() {
        try {
            const dir = path.dirname(this.queuePath);

            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (!fs.existsSync(this.queuePath)) {
                this.save();
                return;
            }

            const raw = fs.readFileSync(this.queuePath, "utf8");
            const parsed = JSON.parse(raw || "[]");

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
                this.queue = parsed.items || [];
            }

            this.migrate();
            this.deduplicateOpenItems();
        } catch (err) {
            console.error("[WorkQueueService] Failed to load queue:", err.message);
            this.queue = [];
            this.save();
        }
    }

    migrate() {
        let migrated = false;

        for (const item of this.queue) {
            if (!item.id) {
                item.id = this.generateId();
                migrated = true;
            }

            if (!item.signature) {
                item.signature = this.buildSignature(item);
                migrated = true;
            }

            if (!item.executionType) {
                item.executionType = item.requiresKevin ? "APPROVAL_REQUIRED" : "WORKFLOW";
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

            if (typeof item.requiresKevin !== "boolean") {
                item.requiresKevin = Boolean(item.requiresKevin);
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
        }

        if (this.metadata.schemaVersion !== this.schemaVersion) {
            this.metadata.schemaVersion = this.schemaVersion;
            this.metadata.lastMigrated = new Date().toISOString();
            migrated = true;
        }

        if (migrated) {
            this.save();
            console.log(`[WorkQueueService] Migrated queue to schema v${this.schemaVersion}.`);
        }
    }

    save() {
        const dir = path.dirname(this.queuePath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.metadata.schemaVersion = this.schemaVersion;
        this.metadata.updatedAt = new Date().toISOString();
        this.metadata.itemCount = this.queue.length;

        fs.writeFileSync(
            this.queuePath,
            JSON.stringify(
                {
                    metadata: this.metadata,
                    items: this.queue
                },
                null,
                2
            ),
            "utf8"
        );
    }

    createWorkItem(input) {
        const signature = this.buildSignature(input);

        const existing = this.findOpenBySignature(signature);

        if (existing) {
            existing.updatedAt = new Date().toISOString();
            existing.duplicateDetected = true;
            existing.metadata = {
                ...(existing.metadata || {}),
                lastDuplicateDetectedAt: new Date().toISOString()
            };

            this.addLifecycle(existing, existing.status, "Duplicate detected; existing open item reused.");
            this.save();

            return existing;
        }

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
            requiresKevin: Boolean(input.requiresKevin),
            recommendedAction: input.recommendedAction || "",
            expectedImpact: input.expectedImpact || "",
            relatedProvider: input.relatedProvider || null,
            executionType: input.executionType || (input.requiresKevin ? "APPROVAL_REQUIRED" : "WORKFLOW"),
            metadata: input.metadata || {},
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

        if ((marketing.totalCampaigns || 0) > 0 && (marketing.activeCampaigns || 0) < 2) {
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
                created.push(
                    this.createWorkItem({
                        priority: 1,
                        area: exception.type || "Operations",
                        title: `Resolve critical exception: ${exception.type || "Unknown"}`,
                        description: exception.message || "",
                        reason: "Critical exception requires immediate operational response.",
                        source: "ExecutiveIntelligenceService",
                        owner: "Miles",
                        requiresKevin: true,
                        recommendedAction:
                            "Investigate and resolve the critical exception immediately.",
                        expectedImpact:
                            "Protects business continuity and executive visibility.",
                        relatedProvider: exception.provider || null,
                        executionType: "APPROVAL_REQUIRED",
                        metadata: exception
                    })
                );
            }

            if (severity === "Warning") {
                created.push(
                    this.createWorkItem({
                        priority: 2,
                        area: exception.type || "Operations",
                        title: `Investigate warning: ${exception.type || "Unknown"}`,
                        description: exception.message || "",
                        reason: "Warning may become operational risk if unresolved.",
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
        return this.queue.find(item =>
            (item.signature || this.buildSignature(item)) === signature &&
            OPEN_STATUSES.includes(item.status)
        ) || null;
    }

    getPending() {
        return this.queue.filter(item => item.status === "Pending");
    }

    getAuthorizedPending() {
        return this.queue.filter(item =>
            item.status === "Pending" &&
            item.requiresKevin === false
        );
    }

    getEscalations() {
        return this.queue.filter(item =>
            item.requiresKevin === true &&
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

    getStats() {
        return {
            total: this.queue.length,
            open: this.getOpen().length,
            pending: this.getPending().length,
            queued: this.queue.filter(item => item.status === "Queued").length,
            inProgress: this.queue.filter(item => item.status === "In Progress").length,
            blocked: this.queue.filter(item => item.status === "Blocked").length,
            awaitingApproval: this.queue.filter(item => item.status === "Awaiting Approval").length,
            completed: this.queue.filter(item => item.status === "Completed").length,
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
        item.metadata = {
            ...(item.metadata || {}),
            ...metadata
        };

        this.addLifecycle(item, status, note || `Status changed to ${status}.`);
        this.save();

        return item;
    }

    markQueued(id, metadata = {}) {
        return this.updateStatus(id, "Queued", metadata, "Work item queued for execution.");
    }

    markBlocked(id, metadata = {}) {
        return this.updateStatus(id, "Blocked", metadata, "Work item blocked.");
    }

    markRunning(id, metadata = {}) {
        return this.updateStatus(id, "In Progress", metadata, "Work item execution started.");
    }

    markCompleted(id, metadata = {}) {
        return this.updateStatus(id, "Completed", metadata, "Work item completed.");
    }

    markFailed(id, errorOrMetadata = {}) {
        const metadata =
            typeof errorOrMetadata === "string"
                ? { error: errorOrMetadata }
                : errorOrMetadata;

        return this.updateStatus(id, "Failed", metadata, "Work item failed.");
    }

    markAwaitingApproval(id, metadata = {}) {
        return this.updateStatus(id, "Awaiting Approval", metadata, "Work item requires approval.");
    }

    markCancelled(id, metadata = {}) {
        return this.updateStatus(id, "Cancelled", metadata, "Work item cancelled.");
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
        archive.push(...closed.map(item => ({
            ...item,
            archivedAt: new Date().toISOString()
        })));

        this.queue = this.queue.filter(item => !CLOSED_STATUSES.includes(item.status));

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
        try {
            if (!fs.existsSync(this.archivePath)) {
                return [];
            }

            const raw = fs.readFileSync(this.archivePath, "utf8");
            return JSON.parse(raw || "[]");
        } catch {
            return [];
        }
    }

    saveArchive(items) {
        const dir = path.dirname(this.archivePath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(
            this.archivePath,
            JSON.stringify(items, null, 2),
            "utf8"
        );
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
                duplicate.archiveReason = "Duplicate open work item merged by WorkQueueService.";
                this.addLifecycle(duplicate, "Archived", "Duplicate archived during queue deduplication.");
                archive.push(duplicate);
            }

            this.queue = deduped;
            this.metadata.archivedCount =
                (this.metadata.archivedCount || 0) + duplicates.length;

            this.saveArchive(archive);
            this.save();

            console.log(`[WorkQueueService] Archived ${duplicates.length} duplicate open work item(s).`);
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

    buildSignature(input) {
        return [
            input.area || "Operations",
            input.title || "Untitled Work Item",
            input.relatedProvider || "Unknown"
        ].join("::");
    }

    generateId() {
        return `WORK-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    }
}

module.exports = WorkQueueService;
