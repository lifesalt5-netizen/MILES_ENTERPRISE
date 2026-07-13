const fs = require("fs");
const path = require("path");

class WorkQueueService {
    constructor(options = {}) {
        this.schemaVersion = 2;
        this.queuePath =
            options.queuePath ||
            path.join(process.cwd(), "DATA", "runtime", "work_queue.json");

        this.queue = [];
        this.metadata = {
            schemaVersion: this.schemaVersion,
            createdAt: new Date().toISOString(),
            lastMigrated: null,
            itemCount: 0
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
                    lastMigrated: null,
                    itemCount: this.queue.length
                };
            } else {
                this.metadata = parsed.metadata || this.metadata;
                this.queue = parsed.items || [];
            }

            this.migrate();
        } catch (err) {
            console.error("[WorkQueueService] Failed to load queue:", err.message);
            this.queue = [];
            this.save();
        }
    }

    migrate() {
        let migrated = false;

        for (const item of this.queue) {
            if (!item.signature) {
                item.signature = this.buildSignature(item);
                migrated = true;
            }

            if (!item.executionType) {
                item.executionType = "WORKFLOW";
                migrated = true;
            }

            if (!item.updatedAt) {
                item.updatedAt = item.createdAt || new Date().toISOString();
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
        }

        if (this.metadata.schemaVersion !== this.schemaVersion) {
            this.metadata.schemaVersion = this.schemaVersion;
            this.metadata.lastMigrated = new Date().toISOString();
            migrated = true;
        }

        this.metadata.itemCount = this.queue.length;

        if (migrated) {
            this.save();
            console.log(`[WorkQueueService] Migrated work queue to schema v${this.schemaVersion}.`);
        }
    }

    save() {
        const dir = path.dirname(this.queuePath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.metadata.schemaVersion = this.schemaVersion;
        this.metadata.itemCount = this.queue.length;
        this.metadata.updatedAt = new Date().toISOString();

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

        const existing = this.queue.find(item => {
            const itemSignature = item.signature || this.buildSignature(item);

            return (
                itemSignature === signature &&
                ["Pending", "In Progress", "Queued", "Blocked", "Awaiting Approval"].includes(item.status)
            );
        });

        if (existing) {
            existing.updatedAt = new Date().toISOString();
            existing.duplicateDetected = true;
            existing.metadata = {
                ...(existing.metadata || {}),
                lastDuplicateDetectedAt: new Date().toISOString()
            };
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
            executionType: input.executionType || "WORKFLOW",
            metadata: input.metadata || {}
        };

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
        return this.queue.filter(item =>
            ["Pending", "In Progress", "Queued", "Blocked", "Awaiting Approval"].includes(item.status)
        );
    }

    getAll() {
        return this.queue;
    }

    updateStatus(id, status, metadata = {}) {
        const item = this.queue.find(i => i.id === id);

        if (!item) {
            return null;
        }

        item.status = status;
        item.updatedAt = new Date().toISOString();
        item.metadata = {
            ...(item.metadata || {}),
            ...metadata
        };

        this.save();

        return item;
    }

    markQueued(id, metadata = {}) {
        return this.updateStatus(id, "Queued", metadata);
    }

    markInProgress(id, metadata = {}) {
        return this.updateStatus(id, "In Progress", metadata);
    }

    markCompleted(id, metadata = {}) {
        return this.updateStatus(id, "Completed", metadata);
    }

    markFailed(id, metadata = {}) {
        return this.updateStatus(id, "Failed", metadata);
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
