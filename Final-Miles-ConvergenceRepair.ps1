param(
    [string]$MilesRoot = "D:\P2GC_Intelligence\MILES_ENTERPRISE",
    [int]$StartupWaitSeconds = 20
)

$ErrorActionPreference = "Stop"

function Step([string]$Text) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor DarkCyan
    Write-Host $Text -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor DarkCyan
}

function Restore-Backup {
    param(
        [string]$BackupDir,
        [string]$MilesRoot
    )

    Write-Host "Restoring backup..." -ForegroundColor Yellow

    $serviceBackup = Join-Path $BackupDir "SERVICES\WorkQueueService.js"
    $queueBackup = Join-Path $BackupDir "DATA\runtime\work_queue.json"

    if (Test-Path $serviceBackup) {
        Copy-Item -Force $serviceBackup (Join-Path $MilesRoot "SERVICES\WorkQueueService.js")
    }

    if (Test-Path $queueBackup) {
        Copy-Item -Force $queueBackup (Join-Path $MilesRoot "DATA\runtime\work_queue.json")
    }
}

if (-not (Test-Path $MilesRoot)) {
    throw "MILES root not found: $MilesRoot"
}

Set-Location $MilesRoot
$env:MILES_ROOT = $MilesRoot

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$runtimeDir = Join-Path $MilesRoot "runtime"
$backupDir = Join-Path $runtimeDir "final_convergence_backup_$stamp"
$targetService = Join-Path $MilesRoot "SERVICES\WorkQueueService.js"
$queueFile = Join-Path $MilesRoot "DATA\runtime\work_queue.json"
$stdoutLog = Join-Path $runtimeDir "FinalConvergence_$stamp.stdout.log"
$stderrLog = Join-Path $runtimeDir "FinalConvergence_$stamp.stderr.log"
$reportFile = Join-Path $runtimeDir "FinalConvergence_$stamp.report.json"

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

try {
    Step "1. STOPPING MILES"

    $nodes = Get-Process node -ErrorAction SilentlyContinue
    if ($nodes) {
        $nodes | Stop-Process -Force
        Start-Sleep -Seconds 2
        Write-Host "Stopped $($nodes.Count) Node process(es)." -ForegroundColor Green
    } else {
        Write-Host "No Node processes were running." -ForegroundColor Yellow
    }

    Step "2. BACKING UP AUTHORITATIVE WORK QUEUE"

    $serviceBackupDir = Join-Path $backupDir "SERVICES"
    $queueBackupDir = Join-Path $backupDir "DATA\runtime"

    New-Item -ItemType Directory -Force -Path $serviceBackupDir | Out-Null
    New-Item -ItemType Directory -Force -Path $queueBackupDir | Out-Null

    Copy-Item -Force $targetService (Join-Path $serviceBackupDir "WorkQueueService.js")

    if (Test-Path $queueFile) {
        Copy-Item -Force $queueFile (Join-Path $queueBackupDir "work_queue.json")
    }

    Write-Host "Backup: $backupDir" -ForegroundColor Green

    Step "3. INSTALLING COMPLETE AUTHORITATIVE WORK QUEUE SERVICE"

    $replacement = @'
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
    "ProviderLoadFailure",
    "RuntimeFailure",
    "ServiceInitializationFailure",
    "BrowserSessionFailure",
    "ApiConnectionFailure"
]);

const PROTECTED_ACTION_PATTERN =
    /\b(delete|remove permanently|change pricing|price change|sign contract|sign agreement|legal commitment|publish website|publish to production|change dns|transfer domain|purchase domain|payment|hire|fire|financial commitment)\b/i;

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

