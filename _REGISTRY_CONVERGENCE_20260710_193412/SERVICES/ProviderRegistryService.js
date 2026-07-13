"use strict";

/**
 * MILES Provider Registry Service
 * EXEC_001
 * Complete replacement file.
 *
 * Purpose:
 * Maintains the provider/action inventory used by the Unified Action Engine.
 * This registry is intentionally metadata-only. Secrets belong in a vault, not here.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "action_engine");
const REGISTRY_FILE = path.join(OUT_DIR, "provider_registry.json");
const REPORT_FILE = path.join(OUT_DIR, "provider_registry_report.md");

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJson(file, value) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

class ProviderRegistryService {
    constructor() {
        this.defaultProviders = this.buildDefaults();
    }

    run(input = {}) {
        const registry = this.loadOrCreate();

        if (input.refresh === true) {
            registry.providers = this.defaultProviders;
            registry.updatedAt = new Date().toISOString();
            writeJson(REGISTRY_FILE, registry);
        }

        fs.writeFileSync(REPORT_FILE, this.renderReport(registry), "utf8");

        return {
            ok: true,
            action: "PROVIDER_REGISTRY",
            generatedAt: new Date().toISOString(),
            outDir: OUT_DIR,
            providers: registry.providers.length,
            executableProviders: registry.providers.filter(p => p.status === "AVAILABLE" && p.canExecute === true).length,
            registryFile: REGISTRY_FILE
        };
    }

    loadOrCreate() {
        const existing = readJson(REGISTRY_FILE, null);
        if (existing && Array.isArray(existing.providers)) return existing;

        const registry = {
            ok: true,
            type: "MILES_PROVIDER_REGISTRY",
            build: "EXEC_001",
            generatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            policy: {
                secretsStoredHere: false,
                secretLocation: "Credential vault or environment variables only.",
                destructiveActionsRequireKevin: true,
                defaultMode: "SAFE_DRY_RUN_UNLESS_PROVIDER_VERIFIED"
            },
            providers: this.defaultProviders
        };

        writeJson(REGISTRY_FILE, registry);
        fs.writeFileSync(REPORT_FILE, this.renderReport(registry), "utf8");
        return registry;
    }

    getProvider(name) {
        const registry = this.loadOrCreate();
        const normalized = String(name || "").toLowerCase();
        return registry.providers.find(p =>
            p.id.toLowerCase() === normalized ||
            p.name.toLowerCase() === normalized ||
            (p.aliases || []).map(a => a.toLowerCase()).includes(normalized)
        ) || null;
    }

    resolveProviderFromText(text) {
        const value = String(text || "").toLowerCase();
        const registry = this.loadOrCreate();

        for (const provider of registry.providers) {
            const keys = [provider.id, provider.name, ...(provider.aliases || [])]
                .map(v => String(v).toLowerCase());
            if (keys.some(k => value.includes(k))) return provider;
        }

        if (/instantly|campaign|outbound|bounce|warmup|inbox/.test(value)) return this.getProvider("instantly");
        if (/google workspace|gmail|user|alias|mailbox/.test(value)) return this.getProvider("google_workspace");
        if (/namecheap|domain|dns|dkim|spf|dmarc/.test(value)) return this.getProvider("namecheap");
        if (/website|ionos|page|form|seo|publish/.test(value)) return this.getProvider("website");
        if (/linkedin|post|profile|connection/.test(value)) return this.getProvider("linkedin");
        if (/orion|contractor|buyer|vehicle|recompete|dataset/.test(value)) return this.getProvider("orion");
        if (/crm|pipeline|lead|prospect|client/.test(value)) return this.getProvider("crm");
        if (/file|folder|csv|xlsx|json|archive/.test(value)) return this.getProvider("filesystem");
        if (/email|gmail|reply|inbox/.test(value)) return this.getProvider("email");

        return this.getProvider("general_operations");
    }

    buildDefaults() {
        const base = [
            {
                id: "instantly",
                name: "Instantly",
                aliases: ["outbound", "campaign", "warmup", "bounce"],
                purpose: "Outbound campaign operations and inbox rotation.",
                status: "NEEDS_CONNECTOR",
                canRead: true,
                canExecute: false,
                canDelete: false,
                requiresKevinApprovalFor: ["DELETE_CAMPAIGN", "SEND_LIVE_EMAIL", "CHANGE_DOMAIN_AUTH"],
                supportedActions: ["CREATE_CAMPAIGN", "UPLOAD_LEADS", "ASSIGN_INBOXES", "PAUSE_CAMPAIGN", "READ_METRICS"],
                verification: "Provider controller must confirm object exists or state changed.",
                rollback: "Provider-specific rollback required."
            },
            {
                id: "google_workspace",
                name: "Google Workspace",
                aliases: ["gmail", "workspace", "google admin"],
                purpose: "Mailbox and user administration.",
                status: "NEEDS_CONNECTOR",
                canRead: true,
                canExecute: false,
                canDelete: false,
                requiresKevinApprovalFor: ["DELETE_USER", "SUSPEND_USER", "RESET_PASSWORD"],
                supportedActions: ["CREATE_USER", "CREATE_ALIAS", "READ_USERS", "CHECK_MAILBOX"],
                verification: "Confirm user, alias, or mailbox state after action.",
                rollback: "Disable or remove created object only with governance approval."
            },
            {
                id: "namecheap",
                name: "Namecheap",
                aliases: ["domain", "dns", "dkim", "spf", "dmarc"],
                purpose: "Domain and DNS operations.",
                status: "NEEDS_CONNECTOR",
                canRead: true,
                canExecute: false,
                canDelete: false,
                requiresKevinApprovalFor: ["BUY_DOMAIN", "DELETE_DNS_RECORD", "TRANSFER_DOMAIN"],
                supportedActions: ["READ_DOMAINS", "UPDATE_DNS", "CHECK_DKIM", "CHECK_SPF", "CHECK_DMARC"],
                verification: "DNS lookup or registrar readback.",
                rollback: "Restore previous DNS records from audit snapshot."
            },
            {
                id: "website",
                name: "Website",
                aliases: ["ionos", "cms", "seo", "landing page"],
                purpose: "Website content, forms, SEO, and publishing workflow.",
                status: "NEEDS_CONNECTOR",
                canRead: true,
                canExecute: false,
                canDelete: false,
                requiresKevinApprovalFor: ["PUBLISH_PRICING_CHANGE", "DELETE_PAGE"],
                supportedActions: ["READ_PAGE", "QUEUE_PAGE_EDIT", "VERIFY_FORM", "GENERATE_PAGE_CHANGE"],
                verification: "Fetch page or inspect change queue after execution.",
                rollback: "Restore from website backup/change queue."
            },
            {
                id: "linkedin",
                name: "LinkedIn",
                aliases: ["social", "posts"],
                purpose: "LinkedIn content and relationship operations.",
                status: "NEEDS_CONNECTOR",
                canRead: true,
                canExecute: false,
                canDelete: false,
                requiresKevinApprovalFor: ["PUBLISH_POST", "SEND_MESSAGE"],
                supportedActions: ["DRAFT_POST", "READ_ACTIVITY", "QUEUE_MESSAGE"],
                verification: "Draft or post URL/state confirmed.",
                rollback: "Manual or provider-specific rollback."
            },
            {
                id: "orion",
                name: "ORION",
                aliases: ["contractor", "buyer", "vehicle", "dataset", "recompete"],
                purpose: "ORION data, analysis, and intelligence operations.",
                status: "AVAILABLE",
                canRead: true,
                canExecute: true,
                canDelete: false,
                requiresKevinApprovalFor: ["DELETE_DATA", "DROP_TABLE"],
                supportedActions: ["READ_STATUS", "QUEUE_REFRESH", "GENERATE_REPORT", "VALIDATE_DATASET"],
                verification: "File/database output exists and passes validation.",
                rollback: "Restore from backup if mutation support is added."
            },
            {
                id: "crm",
                name: "CRM",
                aliases: ["pipeline", "lead", "prospect", "client"],
                purpose: "Pipeline, lead, client, and proposal tracking.",
                status: "NEEDS_CONNECTOR",
                canRead: true,
                canExecute: false,
                canDelete: false,
                requiresKevinApprovalFor: ["DELETE_RECORD", "SEND_PROPOSAL"],
                supportedActions: ["READ_PIPELINE", "UPDATE_STAGE", "CREATE_FOLLOWUP", "QUEUE_PROPOSAL"],
                verification: "Record state confirmed after execution.",
                rollback: "Restore prior record snapshot."
            },
            {
                id: "filesystem",
                name: "Filesystem",
                aliases: ["file", "folder", "csv", "json", "xlsx"],
                purpose: "Local file creation, validation, archiving, and reports.",
                status: "AVAILABLE",
                canRead: true,
                canExecute: true,
                canDelete: false,
                requiresKevinApprovalFor: ["DELETE_FILE", "DELETE_FOLDER"],
                supportedActions: ["CREATE_REPORT", "VALIDATE_FILE", "ARCHIVE_FILE", "WRITE_JSON", "READ_JSON"],
                verification: "File exists and content validates.",
                rollback: "Restore from backup."
            },
            {
                id: "email",
                name: "Email",
                aliases: ["gmail", "inbox", "reply"],
                purpose: "Email reading, drafting, and executive communication workflows.",
                status: "NEEDS_CONNECTOR",
                canRead: true,
                canExecute: false,
                canDelete: false,
                requiresKevinApprovalFor: ["SEND_EMAIL", "DELETE_EMAIL"],
                supportedActions: ["READ_INBOX", "DRAFT_EMAIL", "CLASSIFY_REPLY"],
                verification: "Draft/message state confirmed.",
                rollback: "Provider-specific."
            },
            {
                id: "general_operations",
                name: "General Operations",
                aliases: ["miles", "operations", "general"],
                purpose: "Safe internal operational work when no provider is detected.",
                status: "AVAILABLE",
                canRead: true,
                canExecute: true,
                canDelete: false,
                requiresKevinApprovalFor: ["DESTRUCTIVE_ACTION"],
                supportedActions: ["CREATE_INTERNAL_RECORD", "GENERATE_RECOMMENDATION", "QUEUE_REVIEW"],
                verification: "Internal output exists.",
                rollback: "Archive or supersede internal record."
            }
        ];

        return base.map(provider => ({
            ...provider,
            lastVerified: null,
            health: provider.status === "AVAILABLE" ? "READY" : "NOT_CONNECTED"
        }));
    }

    renderReport(registry) {
        const rows = registry.providers.map(p =>
            `| ${p.name} | ${p.status} | ${p.canExecute ? "Yes" : "No"} | ${p.health} | ${p.supportedActions.length} |`
        ).join("\n");

        return `# MILES Provider Registry Report\n\nGenerated: ${new Date().toISOString()}\n\n## Policy\n\nSecrets Stored Here: No  \nDefault Mode: ${registry.policy.defaultMode}\n\n## Providers\n\n| Provider | Status | Can Execute | Health | Actions |\n|---|---:|---:|---:|---:|\n${rows}\n`;
    }
}

module.exports = new ProviderRegistryService();
