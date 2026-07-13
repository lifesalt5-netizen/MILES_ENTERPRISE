"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
function readJson(rel, fallback) { try { const file = path.join(ROOT, rel); if (!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }

function detectProvider(item = {}) {
    const text = [item.area, item.title, item.description, item.reason, item.recommendedAction, item.relatedProvider, JSON.stringify(item.metadata || {})].join(" ").toLowerCase();
    if (/instantly|campaign|outbound|email|inbox|warmup|bounce/.test(text)) return "instantly";
    if (/google workspace|mailbox|alias|user|group/.test(text)) return "google_workspace";
    if (/namecheap|dns|spf|dkim|dmarc|domain/.test(text)) return "namecheap";
    if (/website|page|publish|seo|ionos|wordpress/.test(text)) return "website";
    if (/orion|contractor|buyer|vehicle|dataset|sqlite/.test(text)) return "orion";
    if (/file|folder|json|csv|xlsx|directory/.test(text)) return "filesystem";
    return "filesystem";
}

function detectOperation(provider, item = {}) {
    const text = [item.title, item.description, item.recommendedAction, JSON.stringify(item.metadata || {})].join(" ").toLowerCase();
    if (provider === "instantly") {
        if (/pause/.test(text)) return "PAUSE_CAMPAIGN";
        if (/resume|start/.test(text)) return "RESUME_CAMPAIGN";
        if (/upload|lead/.test(text)) return "UPLOAD_LEADS";
        if (/report|metric|analytics/.test(text)) return "GENERATE_CAMPAIGN_REPORT";
        return "HEALTH_CHECK";
    }
    if (provider === "google_workspace") return /alias/.test(text) ? "CREATE_ALIAS" : "VERIFY_MAILBOX";
    if (provider === "namecheap") return /spf/.test(text) ? "VERIFY_SPF" : /dkim/.test(text) ? "VERIFY_DKIM" : /dmarc/.test(text) ? "VERIFY_DMARC" : "LIST_DOMAINS";
    if (provider === "website") return /backup/.test(text) ? "BACKUP_SITE" : /publish/.test(text) ? "PUBLISH_PAGE" : "VERIFY_PAGE";
    if (provider === "orion") return /refresh/.test(text) ? "REFRESH_DATASETS" : /database|db/.test(text) ? "VERIFY_DATABASE" : "GENERATE_ORION_REPORT";
    return "VERIFY_PATH";
}

class ExecutionPlannerService {
    buildPlan(input = {}) {
        const companyState = readJson("DATA\\company_state\\company_state.json", {});
        const providerState = readJson("DATA\\provider_controllers\\provider_controller_registry.json", {});
        const queue = readJson("DATA\\runtime\\work_queue.json", { items: [] });
        const items = Array.isArray(queue.items) ? queue.items : [];
        const openItems = items.filter(i => ["Queued", "Pending", "Blocked", "Awaiting Approval"].includes(i.status));
        const maxItems = Number(input.maxItems || 10);
        const providers = Array.isArray(providerState.providers) ? providerState.providers : [];
        const providerMap = Object.fromEntries(providers.map(p => [p.provider, p]));
        const tasks = openItems.slice(0, maxItems).map(item => {
            const provider = detectProvider(item);
            const operation = detectOperation(provider, item);
            const providerInfo = providerMap[provider] || {};
            return {
                id: `EXEC-TASK-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
                workItemId: item.id,
                title: item.title,
                priority: item.priority || 3,
                provider,
                operation,
                executable: Boolean(providerInfo.executable),
                credentialsPresent: Boolean(providerInfo.credentialsPresent),
                requiresKevin: Boolean(item.requiresKevin),
                status: "PLANNED",
                payload: {
                    title: item.title,
                    description: item.description,
                    area: item.area,
                    recommendedAction: item.recommendedAction,
                    sourceWorkItem: item
                }
            };
        });

        return {
            ok: true,
            action: "EXECUTION_PLAN",
            type: "MILES_BUSINESS_EXECUTION_PLAN",
            build: "EXEC_005",
            generatedAt: new Date().toISOString(),
            companyHealth: companyState.health || null,
            openItems: openItems.length,
            plannedTasks: tasks.length,
            tasks
        };
    }
}

module.exports = new ExecutionPlannerService();