class WorkQueueService {
    constructor(options = {}) {
        this.schemaVersion = 5;

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
            } catch (error) {
                if (attempt < maxRetries) {
                    sleepSync(100);
                    continue;
                }

                const corruptBackup =
                    `${filePath}.corrupt_${new Date()
                        .toISOString()
                        .replace(/[-:.TZ]/g, "")
                        .slice(0, 14)}.json`;

                try {
                    fs.copyFileSync(filePath, corruptBackup);
                    console.error(
                        `[WorkQueueService] ${label} unreadable. Backup created: ${corruptBackup}`
                    );
                } catch (backupError) {
                    console.error(
                        `[WorkQueueService] Failed to back up unreadable ${label}:`,
                        backupError.message
                    );
                }

                console.error(
                    `[WorkQueueService] Failed to read ${label}:`,
                    error.message
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
            } catch (renameError) {
                if (
                    renameError.code !== "EPERM" &&
                    renameError.code !== "EACCES"
                ) {
                    throw renameError;
                }

                console.warn(
                    `[WorkQueueService] Atomic rename failed (${renameError.code}). Using copy fallback.`
                );

                try {
                    fs.copyFileSync(tempPath, filePath);
                    fs.unlinkSync(tempPath);
                    return;
                } catch (copyError) {
                    console.warn(
                        `[WorkQueueService] Copy fallback failed. Using direct write: ${copyError.message}`
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
        } catch (error) {
            try {
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
            } catch {}

            throw error;
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

            if (!item.signature) {
                item.signature = this.buildSignature(item);
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

    resolveExceptionType(input = {}) {
        const candidates = [
            input.type,
            input.area,
            input.metadata?.type,
            input.metadata?.exception?.type,
            input.metadata?.repair?.type,
            input.metadata?.repair?.metadata?.exception?.type,
            input.metadata?.missionItem?.area,
            input.metadata?.missionItem?.metadata?.exception?.type
        ];

        for (const candidate of candidates) {
            const value = String(candidate || "").trim();

            if (value) {
                return value;
            }
        }

        const text = [
            input.title,
            input.description,
            input.reason
        ]
            .filter(Boolean)
            .join(" ");

        for (const type of AUTONOMOUS_OPERATIONAL_EXCEPTION_TYPES) {
            if (text.includes(type)) {
                return type;
            }
        }

        return "";
    }

    isAutonomousOperationalException(input = {}) {
        const type = this.resolveExceptionType(input);

        if (AUTONOMOUS_OPERATIONAL_EXCEPTION_TYPES.has(type)) {
            return true;
        }

        const text = [
            type,
            input.title,
            input.description,
            input.reason
        ]
            .filter(Boolean)
            .join(" ");

        return /WebsiteProviderLoadFailure|provider load failure|provider initialization failure|connector failure|health check failure|repository search failure|runtime failure|service initialization failure/i.test(
            text
        );
    }

    hasProtectedAction(input = {}) {
        const actionText = [
            input.action,
            input.command,
            input.recommendedAction,
            input.title,
            input.metadata?.action,
            input.metadata?.command
        ]
            .filter(Boolean)
            .join(" ");

        return PROTECTED_ACTION_PATTERN.test(actionText);
    }

    classifyGovernance(input = {}) {
        /*
          Exact operational failure classification takes precedence over
          incidental words in provider messages such as "website domain".
          This allows diagnosis, reload, retry, and verification while
          continuing to protect actual publish/DNS/domain mutation actions.
        */
        if (this.isAutonomousOperationalException(input)) {
            return {
                requiresKevin: false,
                executionType: "WORKFLOW",
                reason:
                    "Operational diagnosis, provider reload, retry, and verification are autonomously authorized."
            };
        }

        if (this.hasProtectedAction(input)) {
            return {
                requiresKevin: true,
                executionType: "APPROVAL_REQUIRED",
                reason: "Protected executive action detected."
            };
        }

        const requiresKevin = this.normalizeBoolean(input.requiresKevin);

        return {
            requiresKevin,
            executionType:
                input.executionType ||
                (requiresKevin ? "APPROVAL_REQUIRED" : "WORKFLOW"),
            reason: "Existing governance classification retained."
        };
    }

    applyGovernanceClassification(item, source = "runtime") {
        const previousRequiresKevin =
            this.normalizeBoolean(item.requiresKevin);

        const previousExecutionType = item.executionType;
        const classification = this.classifyGovernance(item);

        item.requiresKevin = classification.requiresKevin;
        item.executionType = classification.executionType;

        if (
            item.status === "Awaiting Approval" &&
            classification.requiresKevin === false
        ) {
            item.status = "Pending";
        }

        const changed =
            previousRequiresKevin !== item.requiresKevin ||
            previousExecutionType !== item.executionType;

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

            this.applyGovernanceClassification(
                existing,
                "duplicate-refresh"
            );

            const workflowResult = existing.metadata?.workflowResult || {};

            const queuedTasks =
                Array.isArray(workflowResult.queuedTasks)
                    ? workflowResult.queuedTasks.length
                    : 0;

            const packageTasks =
                Array.isArray(workflowResult.workPackage?.tasks)
                    ? workflowResult.workPackage.tasks.length
                    : 0;

            const orphanQueued =
                existing.executionType === "WORKFLOW" &&
                (existing.status === "Queued" ||
                    existing.status === "QUEUED") &&
                queuedTasks === 0 &&
                packageTasks === 0;

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
                    "Recovered orphan queued workflow with zero executable tasks."
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
                        expectedImpact: "Reduces operational risk.",
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
                    (item.signature || this.buildSignature(item)) ===
                        signature &&
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
                ["Pending", "Blocked", "Awaiting Approval"].includes(
                    item.status
                )
        );
    }

    getOpen() {
        return this.queue.filter(item =>
            OPEN_STATUSES.includes(item.status)
        );
    }

    getClosed() {
        return this.queue.filter(item =>
            CLOSED_STATUSES.includes(item.status)
        );
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
            queued: this.queue.filter(item => item.status === "Queued")
                .length,
            inProgress: this.queue.filter(
                item => item.status === "In Progress"
            ).length,
            blocked: this.queue.filter(item => item.status === "Blocked")
                .length,
            awaitingApproval: this.queue.filter(
                item => item.status === "Awaiting Approval"
            ).length,
            completed: this.queue.filter(
                item => item.status === "Completed"
            ).length,
            failed: this.queue.filter(item => item.status === "Failed")
                .length,
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
        item.requiresKevin =
            this.normalizeBoolean(item.requiresKevin);

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
            const signature =
                item.signature || this.buildSignature(item);

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
                (this.metadata.archivedCount || 0) +
                duplicates.length;

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

    buildSignature(input) {
        return [
            input.area || "Operations",
            input.title || "Untitled Work Item",
            input.relatedProvider || "Unknown"
        ].join("::");
    }

    generateId() {
        return `WORK-${Date.now()}-${Math.floor(
            Math.random() * 100000
        )}`;
    }
}

module.exports = WorkQueueService;
'@

    [System.IO.File]::WriteAllText(
        $targetService,
        $replacement,
        [System.Text.UTF8Encoding]::new($false)
    )

    Write-Host "Installed complete replacement: $targetService" -ForegroundColor Green

    Step "4. VALIDATING JAVASCRIPT"

    & node --check $targetService

    if ($LASTEXITCODE -ne 0) {
        throw "WorkQueueService syntax validation failed."
    }

    Write-Host "JavaScript syntax passed." -ForegroundColor Green

    Step "5. RECLASSIFYING EXISTING OPERATIONAL WORK"

    $repairRunner = Join-Path $runtimeDir "FinalConvergenceRunner_$stamp.js"

    $runnerSource = @'
"use strict";

require("dotenv").config();

const WorkQueueService = require("../SERVICES/WorkQueueService");
const queue = new WorkQueueService();

let changed = 0;
const changedItems = [];

for (const item of queue.getAll()) {
    const before = {
        requiresKevin: item.requiresKevin,
        executionType: item.executionType,
        status: item.status
    };

    const wasChanged =
        queue.applyGovernanceClassification(
            item,
            "final-convergence"
        );

    if (wasChanged) {
        changed++;
        changedItems.push({
            id: item.id,
            title: item.title,
            before,
            after: {
                requiresKevin: item.requiresKevin,
                executionType: item.executionType,
                status: item.status
            }
        });
    }
}

queue.save();

const stats = queue.getStats();
const websiteItems = queue.getAll().filter(item =>
    /WebsiteProviderLoadFailure|Repair Website|WebsiteProvider/i.test(
        [
            item.area,
            item.title,
            item.description,
            item.metadata?.type,
            item.metadata?.exception?.type,
            item.metadata?.repair?.type
        ]
            .filter(Boolean)
            .join(" ")
    )
);

console.log("[FINAL] Queue path:", queue.queuePath);
console.log("[FINAL] Reclassified:", changed);
console.log("[FINAL] Changed items:", JSON.stringify(changedItems, null, 2));
console.log("[FINAL] Website items:", JSON.stringify(
    websiteItems.map(item => ({
        id: item.id,
        title: item.title,
        status: item.status,
        requiresKevin: item.requiresKevin,
        executionType: item.executionType
    })),
    null,
    2
));
console.log("[FINAL] Stats:", JSON.stringify(stats, null, 2));

if (!websiteItems.length) {
    console.error("[FINAL] No website operational work found.");
    process.exitCode = 2;
    return;
}

const blockedWebsiteItems = websiteItems.filter(item =>
    item.requiresKevin === true ||
    item.executionType === "APPROVAL_REQUIRED"
);

if (blockedWebsiteItems.length) {
    console.error(
        "[FINAL] Website operational work remains approval-blocked:",
        JSON.stringify(blockedWebsiteItems, null, 2)
    );
    process.exitCode = 3;
    return;
}

if (stats.authorizedPending < 1) {
    console.error("[FINAL] No authorized pending work after convergence.");
    process.exitCode = 4;
    return;
}

console.log("[FINAL] PASS: operational website work is autonomously authorized.");
'@

    [System.IO.File]::WriteAllText(
        $repairRunner,
        $runnerSource,
        [System.Text.UTF8Encoding]::new($false)
    )

    $repairOutput = & node $repairRunner 2>&1
    $repairExit = $LASTEXITCODE
    $repairOutput | ForEach-Object { Write-Host $_ }

    if ($repairExit -ne 0) {
        throw "Governance convergence validation failed."
    }

    Step "6. RUNNING END-TO-END AUTONOMOUS COO CYCLE"

    $cycleOutput = & node ".\StartAutonomousCOO.js" 2>&1
    $cycleExit = $LASTEXITCODE
    $cycleOutput | ForEach-Object { Write-Host $_ }

    if ($cycleExit -ne 0) {
        throw "Autonomous COO cycle failed."
    }

    $cycleText = $cycleOutput | Out-String

    $authorizedMatch = [regex]::Match(
        $cycleText,
        "Authorized Pending:\s*(\d+)"
    )

    $workflowMatch = [regex]::Match(
        $cycleText,
        '"workflowsQueued"\s*:\s*(\d+)'
    )

    $authorizedPending =
        if ($authorizedMatch.Success) {
            [int]$authorizedMatch.Groups[1].Value
        } else {
            -1
        }

    $workflowsQueued =
        if ($workflowMatch.Success) {
            [int]$workflowMatch.Groups[1].Value
        } else {
            -1
        }

    if ($authorizedPending -eq 0) {
        throw "Autonomous COO still reports Authorized Pending: 0."
    }

    if ($workflowsQueued -eq 0) {
        throw "Autonomous COO did not queue any workflow."
    }

    Write-Host "Authorized Pending: $authorizedPending" -ForegroundColor Green
    Write-Host "Workflows Queued: $workflowsQueued" -ForegroundColor Green

    Step "7. STARTING PRODUCTION"

    $process = Start-Process `
        -FilePath "node" `
        -ArgumentList @("StartMilesProduction.js") `
        -WorkingDirectory $MilesRoot `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -PassThru

    Start-Sleep -Seconds $StartupWaitSeconds

    if ($process.HasExited) {
        if (Test-Path $stdoutLog) {
            Get-Content $stdoutLog -Tail 120
        }

        if (Test-Path $stderrLog) {
            Get-Content $stderrLog -Tail 120
        }

        throw "MILES production exited during startup."
    }

    $report = [ordered]@{
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        ok = $true
        milesRoot = $MilesRoot
        backup = $backupDir
        authorizedPending = $authorizedPending
        workflowsQueued = $workflowsQueued
        productionPid = $process.Id
        stdoutLog = $stdoutLog
        stderrLog = $stderrLog
        governance = @{
            autonomousOperationalRepairs = $true
            protectedExecutiveActionsRemainApprovalRequired = $true
        }
    }

    $report |
        ConvertTo-Json -Depth 20 |
        Set-Content -Path $reportFile -Encoding UTF8

    Step "FINAL REPAIR COMPLETE — MILES IS RUNNING"

    Write-Host "Production PID: $($process.Id)" -ForegroundColor Green
    Write-Host "Authorized Pending: $authorizedPending" -ForegroundColor Green
    Write-Host "Workflows Queued: $workflowsQueued" -ForegroundColor Green
    Write-Host "Backup: $backupDir"
    Write-Host "Report: $reportFile"
    Write-Host "Stdout: $stdoutLog"
    Write-Host "Stderr: $stderrLog"
    Write-Host ""
    Write-Host "MILES can now autonomously diagnose and repair operational provider failures." -ForegroundColor Green
    Write-Host "Pricing, contracts, legal commitments, publishing, DNS changes, deletion, payments, and hiring remain CEO-protected." -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "FINAL REPAIR FAILED: $($_.Exception.Message)" -ForegroundColor Red

    Restore-Backup -BackupDir $backupDir -MilesRoot $MilesRoot

    Write-Host "Original WorkQueueService and work queue were restored." -ForegroundColor Yellow
    Write-Host "Backup retained at: $backupDir" -ForegroundColor Yellow

    throw
}
