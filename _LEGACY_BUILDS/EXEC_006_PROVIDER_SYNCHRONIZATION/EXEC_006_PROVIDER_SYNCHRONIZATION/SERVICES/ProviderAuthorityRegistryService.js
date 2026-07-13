"use strict";

/**
 * EXEC_006 Provider Authority Registry Service
 * Complete replacement file.
 *
 * Purpose:
 * Creates one authoritative provider model used by Action Engine,
 * Provider Controllers, Business Execution Engine, Dashboard, and Learning.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "provider_sync");
const OUT_FILE = path.join(OUT_DIR, "provider_authority_registry.json");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function readJson(file, fallback) {
    try { if (!exists(file)) return fallback; return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { return fallback; }
}
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }

class ProviderAuthorityRegistryService {
    constructor() {
        this.providers = this.defaultProviders();
    }

    run(input = {}) {
        const generatedAt = new Date().toISOString();
        const priorRegistry = readJson(path.join(ROOT, "DATA", "provider_controllers", "provider_controller_registry.json"), null)
            || readJson(path.join(ROOT, "DATA", "provider_controllers", "latest_provider_controllers.json"), null);

        const liveStatus = this.detectLiveStatus();
        const providers = this.providers.map(provider => {
            const prior = this.findPrior(priorRegistry, provider.key);
            const status = liveStatus[provider.key] || {};
            return this.normalizeProvider(provider, prior, status);
        });

        const result = {
            ok: true,
            action: "PROVIDER_AUTHORITY_REGISTRY",
            type: "MILES_PROVIDER_AUTHORITY_REGISTRY",
            build: "EXEC_006",
            generatedAt,
            providers,
            summary: {
                total: providers.length,
                ready: providers.filter(p => p.status === "READY").length,
                readReady: providers.filter(p => p.capabilities.read.enabled).length,
                writeReady: providers.filter(p => p.capabilities.write.enabled).length,
                safeMode: providers.filter(p => p.status === "SAFE_MODE" || p.safeMode).length,
                missingCredentials: providers.filter(p => !p.credentials.present).length
            },
            outDir: OUT_DIR
        };

        writeJson(OUT_FILE, result);
        writeJson(path.join(OUT_DIR, "latest_provider_authority_registry.json"), result);
        return result;
    }

    defaultProviders() {
        return [
            {
                key: "instantly",
                name: "Instantly",
                env: ["INSTANTLY_API_KEY"],
                module: "InstantlyProviderCompatibilityService",
                operations: ["HEALTH_CHECK", "LIST_CAMPAIGNS", "GET_CAMPAIGN", "CREATE_CAMPAIGN", "PAUSE_CAMPAIGN", "RESUME_CAMPAIGN", "UPLOAD_LEADS", "ASSIGN_SENDING_ACCOUNTS", "GENERATE_CAMPAIGN_REPORT"],
                readOps: ["HEALTH_CHECK", "LIST_CAMPAIGNS", "GET_CAMPAIGN", "GENERATE_CAMPAIGN_REPORT"],
                writeOps: ["CREATE_CAMPAIGN", "PAUSE_CAMPAIGN", "RESUME_CAMPAIGN", "UPLOAD_LEADS", "ASSIGN_SENDING_ACCOUNTS"],
                writeFlag: "INSTANTLY_WRITE_ENABLED"
            },
            {
                key: "google_workspace",
                name: "Google Workspace",
                env: ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_WORKSPACE_ADMIN_EMAIL"],
                module: "GoogleWorkspaceProviderController",
                operations: ["HEALTH_CHECK", "LIST_USERS", "CREATE_USER", "CREATE_ALIAS", "SUSPEND_USER", "VERIFY_MAILBOX"],
                readOps: ["HEALTH_CHECK", "LIST_USERS", "VERIFY_MAILBOX"],
                writeOps: ["CREATE_USER", "CREATE_ALIAS", "SUSPEND_USER"],
                writeFlag: "GOOGLE_WORKSPACE_WRITE_ENABLED"
            },
            {
                key: "namecheap",
                name: "Namecheap",
                env: ["NAMECHEAP_API_USER", "NAMECHEAP_API_KEY", "NAMECHEAP_CLIENT_IP"],
                module: "NamecheapProviderController",
                operations: ["HEALTH_CHECK", "LIST_DOMAINS", "UPDATE_DNS_OR_VERIFY_AUTH", "VERIFY_SPF", "VERIFY_DKIM", "VERIFY_DMARC"],
                readOps: ["HEALTH_CHECK", "LIST_DOMAINS", "VERIFY_SPF", "VERIFY_DKIM", "VERIFY_DMARC"],
                writeOps: ["UPDATE_DNS_OR_VERIFY_AUTH"],
                writeFlag: "NAMECHEAP_WRITE_ENABLED"
            },
            {
                key: "website",
                name: "Website",
                env: ["WEBSITE_ROOT"],
                module: "WebsiteProviderController",
                operations: ["HEALTH_CHECK", "BACKUP_SITE", "UPDATE_PAGE", "PUBLISH_PAGE", "VERIFY_PAGE", "GENERATE_WEBSITE_REPORT"],
                readOps: ["HEALTH_CHECK", "VERIFY_PAGE", "GENERATE_WEBSITE_REPORT"],
                writeOps: ["BACKUP_SITE", "UPDATE_PAGE", "PUBLISH_PAGE"],
                writeFlag: "WEBSITE_WRITE_ENABLED"
            },
            {
                key: "orion",
                name: "ORION",
                env: ["ORION_DB_PATH"],
                module: "OrionProviderController",
                operations: ["HEALTH_CHECK", "VERIFY_DATABASE", "REFRESH_DATASETS", "RUN_INTELLIGENCE_JOB", "GENERATE_ORION_REPORT"],
                readOps: ["HEALTH_CHECK", "VERIFY_DATABASE", "GENERATE_ORION_REPORT"],
                writeOps: ["REFRESH_DATASETS", "RUN_INTELLIGENCE_JOB"],
                writeFlag: "ORION_WRITE_ENABLED"
            },
            {
                key: "filesystem",
                name: "File System",
                env: [],
                module: "FileSystemProviderController",
                operations: ["HEALTH_CHECK", "ENSURE_DIRECTORY", "WRITE_JSON", "READ_JSON", "VERIFY_PATH"],
                readOps: ["HEALTH_CHECK", "READ_JSON", "VERIFY_PATH"],
                writeOps: ["ENSURE_DIRECTORY", "WRITE_JSON"],
                writeFlag: "FILESYSTEM_WRITE_ENABLED",
                alwaysAvailable: true
            }
        ];
    }

    findPrior(registry, key) {
        const providers = registry?.providers || registry?.registry?.providers || [];
        return providers.find(p => p.provider === key || p.key === key) || null;
    }

    detectLiveStatus() {
        return {
            instantly: {
                credentialsPresent: Boolean(process.env.INSTANTLY_API_KEY),
                writeEnabled: String(process.env.INSTANTLY_WRITE_ENABLED || "").toLowerCase() === "true"
            },
            filesystem: { credentialsPresent: true, writeEnabled: true },
            orion: { credentialsPresent: Boolean(process.env.ORION_DB_PATH) || exists(path.join(ROOT, "DATA")), writeEnabled: String(process.env.ORION_WRITE_ENABLED || "").toLowerCase() === "true" },
            website: { credentialsPresent: Boolean(process.env.WEBSITE_ROOT) || exists(path.join(ROOT, "DATA", "website")), writeEnabled: String(process.env.WEBSITE_WRITE_ENABLED || "").toLowerCase() === "true" },
            google_workspace: { credentialsPresent: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL), writeEnabled: String(process.env.GOOGLE_WORKSPACE_WRITE_ENABLED || "").toLowerCase() === "true" },
            namecheap: { credentialsPresent: Boolean(process.env.NAMECHEAP_API_USER && process.env.NAMECHEAP_API_KEY && process.env.NAMECHEAP_CLIENT_IP), writeEnabled: String(process.env.NAMECHEAP_WRITE_ENABLED || "").toLowerCase() === "true" }
        };
    }

    normalizeProvider(provider, prior, status) {
        const credentialsPresent = provider.alwaysAvailable || Boolean(status.credentialsPresent || prior?.credentialsPresent);
        const writeEnabled = Boolean(status.writeEnabled);
        const readEnabled = credentialsPresent || provider.alwaysAvailable;
        const executable = readEnabled;
        const safeMode = !writeEnabled;
        return {
            key: provider.key,
            provider: provider.key,
            name: provider.name,
            providerName: provider.name,
            module: provider.module,
            executable,
            credentialsPresent,
            credentials: {
                present: credentialsPresent,
                requiredEnv: provider.env,
                missingEnv: provider.env.filter(k => !process.env[k])
            },
            safeMode,
            status: executable ? (safeMode ? "READY_READ_ONLY" : "READY") : "MISSING_CREDENTIALS",
            capabilities: {
                read: { enabled: readEnabled, operations: provider.readOps },
                write: { enabled: writeEnabled && credentialsPresent, operations: provider.writeOps, flag: provider.writeFlag },
                rollback: { enabled: false, operations: [] },
                verify: { enabled: true }
            },
            supportedOperations: provider.operations,
            generatedAt: new Date().toISOString()
        };
    }
}

module.exports = new ProviderAuthorityRegistryService();
