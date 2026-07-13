/**
 * MILES Repository Registry Service
 * Version: 1.0.0
 *
 * Purpose:
 * Creates the authoritative repository inventory for MILES.
 *
 * Builder Action:
 * REPOSITORY_REGISTRY
 *
 * Outputs:
 * DATA/repository/repository_registry.json
 * DATA/repository/service_registry.json
 * DATA/repository/worker_registry.json
 * DATA/repository/provider_registry.json
 * DATA/repository/connector_registry.json
 * DATA/repository/runtime_registry.json
 * DATA/repository/api_registry.json
 * DATA/repository/database_registry.json
 * DATA/repository/event_registry.json
 * DATA/repository/repository_statistics.json
 * DATA/repository/repository_health.json
 * DATA/repository/inventory_report.md
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "DATA", "repository");

const IGNORE_DIRS = new Set([
    ".git",
    ".vscode",
    "node_modules",
    "BACKUPS",
    "MILES_BACKUPS",
    "ARCHIVE",
    "logs",
    "temp",
    "TEMP",
    "cache",
    "Cache",
    "dist",
    "build",
    "__pycache__"
].map(x => x.toLowerCase()));

const ALLOWED_EXTENSIONS = new Set([
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".json",
    ".ps1",
    ".py",
    ".sql",
    ".md",
    ".yml",
    ".yaml",
    ".bat",
    ".cmd",
    ".csv"
]);

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function safeRead(file) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return "";
    }
}

function sha(value) {
    return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function rel(file) {
    return path.relative(ROOT, file).replace(/\\/g, "/");
}

function writeJson(fileName, data) {
    ensureDir(OUT_DIR);
    fs.writeFileSync(
        path.join(OUT_DIR, fileName),
        JSON.stringify(data, null, 2),
        "utf8"
    );
}

function walk(dir, files = []) {
    let entries = [];

    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return files;
    }

    for (const entry of entries) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name.toLowerCase())) continue;
            walk(full, files);
            continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (ALLOWED_EXTENSIONS.has(ext)) files.push(full);
    }

    return files;
}

function classifyFileType(file) {
    const ext = path.extname(file).toLowerCase();

    if ([".js", ".mjs", ".cjs", ".ts", ".tsx"].includes(ext)) return "code";
    if (ext === ".ps1") return "powershell";
    if (ext === ".json") return "json";
    if (ext === ".csv") return "csv";
    if (ext === ".md") return "markdown";
    if (ext === ".sql") return "sql";
    if ([".yml", ".yaml"].includes(ext)) return "yaml";
    if ([".bat", ".cmd"].includes(ext)) return "windows_command";
    if (ext === ".py") return "python";

    return "other";
}

function classifyComponent(relativePath, text) {
    const p = relativePath.toLowerCase();
    const name = path.basename(relativePath).toLowerCase();
    const haystack = `${p}\n${text.slice(0, 5000).toLowerCase()}`;

    const types = [];

    if (p.includes("/services/") || name.includes("service") || /class\s+\w*service\b/i.test(text)) types.push("service");
    if (p.includes("/workers/") || name.includes("worker") || /class\s+\w*worker\b/i.test(text)) types.push("worker");
    if (p.includes("/providers/") || name.includes("provider") || /class\s+\w*provider\b/i.test(text)) types.push("provider");
    if (p.includes("/connectors/") || name.includes("connector") || /class\s+\w*connector\b/i.test(text)) types.push("connector");
    if (p.includes("/api/") || name.includes("api") || haystack.includes("express(") || haystack.includes("router.")) types.push("api");
    if (p.includes("/runtime/") || name.includes("runtime") || name.includes("kernel") || haystack.includes("pm2")) types.push("runtime");
    if (p.includes("/core/kernel/") || name.includes("eventbus") || name.includes("event-bus")) types.push("kernel");
    if (name.includes("eventbus") || haystack.includes(".emit(") || haystack.includes(".on(")) types.push("event_bus");
    if (p.includes("/automations/") || name.includes("automation") || name.includes("scheduler") || haystack.includes("cron")) types.push("automation");
    if (p.includes("/builder/") || name.includes("builder") || name.includes("scanner") || name.includes("analyzer")) types.push("engineering");
    if (p.includes("/database") || name.includes("database") || name.includes("db") || haystack.includes("sqlite") || haystack.includes("better-sqlite3")) types.push("database");
    if (p.includes("/dashboard") || name.includes("dashboard")) types.push("dashboard");
    if (p.includes("/executive") || name.includes("executive")) types.push("executive");
    if (p.includes("/learning") || name.includes("learning") || name.includes("confidence")) types.push("learning");

    return [...new Set(types)];
}

function extractDependencies(text) {
    const deps = [];
    let match;

    const patterns = [
        /require\(["']([^"']+)["']\)/g,
        /from\s+["']([^"']+)["']/g,
        /import\s+["']([^"']+)["']/g
    ];

    for (const pattern of patterns) {
        while ((match = pattern.exec(text)) !== null) {
            deps.push(match[1]);
        }
    }

    return [...new Set(deps)];
}

function extractEvents(text) {
    const published = [];
    const subscribed = [];
    let match;

    const publishPatterns = [
        /\.emit\(["'`]([^"'`]+)["'`]/g,
        /publish\(["'`]([^"'`]+)["'`]/g,
        /dispatch\(["'`]([^"'`]+)["'`]/g
    ];

    const subscribePatterns = [
        /\.on\(["'`]([^"'`]+)["'`]/g,
        /subscribe\(["'`]([^"'`]+)["'`]/g,
        /handle\(["'`]([^"'`]+)["'`]/g
    ];

    for (const pattern of publishPatterns) {
        while ((match = pattern.exec(text)) !== null) published.push(match[1]);
    }

    for (const pattern of subscribePatterns) {
        while ((match = pattern.exec(text)) !== null) subscribed.push(match[1]);
    }

    return {
        published: [...new Set(published)],
        subscribed: [...new Set(subscribed)]
    };
}

function detectCapabilities(relativePath, text, componentTypes) {
    const haystack = `${relativePath}\n${text.slice(0, 6000)}`.toLowerCase();
    const capabilities = [];

    const rules = [
        ["executive_intelligence", ["executive brief", "executive intelligence", "kpi", "dashboard"]],
        ["revenue_operations", ["revenue", "pipeline", "proposal", "crm", "sales", "client"]],
        ["marketing_operations", ["instantly", "linkedin", "website", "campaign", "b12", "outreach"]],
        ["orion_operations", ["orion", "contractor", "buyer", "vehicle", "recompete", "recommendation"]],
        ["government_data", ["sam.gov", "usaspending", "gsa", "elibrary", "forecast", "rfi", "sources sought"]],
        ["runtime_operations", ["pm2", "runtime", "heartbeat", "autonomouscooloopservice", "loop"]],
        ["engineering_operations", ["builder", "scanner", "analyzer", "gitmanager", "runtimecontroller", "registry"]],
        ["approval_governance", ["approval", "authority", "governance", "protected", "permission"]],
        ["website_operations", ["website", "b12", "page", "form", "seo"]],
        ["email_outbound_operations", ["instantly", "inbox", "campaign", "bounce", "warmup"]],
        ["data_provider_operations", ["provider", "data provider"]],
        ["connector_operations", ["connector", "integration", "api key"]],
        ["learning_operations", ["learning", "confidence", "decision history", "score"]]
    ];

    for (const [capability, terms] of rules) {
        if (terms.some(term => haystack.includes(term))) capabilities.push(capability);
    }

    if (componentTypes.includes("service")) capabilities.push("service_execution");
    if (componentTypes.includes("worker")) capabilities.push("worker_execution");
    if (componentTypes.includes("provider")) capabilities.push("data_provider_operations");
    if (componentTypes.includes("connector")) capabilities.push("connector_operations");
    if (componentTypes.includes("api")) capabilities.push("api_surface");
    if (componentTypes.includes("runtime")) capabilities.push("runtime_operations");
    if (componentTypes.includes("engineering")) capabilities.push("engineering_operations");

    return [...new Set(capabilities)];
}

function nameKey(relativePath) {
    return path.basename(relativePath)
        .toLowerCase()
        .replace(/\.(js|ts|py|ps1|json|md|mjs|cjs)$/g, "")
        .replace(/service|worker|provider|connector|engine|manager|controller|handler/g, "")
        .replace(/[^a-z0-9]/g, "");
}

class RepositoryRegistryService {
    run() {
        const startedAt = new Date();

        console.log("");
        console.log("========================================");
        console.log(" MILES Repository Registry");
        console.log("========================================");

        const registry = this.buildRegistry();
        this.save(registry);

        const finishedAt = new Date();
        const durationMs = finishedAt - startedAt;

        console.log("");
        console.log("Repository Registry Complete");
        console.log(`Components: ${registry.statistics.totalComponents}`);
        console.log(`Services: ${registry.statistics.services}`);
        console.log(`Workers: ${registry.statistics.workers}`);
        console.log(`Providers: ${registry.statistics.providers}`);
        console.log(`Connectors: ${registry.statistics.connectors}`);
        console.log(`Health Score: ${registry.health.score}`);
        console.log("");

        return {
            ok: true,
            action: "REPOSITORY_REGISTRY",
            generatedAt: registry.generatedAt,
            durationMs,
            outDir: OUT_DIR,
            statistics: registry.statistics,
            health: registry.health
        };
    }

    buildRegistry() {
        const generatedAt = new Date().toISOString();
        const files = walk(ROOT);

        const components = [];

        for (const file of files) {
            const relativePath = rel(file);
            const stat = fs.statSync(file);
            const text = safeRead(file);
            const componentTypes = classifyComponent(relativePath, text);

            const item = {
                id: sha(relativePath),
                name: path.basename(relativePath),
                path: relativePath,
                extension: path.extname(relativePath).toLowerCase(),
                fileType: classifyFileType(relativePath),
                bytes: stat.size,
                modifiedAt: stat.mtime.toISOString(),
                componentTypes,
                capabilities: detectCapabilities(relativePath, text, componentTypes),
                dependencies: extractDependencies(text),
                events: extractEvents(text),
                status: componentTypes.length ? "active_candidate" : "file",
                owner: this.inferOwner(relativePath, componentTypes)
            };

            components.push(item);
        }

        const componentOnly = components.filter(c => c.componentTypes.length > 0);

        const registry = {
            generatedAt,
            root: ROOT,
            activeRuntime: "AutonomousCOOLoopService",
            legacyRuntime: "ProductionCOOEngine",
            mission: "MILES becomes the autonomous Digital COO for P2GC.",
            engineeringRule: "Discover -> Analyze -> Reuse -> Extend -> Build -> Validate -> Test -> Deploy -> Verify -> Report",
            files: components,
            components: componentOnly,
            services: componentOnly.filter(c => c.componentTypes.includes("service")),
            workers: componentOnly.filter(c => c.componentTypes.includes("worker")),
            providers: componentOnly.filter(c => c.componentTypes.includes("provider")),
            connectors: componentOnly.filter(c => c.componentTypes.includes("connector")),
            runtime: componentOnly.filter(c => c.componentTypes.includes("runtime")),
            apis: componentOnly.filter(c => c.componentTypes.includes("api")),
            databases: componentOnly.filter(c => c.componentTypes.includes("database")),
            events: this.buildEventRegistry(componentOnly),
            duplicates: this.findDuplicates(componentOnly),
            orphans: this.findOrphans(componentOnly),
            statistics: {},
            health: {}
        };

        registry.statistics = this.buildStatistics(registry);
        registry.health = this.buildHealth(registry);

        return registry;
    }

    inferOwner(relativePath, componentTypes) {
        const p = relativePath.toLowerCase();

        if (p.includes("orion")) return "ORION";
        if (p.includes("instantly")) return "Marketing";
        if (p.includes("website") || p.includes("b12")) return "Website";
        if (p.includes("revenue") || p.includes("sales") || p.includes("crm")) return "Revenue";
        if (p.includes("executive") || p.includes("dashboard")) return "Executive";
        if (p.includes("builder") || p.includes("engineering")) return "Engineering";
        if (p.includes("runtime") || p.includes("kernel") || p.includes("core")) return "Runtime";
        if (p.includes("learning") || p.includes("confidence")) return "Learning";

        if (componentTypes.includes("connector")) return "Connector Layer";
        if (componentTypes.includes("provider")) return "Provider Layer";
        if (componentTypes.includes("worker")) return "Worker Layer";
        if (componentTypes.includes("service")) return "Service Layer";

        return "Unknown";
    }

    buildEventRegistry(components) {
        const published = [];
        const subscribed = [];

        for (const component of components) {
            for (const eventName of component.events.published) {
                published.push({
                    event: eventName,
                    publisher: component.path,
                    componentId: component.id
                });
            }

            for (const eventName of component.events.subscribed) {
                subscribed.push({
                    event: eventName,
                    subscriber: component.path,
                    componentId: component.id
                });
            }
        }

        const allEvents = [...new Set([
            ...published.map(e => e.event),
            ...subscribed.map(e => e.event)
        ])].sort();

        return {
            allEvents,
            published,
            subscribed
        };
    }

    findDuplicates(components) {
        const duplicates = [];

        for (let i = 0; i < components.length; i++) {
            for (let j = i + 1; j < components.length; j++) {
                const a = components[i];
                const b = components[j];

                const sharedTypes = a.componentTypes.filter(t => b.componentTypes.includes(t));
                if (!sharedTypes.length) continue;

                const aKey = nameKey(a.path);
                const bKey = nameKey(b.path);

                if (!aKey || !bKey) continue;

                if (aKey === bKey || aKey.includes(bKey) || bKey.includes(aKey)) {
                    duplicates.push({
                        risk: "possible_duplicate_or_overlap",
                        sharedTypes,
                        files: [a.path, b.path]
                    });
                }
            }
        }

        return duplicates;
    }

    findOrphans(components) {
        return components
            .filter(c => c.dependencies.length === 0)
            .filter(c => c.events.published.length === 0)
            .filter(c => c.events.subscribed.length === 0)
            .filter(c => !c.path.toLowerCase().includes("readme"))
            .map(c => ({
                risk: "possible_orphan_static_scan_only",
                path: c.path,
                componentTypes: c.componentTypes,
                owner: c.owner
            }));
    }

    buildStatistics(registry) {
        return {
            totalFiles: registry.files.length,
            totalComponents: registry.components.length,
            services: registry.services.length,
            workers: registry.workers.length,
            providers: registry.providers.length,
            connectors: registry.connectors.length,
            runtime: registry.runtime.length,
            apis: registry.apis.length,
            databases: registry.databases.length,
            events: registry.events.allEvents.length,
            duplicateRisks: registry.duplicates.length,
            orphanRisks: registry.orphans.length
        };
    }

    buildHealth(registry) {
        let score = 100;

        score -= Math.min(20, registry.duplicates.length * 2);
        score -= Math.min(20, registry.orphans.length);
        if (!registry.runtime.length) score -= 15;
        if (!registry.services.length) score -= 15;
        if (!registry.connectors.length) score -= 10;
        if (!registry.providers.length) score -= 10;

        score = Math.max(0, score);

        const status =
            score >= 90 ? "HEALTHY" :
            score >= 75 ? "WATCH" :
            score >= 50 ? "NEEDS_ATTENTION" :
            "CRITICAL";

        return {
            score,
            status,
            summary: {
                duplicateRisks: registry.duplicates.length,
                orphanRisks: registry.orphans.length,
                hasRuntime: registry.runtime.length > 0,
                hasServices: registry.services.length > 0,
                hasConnectors: registry.connectors.length > 0,
                hasProviders: registry.providers.length > 0
            }
        };
    }

    save(registry) {
        ensureDir(OUT_DIR);

        writeJson("repository_registry.json", registry);
        writeJson("service_registry.json", {
            generatedAt: registry.generatedAt,
            services: registry.services
        });
        writeJson("worker_registry.json", {
            generatedAt: registry.generatedAt,
            workers: registry.workers
        });
        writeJson("provider_registry.json", {
            generatedAt: registry.generatedAt,
            providers: registry.providers
        });
        writeJson("connector_registry.json", {
            generatedAt: registry.generatedAt,
            connectors: registry.connectors
        });
        writeJson("runtime_registry.json", {
            generatedAt: registry.generatedAt,
            runtime: registry.runtime
        });
        writeJson("api_registry.json", {
            generatedAt: registry.generatedAt,
            apis: registry.apis
        });
        writeJson("database_registry.json", {
            generatedAt: registry.generatedAt,
            databases: registry.databases
        });
        writeJson("event_registry.json", {
            generatedAt: registry.generatedAt,
            events: registry.events
        });
        writeJson("repository_statistics.json", {
            generatedAt: registry.generatedAt,
            statistics: registry.statistics
        });
        writeJson("repository_health.json", {
            generatedAt: registry.generatedAt,
            health: registry.health
        });

        fs.writeFileSync(
            path.join(OUT_DIR, "inventory_report.md"),
            this.renderMarkdownReport(registry),
            "utf8"
        );
    }

    renderMarkdownReport(registry) {
        return `# MILES Repository Inventory Report

Generated: ${registry.generatedAt}

## Mission

MILES becomes the autonomous Digital COO for P2GC.

## Repository Health

Status: ${registry.health.status}  
Score: ${registry.health.score}

## Inventory

| Area | Count |
|---|---:|
| Files | ${registry.statistics.totalFiles} |
| Components | ${registry.statistics.totalComponents} |
| Services | ${registry.statistics.services} |
| Workers | ${registry.statistics.workers} |
| Providers | ${registry.statistics.providers} |
| Connectors | ${registry.statistics.connectors} |
| Runtime | ${registry.statistics.runtime} |
| APIs | ${registry.statistics.apis} |
| Databases | ${registry.statistics.databases} |
| Events | ${registry.statistics.events} |
| Duplicate Risks | ${registry.statistics.duplicateRisks} |
| Orphan Risks | ${registry.statistics.orphanRisks} |

## Active Runtime Rule

AutonomousCOOLoopService remains the active COO runtime.

ProductionCOOEngine remains legacy unless explicitly approved.

## Next Step

Use this registry as the input for the Capability Registry.

## Success Metric

This registry reduces Kevin's operational workload by giving MILES a durable understanding of what exists in its own operating system.
`;
    }
}

module.exports = new RepositoryRegistryService();
